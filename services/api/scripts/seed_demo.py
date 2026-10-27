"""Build the seeded /demo scenarios by running the real pipeline.

    python -m scripts.seed_demo                          # uses services/api/.env (offline mock unless MODEL_MODE=live)
    python -m scripts.seed_demo startup-sf-vs-seattle    # just one scenario

Live runs go through the same hard budget and cost ledger as the API.

Each demo file holds the base simulation, one precomputed shock (used as a fallback if a live
shock fails during judging), a precomputed debate, and the postcards.
"""

import asyncio
import base64
import json
import shutil
import subprocess
import sys
import uuid

from elsewhere.agents import persona, pipeline
from elsewhere.config import REPO_ROOT
from elsewhere.contracts import PersonaMessage, Simulation
from elsewhere.config import get_settings
from elsewhere.llm import LLM, current_sim
from elsewhere.store import Store

SCENARIOS = [
    {
        "slug": "startup-sf-vs-seattle",
        "blurb": "Join a 7-person AI startup in San Francisco, or take the stable role in Seattle?",
        "text": "I'm deciding between joining a 7-person AI startup in San Francisco at $145K plus equity, or taking a stable software "
                "engineering role in Seattle at $180K. I care most about learning and ownership, but I also want financial stability. "
                "I have about $40K saved and spend around $4,500 a month. I'm worried the startup could fail.",
        "shock": {"label": "Startup fails at month 14", "description": "The company runs out of money and shuts down.", "month": 14},
        "question": "What do you regret?",
    },
    {
        "slug": "grad-school-vs-job",
        "blurb": "A two-year master's in machine learning in Boston, or a full-time engineering job in Austin now?",
        "text": "Should I do a two-year master's in machine learning in Boston, or take a full-time software engineering job in Austin at $125K? "
                "Tuition is about $60K a year. I want to work on hard ML problems long-term and I value learning a lot, but I also want "
                "to start earning. I have $25K saved and spend about $3,000 a month.",
        "shock": {"label": "Scholarship after 6 months", "description": "A merit scholarship covers the rest of the tuition.", "month": 6},
        "question": "Was it worth it?",
    },
    {
        "slug": "own-product-vs-stay",
        "blurb": "Quit to build your own product, or stay employed at a big company in New York?",
        "text": "I'm thinking about quitting my job to build my own product full-time, or staying at my established company in New York at $165K. "
                "Ownership and autonomy matter most to me. I have $70K saved and spend about $5,000 a month. I'm scared of running out of money.",
        "shock": {"label": "First 1,000 users early", "description": "Users arrive months earlier than planned and a small seed round follows.", "month": 5},
        "question": "How are you feeling about money?",
    },
]


def compact_image(data: bytes, mime: str) -> tuple[bytes, str]:
    """Shrink a postcard to 1024px WebP so the static demo files stay small. Needs ffmpeg; otherwise unchanged."""
    if not mime.startswith("image/") or mime == "image/svg+xml" or not shutil.which("ffmpeg"):
        return data, mime
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-vf", "scale='min(1024,iw)':-2",
                        "-c:v", "libwebp", "-quality", "80", "-f", "webp", "pipe:1"], input=data, capture_output=True)
    return (r.stdout, "image/webp") if r.returncode == 0 and r.stdout else (data, mime)


async def build(llm: LLM, sc: dict) -> dict:
    sim_id = f"demo-{sc['slug']}"
    current_sim.set(sim_id)

    async def emit(t, d):
        print(f"  [{sc['slug']}] {t}: {d.get('agent', '')} {d.get('branch', '')} {d.get('summary', '')[:70]}")

    spec = await pipeline.intake(llm, sc["text"])
    spec.clarifying_questions = []
    sim = Simulation(id=sim_id, slug=sc["slug"], mode=llm.mode, status="draft", decision=spec)
    sim = await pipeline.simulate(llm, sim, emit)
    base = sim.model_copy(deep=True)

    messages: list[dict] = [PersonaMessage(id=uuid.uuid4().hex[:12], role="user", text=sc["question"]).model_dump(mode="json")]
    async for ev in persona.debate(llm, base, sc["question"], "m24", []):
        if ev["type"] == "message":
            messages.append(ev["message"])

    postcards = {}
    for b in ("A", "B"):
        data, mime, _ = await persona.postcard(llm, base, b)
        data, mime = compact_image(data, mime)
        postcards[b] = f"data:{mime};base64,{base64.b64encode(data).decode()}"

    shocked = sim.model_copy(deep=True)
    s = sc["shock"]
    await pipeline.shock(llm, shocked, s["label"], s["description"], s["month"], emit)
    return {
        "slug": sc["slug"],
        "blurb": sc["blurb"],
        "simulation": base.model_dump(mode="json"),
        "precomputed_shock": {"request": s, "simulation": shocked.model_dump(mode="json")},
        "messages": messages,
        "postcards": postcards,
    }


async def main(only: list[str]) -> None:
    settings = get_settings()
    store = Store(settings.database_url)
    await store.init()
    llm = LLM(settings, sink=store.log_call)
    llm.budget.set_spent(await store.total_cost())
    print(f"mode: {llm.mode}  budget: {llm.budget.snapshot()}")
    out_dir = REPO_ROOT / "demo"
    out_dir.mkdir(exist_ok=True)
    for sc in SCENARIOS:
        if only and sc["slug"] not in only:
            continue
        data = await build(llm, sc)
        (out_dir / f"{sc['slug']}.json").write_text(json.dumps(data, indent=1))
        print(f"wrote demo/{sc['slug']}.json  budget now: {llm.budget.snapshot()}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
