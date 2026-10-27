"""Future-self runtime: streamed answers bound to one branch, with a sentence-level branch guard."""

from __future__ import annotations

import re
import uuid
from typing import Any, AsyncIterator

from pydantic import BaseModel

from .. import mock_brain as mock
from ..config import get_settings
from ..contracts import TIMEPOINT_MONTHS, ALL_FIELDS, ClaimSpan, PersonaMessage, Simulation
from ..llm import LLM
from ..prompts import load, system

REF = re.compile(r"\[(ev_[UABS]_\d{3}|E-[AB]-\d{3})\]")
DANGLING_REF = re.compile(r"\s*\[[^\]]*$")
SENTENCE_END = re.compile(r"[.!?](?:\s*\[[^\]]+\])*\s+")
LABELS = {
    "career.role": "My role", "career.employment_status": "Work status", "career.scope": "What I own",
    "career.skills": "What I'm learning", "career.network": "My network", "career.optionality": "My options",
    "finance.salary": "Pay", "finance.equity_value": "Equity", "finance.housing_cost": "Housing",
    "finance.savings": "Savings", "finance.runway_months": "Runway", "location.city": "City",
    "location.commute": "Commute", "location.support_network": "People nearby", "lifestyle.work_hours": "Hours",
    "lifestyle.stress": "Stress", "lifestyle.flexibility": "Flexibility", "lifestyle.social_support": "Support",
    "risk.job_security": "Job security", "risk.reversibility": "Could I switch paths", "risk.downside": "Biggest risk",
    "values_fit.learning": "Learning", "values_fit.stability": "Stability", "values_fit.ownership": "Ownership",
    "values_fit.location": "Place", "values_fit.autonomy": "Autonomy",
}


class Repaired(BaseModel):
    sentence: str


def world_lines(sim: Simulation, branch: str, tp: str) -> list[tuple[str, str]]:
    bw = sim.branches[branch]
    snap = bw.snap(tp)
    month = TIMEPOINT_MONTHS[tp]
    lines: list[tuple[str, str]] = []
    for path in ALL_FIELDS:
        c = snap.get(path)
        if c.status == "known" and c.text and c.evidence_id:
            lines.append((c.evidence_id, f"{LABELS.get(path, path)}: {c.text}"))
    for e in sorted(sim.events, key=lambda e: e.month):
        if e.branch == branch and e.month <= month:
            lines.append((e.id, f"Month {e.month}: {e.title}. {e.detail}".strip()))
    for e in sim.evidence:
        if e.id.startswith("ev_U_"):
            lines.append((e.id, e.text))
    return lines


def foreign_titles(sim: Simulation, branch: str) -> list[str]:
    own = {e.title.lower() for e in sim.events if e.branch == branch}
    return [e.title.lower() for e in sim.events if e.branch != branch and e.title.lower() not in own and len(e.title) > 8]


def violates(sentence: str, allowed: set[str], foreign: list[str]) -> bool:
    if any(ref not in allowed for ref in REF.findall(sentence)):
        return True
    low = sentence.lower()
    return any(t in low for t in foreign)


def spans(text: str) -> list[ClaimSpan]:
    """Each citation marker covers the text from the previous boundary to the marker."""
    out: list[ClaimSpan] = []
    last = 0
    for m in REF.finditer(text):
        start = max(text.rfind(". ", last, m.start()) + 2, text.rfind(", ", last, m.start()) + 2, last)
        out.append(ClaimSpan(start=start, end=m.start(), ref=m.group(1)))
        last = m.end()
    return out


async def stream_answer(
    llm: LLM, sim: Simulation, branch: str, question: str, tp: str,
    other_said: str | None = None, history: list[PersonaMessage] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    s = get_settings()
    bw = sim.branches[branch]
    lines = world_lines(sim, branch, tp)
    allowed = {i for i, _ in lines}
    foreign = foreign_titles(sim, branch)
    instructions = system(
        "persona", branch=branch, months=str(TIMEPOINT_MONTHS[tp]), path_label=bw.label,
        voice=bw.persona.voice or "Plain and honest.", temperament=bw.persona.temperament or "Reflective.",
    )
    if other_said is not None:
        instructions += "\n\n" + load("debate")
    world = "\n".join(f"[{i}] {t}" for i, t in lines)
    convo = ""
    for m in (history or [])[-6:]:
        who = "User" if m.role == "user" else ("You" if m.role == f"future_{branch.lower()}" else "Other future")
        convo += f"{who}: {REF.sub('', m.text).strip()}\n"
    prompt = f"YOUR WORLD (month {TIMEPOINT_MONTHS[tp]}):\n{world}\n\n"
    if convo:
        prompt += f"CONVERSATION SO FAR:\n{convo}\n"
    if other_said is not None:
        prompt += f"THE OTHER FUTURE SAID: {other_said}\n\n"
    prompt += f"USER ASKS: {question}"

    rewrites = 0
    full = ""
    buf = ""

    async def check(sentence: str) -> str:
        nonlocal rewrites
        if not violates(sentence, allowed, foreign):
            return sentence
        rewrites += 1

        def mock_fix() -> Repaired:
            return Repaired(sentence="I don't know that part from where I am. ")

        fixed = await llm.structured(
            agent=f"branch_guard_{branch}", model=s.specialist_model, instructions=system("repair_sentence"),
            input=f"ALLOWED WORLD:\n{world}\n\nSENTENCE: {sentence}", schema=Repaired, effort="minimal", mock=mock_fix, max_output_tokens=600,
        )
        out = fixed.sentence.strip() + " "
        return out if not violates(out, allowed, foreign) else REF.sub("", out)

    async for delta in llm.stream_text(
        agent=f"persona_{branch}", model=s.specialist_model, instructions=instructions, input=prompt,
        effort="low", cache_key=f"elsewhere-persona-{sim.id}-{branch}", max_output_tokens=2000,
        mock=lambda: mock.persona_reply(question, branch, lines, other_said),
    ):
        buf += delta
        while (m := SENTENCE_END.search(buf)):
            sentence, buf = buf[: m.end()], buf[m.end():]
            sentence = await check(sentence)
            full += sentence
            yield {"type": "delta", "branch": branch, "text": sentence}
    buf = DANGLING_REF.sub("", buf)  # an answer cut off by the token cap can end mid-reference: "... ["
    if buf.strip():
        tail = await check(buf)
        full += tail
        yield {"type": "delta", "branch": branch, "text": tail}
    if rewrites:
        yield {"type": "guard", "branch": branch, "rewrites": rewrites}
    msg = PersonaMessage(id=uuid.uuid4().hex[:12], role=f"future_{branch.lower()}", text=full.strip(),  # type: ignore[arg-type]
                         claims=spans(full.strip()), guard_rewrites=rewrites, timepoint=tp)  # type: ignore[arg-type]
    yield {"type": "message", "branch": branch, "message": msg.model_dump()}


async def debate(llm: LLM, sim: Simulation, question: str, tp: str, history: list[PersonaMessage]) -> AsyncIterator[dict[str, Any]]:
    """A answers, B responds to A, A replies once. The other side's words arrive without their sources."""
    said: dict[str, str] = {}
    for turn, (b, other) in enumerate([("A", None), ("B", "A"), ("A", "B")]):
        yield {"type": "turn", "branch": b, "replying_to": other}
        other_text = REF.sub("", said[other]).strip() if other else None
        q = question if turn < 2 else f"{question} (Reply briefly to what Future B just said.)"
        async for ev in stream_answer(llm, sim, b, q, tp, other_said=other_text, history=history):
            if ev["type"] == "message":
                said[b] = ev["message"]["text"]
            yield ev


async def postcard(llm: LLM, sim: Simulation, branch: str, tp: str = "m24") -> tuple[bytes, str, str]:
    bw = sim.branches[branch]
    snap = bw.snap(tp)
    city = snap.location.city.text or bw.label
    scene = f"{city}, a view that fits someone whose life is: {snap.headline or bw.summary}. Work: {snap.career.role.text or 'unknown'}"
    caption = f"Path {branch} · {city} · month {TIMEPOINT_MONTHS[tp]}"
    prompt = load("postcard").format(scene=scene, mood=bw.persona.temperament or "quiet", caption=caption)
    accent = "#2F6FCC" if branch == "A" else "#B8641E"
    data, mime = await llm.image(prompt=prompt, mock=lambda: (mock.postcard_svg(city, caption, accent), "image/svg+xml"))
    return data, mime, prompt
