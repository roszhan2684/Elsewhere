"""FastAPI gateway. Routes follow docs (plan section 12)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import shutil
import subprocess
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from . import mock_brain
from .agents import persona, pipeline
from .config import REPO_ROOT, get_settings
from .contracts import DecisionSpec, PersonaMessage, Simulation, Timepoint
from .budget import BudgetExceeded
from .llm import LLM, LLMError, current_sim
from .prompts import PROMPT_VERSION
from .store import Store

log = logging.getLogger("elsewhere")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = get_settings()
store = Store(settings.database_url)
llm = LLM(settings, sink=store.log_call)
DEMO_DIR = REPO_ROOT / "demo"
BUDGET_MSG = "The live AI budget for this app is used up, so live runs are paused. Saved demos still work."
_tasks: set[asyncio.Task] = set()
_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
_hits: dict[str, deque] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await store.init()
    llm.budget.set_spent(await store.total_cost())
    log.info("Elsewhere API ready: mode=%s prompts=%s budget=%s", llm.mode, PROMPT_VERSION, llm.budget.snapshot())
    yield


app = FastAPI(title="Elsewhere API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_origin_regex=r"(https://.*\.vercel\.app|http://localhost:\d+|http://127\.0\.0\.1:\d+)",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["x-request-id"] = rid
    # Never log request bodies: decisions are personal.
    log.info("%s %s %s %dms rid=%s", request.method, request.url.path, response.status_code, (time.perf_counter() - t0) * 1000, rid)
    return response


@app.exception_handler(BudgetExceeded)
async def budget_error(_: Request, exc: BudgetExceeded):
    return JSONResponse(status_code=402, content={"error": "The live AI budget for this app is used up, so live runs are paused. Saved demos still work."})


@app.exception_handler(LLMError)
async def llm_error(_: Request, exc: LLMError):
    log.warning("model error: %s", exc)
    return JSONResponse(status_code=503, content={"error": "The models are busy right now. Please try again in a moment."})


def spawn(coro) -> None:
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


def rate_limit(request: Request) -> None:
    """Live model calls are limited per IP; mock mode is free."""
    if not llm.live:
        return
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    q = _hits[ip]
    now = time.time()
    while q and q[0] < now - 3600:
        q.popleft()
    if len(q) >= settings.demo_live_calls_per_hour:
        raise HTTPException(429, "You've hit the hourly limit for live model runs. The saved demo still works.")
    q.append(now)


async def must_load(sim_id: str) -> Simulation:
    sim = await store.load(sim_id)
    if sim is None:
        raise HTTPException(404, "Simulation not found")
    return sim


def emitter(sim_id: str):
    async def emit(type: str, data: dict[str, Any]) -> None:
        await store.emit(sim_id, type, data)
    return emit


# ---------------------------------------------------------------- meta

@app.get("/health")
async def health():
    return {"ok": True, "mode": llm.mode}


@app.get("/v1/budget")
async def budget():
    """How much of the hard budget is used. Recorded costs include a safety margin, so real spend is lower."""
    return {"mode": llm.mode, **llm.budget.snapshot()}


@app.get("/v1/meta")
async def meta():
    return {
        "mode": llm.mode,
        "prompt_version": PROMPT_VERSION,
        "models": {
            "orchestrator": settings.orchestrator_model, "specialists": settings.specialist_model,
            "image": settings.image_model, "voice": settings.transcribe_model, "grounding": f"{settings.specialist_model} + web_search",
        },
    }


# ---------------------------------------------------------------- decisions

class DecisionIn(BaseModel):
    text: str = Field(min_length=10, max_length=6000)


class ClarifyIn(BaseModel):
    answers: dict[str, str]


@app.post("/v1/decisions")
async def create_decision(body: DecisionIn, request: Request):
    rate_limit(request)
    sim_id = uuid.uuid4().hex[:12]
    token = current_sim.set(sim_id)
    try:
        spec = await pipeline.intake(llm, body.text)
    finally:
        current_sim.reset(token)
    sim = Simulation(id=sim_id, mode=llm.mode, status="draft", decision=spec)  # type: ignore[arg-type]
    await store.save(sim)
    return {"id": sim_id, "decision": spec, "mode": llm.mode}


@app.patch("/v1/decisions/{sim_id}")
async def edit_decision(sim_id: str, spec: DecisionSpec):
    sim = await must_load(sim_id)
    if sim.status != "draft":
        raise HTTPException(409, "This decision has already been simulated.")
    sim.decision = spec
    await store.save(sim)
    return {"id": sim_id, "decision": spec}


@app.post("/v1/decisions/{sim_id}/clarify")
async def clarify(sim_id: str, body: ClarifyIn, request: Request):
    rate_limit(request)
    sim = await must_load(sim_id)
    token = current_sim.set(sim_id)
    try:
        sim.decision = await pipeline.clarify(llm, sim.decision, body.answers)
    finally:
        current_sim.reset(token)
    await store.save(sim)
    return {"id": sim_id, "decision": sim.decision}


@app.post("/v1/decisions/{sim_id}/simulate", status_code=202)
async def simulate(sim_id: str, request: Request):
    rate_limit(request)
    sim = await must_load(sim_id)
    if sim.status == "running":
        return {"simulation_id": sim_id, "status": "running"}
    start_simulation(sim_id)
    return {"simulation_id": sim_id, "status": "running"}


def start_simulation(sim_id: str) -> None:
    async def run() -> None:
        token = current_sim.set(sim_id)
        emit = emitter(sim_id)
        async with _locks[sim_id]:
            s = await must_load(sim_id)
            s.status = "running"
            await store.save(s)
            await emit("simulation_started", {"mode": llm.mode})
            try:
                s = await pipeline.simulate(llm, s, emit)
                await store.save(s, reason="initial simulation")
                await emit("simulation_ready", {"version": s.version})
            except Exception as e:
                log.exception("simulation %s failed", sim_id)
                s.status = "failed"
                await store.save(s)
                await emit("simulation_failed", {"error": BUDGET_MSG if isinstance(e, BudgetExceeded) else "The simulation couldn't finish. Try again, or open the saved demo." if isinstance(e, LLMError) else "Something went wrong while building the worlds."})
            finally:
                current_sim.reset(token)

    spawn(run())


async def _to_wav(raw: bytes, filename: str) -> bytes:
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        return raw
    if not shutil.which("ffmpeg"):
        raise HTTPException(415, "Please upload WAV audio (mono, 16-bit, 16 or 24 kHz).")
    proc = await asyncio.to_thread(
        subprocess.run,
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"],
        input=raw, capture_output=True, timeout=60,
    )
    if proc.returncode != 0:
        raise HTTPException(415, "Couldn't read that audio file.")
    return proc.stdout


@app.post("/v1/intake/voice")
@app.post("/v1/decisions/{sim_id}/intake/voice")
async def voice(request: Request, audio: UploadFile = File(...), sim_id: str | None = None):
    rate_limit(request)
    raw = await audio.read()
    if len(raw) > 32 * 1024 * 1024:
        raise HTTPException(413, "Audio is too long. Keep it under 10 minutes.")
    wav = await _to_wav(raw, audio.filename or "audio")
    keywords = ["startup", "equity", "Seattle", "San Francisco", "New York", "grad school", "PhD", "MBA", "salary", "relocate",
                "Dubai", "Kerala", "Kochi", "recruitment fee", "nursing", "CNA", "Uber", "Lyft", "warehouse"]
    text = await llm.transcribe(wav=wav, keywords=keywords, mock=lambda: mock_brain.CANONICAL)
    return {"transcript": text, "mode": llm.mode}


# ---------------------------------------------------------------- simulations

@app.get("/v1/simulations")
async def recent():
    return await store.recent()


@app.get("/v1/simulations/{sim_id}")
async def get_sim(sim_id: str):
    return await must_load(sim_id)


@app.delete("/v1/simulations/{sim_id}", status_code=204)
async def delete_sim(sim_id: str):
    await store.delete(sim_id)
    return Response(status_code=204)


@app.get("/v1/simulations/{sim_id}/versions")
async def versions(sim_id: str):
    return await store.versions(sim_id)


@app.get("/v1/simulations/{sim_id}/versions/{version}")
async def version(sim_id: str, version: int):
    sim = await store.version(sim_id, version)
    if not sim:
        raise HTTPException(404, "Version not found")
    return sim


@app.get("/v1/simulations/{sim_id}/events")
async def events(sim_id: str, request: Request, after: int = 0):
    last = request.headers.get("last-event-id")
    start = int(last) if last and last.isdigit() else after

    async def gen():
        async for row in store.subscribe(sim_id, start):
            if await request.is_disconnected():
                break
            if row is None:
                yield {"comment": "keep-alive"}
            else:
                yield {"event": row.type, "id": str(row.id), "data": json.dumps(row.data)}

    return EventSourceResponse(gen())


@app.get("/v1/simulations/{sim_id}/evidence")
async def evidence(sim_id: str):
    sim = await must_load(sim_id)
    return sim.evidence


@app.get("/v1/simulations/{sim_id}/calls")
async def calls(sim_id: str):
    rows = await store.calls(sim_id)
    by_model: dict[str, dict[str, Any]] = {}
    for r in rows:
        m = by_model.setdefault(r["model"], {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cached_tokens": 0, "latency_ms": 0})
        m["calls"] += 1
        for k in ("input_tokens", "output_tokens", "cached_tokens", "latency_ms"):
            m[k] += r[k] or 0
    return {"calls": rows, "by_model": by_model}


class ChatIn(BaseModel):
    branch: Literal["A", "B", "both"]
    question: str = Field(min_length=1, max_length=1000)
    timepoint: Timepoint = "m24"


@app.get("/v1/simulations/{sim_id}/messages")
async def messages(sim_id: str):
    return await store.messages(sim_id)


@app.post("/v1/simulations/{sim_id}/chat")
async def chat(sim_id: str, body: ChatIn, request: Request):
    rate_limit(request)
    sim = await must_load(sim_id)
    if sim.status != "ready":
        raise HTTPException(409, "This simulation isn't ready yet.")
    history = await store.messages(sim_id)
    user_msg = PersonaMessage(id=uuid.uuid4().hex[:12], role="user", text=body.question, timepoint=body.timepoint)
    await store.add_message(sim_id, user_msg)

    async def gen():
        token = current_sim.set(sim_id)
        try:
            stream = (persona.debate(llm, sim, body.question, body.timepoint, history) if body.branch == "both"
                      else persona.stream_answer(llm, sim, body.branch, body.question, body.timepoint, history=history))
            async for ev in stream:
                if ev["type"] == "message":
                    await store.add_message(sim_id, PersonaMessage.model_validate(ev["message"]))
                yield {"event": ev["type"], "data": json.dumps(ev)}
            yield {"event": "done", "data": "{}"}
        except BudgetExceeded:
            yield {"event": "error", "data": json.dumps({"error": BUDGET_MSG})}
        except LLMError:
            yield {"event": "error", "data": json.dumps({"error": "Your future self is taking too long to answer. Try again."})}
        finally:
            current_sim.reset(token)

    return EventSourceResponse(gen())


class ShockIn(BaseModel):
    label: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=600)
    month: int = Field(default=12, ge=1, le=59)


@app.post("/v1/simulations/{sim_id}/shock", status_code=202)
async def shock(sim_id: str, body: ShockIn, request: Request):
    rate_limit(request)
    sim = await must_load(sim_id)
    if sim.status != "ready":
        raise HTTPException(409, "This simulation isn't ready yet.")
    job = uuid.uuid4().hex[:8]

    async def run() -> None:
        token = current_sim.set(sim_id)
        emit = emitter(sim_id)
        async with _locks[sim_id]:
            s = await must_load(sim_id)
            await emit("shock_started", {"job": job, "label": body.label})
            try:
                rec = await pipeline.shock(llm, s, body.label, body.description, body.month, emit)
                await store.save(s, reason=f"shock: {body.label}")
                await emit("shock_ready", {"job": job, "shock_id": rec.id, "version": s.version})
            except Exception as e:
                log.exception("shock on %s failed", sim_id)
                await emit("shock_failed", {"job": job, "error": BUDGET_MSG if isinstance(e, BudgetExceeded) else "The shock couldn't be applied. Try again." if isinstance(e, LLMError) else "Something went wrong recomputing the worlds."})
            finally:
                current_sim.reset(token)

    spawn(run())
    return {"job": job, "status": "running"}


class AssumptionsIn(BaseModel):
    branch: Literal["A", "B"]
    edits: dict[str, float]


@app.post("/v1/simulations/{sim_id}/assumptions")
async def assumptions(sim_id: str, body: AssumptionsIn):
    async with _locks[sim_id]:
        sim = await must_load(sim_id)
        sim = pipeline.edit_assumptions(sim, body.branch, body.edits)
        await store.save(sim, reason=f"assumptions edited on Path {body.branch}")
    return sim


class PostcardIn(BaseModel):
    branch: Literal["A", "B"]
    timepoint: Timepoint = "m24"


@app.post("/v1/simulations/{sim_id}/postcard")
async def postcard(sim_id: str, body: PostcardIn, request: Request):
    rate_limit(request)
    sim = await must_load(sim_id)
    token = current_sim.set(sim_id)
    try:
        data, mime, prompt = await persona.postcard(llm, sim, body.branch, body.timepoint)
    finally:
        current_sim.reset(token)
    asset_id = uuid.uuid4().hex[:16]
    await store.add_asset(asset_id, sim_id, body.branch, "postcard", mime, data, prompt)
    return {"id": asset_id, "url": f"/v1/assets/{asset_id}", "mime": mime, "branch": body.branch, "mode": llm.mode}


@app.get("/v1/simulations/{sim_id}/assets")
async def assets(sim_id: str):
    return await store.assets_for(sim_id)


@app.get("/v1/assets/{asset_id}")
async def asset(asset_id: str):
    a = await store.asset(asset_id)
    if not a:
        raise HTTPException(404, "Not found")
    return Response(content=a.data, media_type=a.mime, headers={"cache-control": "public, max-age=31536000, immutable"})


# ---------------------------------------------------------------- demo

def _demo_files() -> dict[str, Path]:
    return {p.stem: p for p in sorted(DEMO_DIR.glob("*.json"))}


@app.get("/v1/demo")
async def demo_list():
    out = []
    for slug, p in _demo_files().items():
        d = json.loads(p.read_text())
        out.append({"slug": slug, "title": d["simulation"]["decision"]["title"], "blurb": d.get("blurb", ""), "mode": d["simulation"]["mode"]})
    return out


@app.get("/v1/demo/{slug}")
async def demo(slug: str):
    p = _demo_files().get(slug)
    if not p:
        raise HTTPException(404, "Demo not found")
    return json.loads(p.read_text())


@app.post("/v1/demo/{slug}/fork")
async def demo_fork(slug: str, request: Request):
    """Live actions on a demo happen on a private copy, so judges never change the shared demo."""
    rate_limit(request)
    p = _demo_files().get(slug)
    if not p:
        raise HTTPException(404, "Demo not found")
    d = json.loads(p.read_text())
    sim = Simulation.model_validate(d["simulation"])
    sim.id = uuid.uuid4().hex[:12]
    sim.mode = llm.mode  # type: ignore[assignment]
    await store.save(sim, reason=f"forked from demo {slug}", parent_id=f"demo:{slug}")
    for m in d.get("messages", []):
        await store.add_message(sim.id, PersonaMessage.model_validate({**m, "id": uuid.uuid4().hex[:12]}))
    return {"id": sim.id}


# ---------------------------------------------------------------- third door (idea: is this really either/or?)

@app.post("/v1/simulations/{sim_id}/third-door")
async def third_door(sim_id: str, request: Request):
    rate_limit(request)
    sim = await must_load(sim_id)
    if sim.status != "ready":
        raise HTTPException(409, "This simulation isn't ready yet.")
    token = current_sim.set(sim_id)
    try:
        door = await pipeline.third_door(llm, sim)
    finally:
        current_sim.reset(token)
    async with _locks[sim_id]:
        fresh = await must_load(sim_id)
        fresh.third_door = door
        await store.save(fresh)
    return door


class DoorSimIn(BaseModel):
    against: Literal["A", "B"]


@app.post("/v1/simulations/{sim_id}/third-door/simulate", status_code=202)
async def third_door_simulate(sim_id: str, body: DoorSimIn, request: Request):
    rate_limit(request)
    sim = await must_load(sim_id)
    if not sim.third_door:
        raise HTTPException(409, "Find a third door first.")
    new_id = uuid.uuid4().hex[:12]
    spec = pipeline.third_door_decision(sim, body.against)
    child = Simulation(id=new_id, mode=llm.mode, status="draft", decision=spec, derived_from=sim_id)  # type: ignore[arg-type]
    await store.save(child)
    start_simulation(new_id)
    return {"simulation_id": new_id, "status": "running"}


# ---------------------------------------------------------------- fork with friends (share link + votes)

def _voter(request: Request, token: str) -> str:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    return hashlib.sha256(f"{ip}|{token}".encode()).hexdigest()[:32]


def public_view(sim: Simulation, share_id: str) -> dict[str, Any]:
    """What a friend sees: both futures, no chats, no evidence ledger, no stated savings or spending."""
    d = sim.decision
    branches = {}
    for b, bw in sim.branches.items():
        branches[b] = {
            "branch": b, "label": bw.label, "summary": bw.summary, "top_tradeoffs": bw.top_tradeoffs, "confidence": bw.confidence,
            "city": bw.snap("m0").location.city.text,
            "snapshots": [s.model_dump(mode="json", exclude={"event_ids"}) for s in bw.snapshots if s.timepoint in ("m24", "m60")],
        }
    return {
        "share_id": share_id, "mode": sim.mode, "title": d.title, "question": d.question,
        "priorities": d.priorities.model_dump(), "goals": d.goals[:3], "branches": branches,
        "third_door": sim.third_door.label if sim.third_door else None,
    }


async def tally(share_id: str, token: str | None = None, request: Request | None = None) -> dict[str, Any]:
    votes = await store.votes(share_id)
    mine = None
    if token and request is not None:
        me = _voter(request, token)
        mine = next((v["choice"] for v in votes if v["voter"] == me), None)
    return {
        "A": sum(v["choice"] == "A" for v in votes), "B": sum(v["choice"] == "B" for v in votes), "total": len(votes), "mine": mine,
        "reasons": [{k: v[k] for k in ("choice", "name", "reason", "created_at")} for v in votes if v["reason"]][:30],
    }


@app.post("/v1/simulations/{sim_id}/share")
async def create_share(sim_id: str):
    sim = await must_load(sim_id)
    if sim.status != "ready":
        raise HTTPException(409, "This simulation isn't ready yet.")
    share_id = await store.share_for(sim_id)
    if not share_id:
        share_id = uuid.uuid4().hex[:10]
        await store.create_share(share_id, sim_id)
    return {"share_id": share_id, **(await tally(share_id))}


@app.get("/v1/simulations/{sim_id}/share")
async def get_share(sim_id: str):
    await must_load(sim_id)
    share_id = await store.share_for(sim_id)
    if not share_id:
        return {"share_id": None}
    return {"share_id": share_id, **(await tally(share_id))}


async def _share_sim(share_id: str) -> Simulation:
    sim_id = await store.share_sim(share_id)
    sim = await store.load(sim_id) if sim_id else None
    if sim is None:
        raise HTTPException(404, "This link doesn't exist or was deleted.")
    return sim


@app.get("/v1/shares/{share_id}")
async def get_public_share(share_id: str, request: Request, token: str | None = None):
    sim = await _share_sim(share_id)
    return {**public_view(sim, share_id), "votes": await tally(share_id, token, request)}


class VoteIn(BaseModel):
    choice: Literal["A", "B"]
    token: str = Field(min_length=8, max_length=64)
    name: str = Field(default="", max_length=40)
    reason: str = Field(default="", max_length=280)


@app.post("/v1/shares/{share_id}/votes")
async def vote(share_id: str, body: VoteIn, request: Request):
    await _share_sim(share_id)
    await store.vote(share_id, _voter(request, body.token), body.choice, body.name.strip(), body.reason.strip())
    return await tally(share_id, body.token, request)


# ---------------------------------------------------------------- reality check-ins

class CheckinIn(BaseModel):
    month: int = Field(ge=0, le=120)
    took: Literal["A", "B", "neither"]
    savings_usd: float | None = Field(default=None, ge=-10_000_000, le=100_000_000)
    annual_pay_usd: float | None = Field(default=None, ge=0, le=100_000_000)
    stress: int | None = Field(default=None, ge=1, le=5)
    hours_per_week: float | None = Field(default=None, ge=0, le=120)
    note: str = Field(default="", max_length=1000)


@app.get("/v1/simulations/{sim_id}/checkins")
async def checkins(sim_id: str):
    await must_load(sim_id)
    return await store.checkins(sim_id)


@app.post("/v1/simulations/{sim_id}/checkins")
async def add_checkin(sim_id: str, body: CheckinIn):
    await must_load(sim_id)
    checkin_id = uuid.uuid4().hex[:12]
    await store.add_checkin(checkin_id, sim_id, body.model_dump())
    return {"id": checkin_id, **body.model_dump()}
