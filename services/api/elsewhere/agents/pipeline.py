"""The simulation pipeline.

simulate():  Wonder plans and delegates (function tools) -> Spark specialists + grounding run in
             parallel -> code compiles WorldState -> Wonder reconciles -> code invariants ->
             Spark consistency check -> repairs.
shock():     Wonder plans entry points -> code walks the dependency map -> Spark recomputes the
             affected domains after the shock month -> code diffs -> Spark writes front pages.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Awaitable, Callable

from .. import mock_brain as mock
from ..config import get_settings
from ..contracts import (
    TIMEPOINT_MONTHS,
    TIMEPOINTS,
    ALL_FIELDS,
    BranchWorld,
    CheckResult,
    Claim,
    DecisionSpec,
    FinanceInputs,
    OneTimeCost,
    PaySegment,
    Persona,
    Range,
    ShockRecord,
    Simulation,
)
from ..engine import diff as diffing
from ..engine import invariants
from ..engine.compiler import (
    Registry,
    apply_finance,
    apply_specialist,
    blank_snapshots,
    carry_forward,
    ground_citation,
    index_events,
)
from ..engine.deps import downstream
from ..llm import LLM
from ..prompts import DOMAIN_GUIDANCE, system
from ..prompts import load as load_prompt
from .schemas import (
    DOMAIN_WRITES,
    BranchShockPlan,
    ConsistencyReport,
    FinanceOutput,
    FrontPagesOut,
    GroundedNumber,
    Reconciliation,
    ShockPlan,
    SpecialistOutput,
)

Emit = Callable[[str, dict[str, Any]], Awaitable[None]]
FIELD_NAMES = {
    "finance.salary": "pay", "finance.savings": "savings", "finance.runway_months": "runway", "finance.equity_value": "equity",
    "finance.housing_cost": "housing", "career.employment_status": "work status", "career.role": "role", "career.scope": "scope",
    "career.skills": "skills", "career.optionality": "options", "lifestyle.stress": "stress", "lifestyle.work_hours": "hours",
    "location.city": "city", "risk.job_security": "job security", "risk.downside": "downside",
}
TP_WORDS = {"m0": "now", "m6": "6 months", "m24": "year 2", "m60": "year 5"}
ENGINE_FIELDS = {"finance.salary", "finance.housing_cost", "finance.savings", "finance.runway_months"}
LIVING_COST_SHARE = 0.6  # share of stated monthly spending assumed to be non-housing


def _s():
    return get_settings()


def path_of(spec: DecisionSpec, b: str):
    return spec.path_a if b == "A" else spec.path_b


# ------------------------------------------------------------------ intake

async def intake(llm: LLM, text: str) -> DecisionSpec:
    return await llm.structured(
        agent="intake", model=_s().specialist_model, instructions=system("intake"),
        input=text, schema=DecisionSpec, effort="low", cache_key="elsewhere-intake-v1", max_output_tokens=4000,
        mock=lambda: mock.intake(text),
    )


async def clarify(llm: LLM, spec: DecisionSpec, answers: dict[str, str]) -> DecisionSpec:
    qa = "\n".join(f"Q ({q.id}): {q.text}\nA: {answers.get(q.id, '(skipped)')}" for q in spec.clarifying_questions)
    return await llm.structured(
        agent="intake_clarify", model=_s().specialist_model, instructions=system("intake"),
        input=f"Current DecisionSpec:\n{spec.model_dump_json()}\n\nThe user answered the clarifying questions:\n{qa}\n\n"
              "Return the updated DecisionSpec with these answers merged in and clarifying_questions empty.",
        schema=DecisionSpec, effort="low", cache_key="elsewhere-intake-v1", max_output_tokens=4000,
        mock=lambda: mock.apply_answers(spec, answers),
    )


# ------------------------------------------------------------------ helpers

def seed_user_evidence(reg: Registry, spec: DecisionSpec) -> dict[str, str]:
    ids: dict[str, str] = {}
    for b in ("A", "B"):
        p = path_of(spec, b)
        if p.annual_pay_usd:
            ids[f"pay_{b}"] = reg.evidence("U", "ASSUMPTION", "user", "intake", f"Path {b} pays ${p.annual_pay_usd:,.0f} a year" + (f" plus {p.equity}" if p.equity else "") + " (you said).", "high")
        if p.city:
            ids[f"city_{b}"] = reg.evidence("U", "ASSUMPTION", "user", "intake", f"Path {b} is based in {p.city} (you said).", "high")
        ids[f"path_{b}"] = reg.evidence("U", "ASSUMPTION", "user", "intake", f"Path {b}: {p.label}. {p.notes}".strip(), "high")
    c = spec.current
    if c.savings_usd is not None:
        ids["savings"] = reg.evidence("U", "ASSUMPTION", "user", "intake", f"You have about ${c.savings_usd:,.0f} saved (you said).", "high")
    if c.monthly_expenses_usd is not None:
        ids["expenses"] = reg.evidence("U", "ASSUMPTION", "user", "intake", f"You spend about ${c.monthly_expenses_usd:,.0f} a month (you said).", "high")
    pr = spec.priorities
    ids["priorities"] = reg.evidence("U", "ASSUMPTION", "user", "intake",
                                     f"Your priorities (1-5): learning {pr.learning}, stability {pr.stability}, ownership {pr.ownership}, location {pr.location}, autonomy {pr.autonomy}.", "high")
    for g in spec.goals[:3]:
        reg.evidence("U", "ASSUMPTION", "user", "intake", f"Goal: {g}", "high")
    for f in spec.fears[:3]:
        reg.evidence("U", "ASSUMPTION", "user", "intake", f"Worry: {f}", "high")
    return ids


def citable(sim: Simulation, branch: str) -> str:
    rows = [f"{e.id} [{e.kind}] {e.text}" for e in sim.evidence if e.id.startswith(("ev_U_", "ev_S_", f"ev_{branch}_")) and e.kind != "INFERENCE"]
    return "\n".join(rows) or "(none)"


def world_text(sim: Simulation, branch: str, tps: list[str] | None = None, with_ids: bool = False) -> str:
    bw = sim.branches[branch]
    lines = [f"PATH {branch}: {bw.label}"]
    for tp in tps or TIMEPOINTS:
        snap = bw.snap(tp)
        lines.append(f"-- {tp} (month {TIMEPOINT_MONTHS[tp]}) {snap.headline}")
        for path in ALL_FIELDS:
            c = snap.get(path)
            if c.status == "known" and c.text:
                ref = f" [{c.evidence_id}]" if with_ids and c.evidence_id else ""
                lines.append(f"   {path}: {c.text}{ref}")
    evs = [e for e in sorted(sim.events, key=lambda e: e.month) if e.branch == branch]
    if evs:
        lines.append("-- events")
        lines += [f"   [{e.id}] month {e.month}: {e.title}" for e in evs]
    return "\n".join(lines)


def initial_finance(spec: DecisionSpec, b: str) -> FinanceInputs:
    p = path_of(spec, b)
    return FinanceInputs(
        start_savings=spec.current.savings_usd or 0.0, annual_pay=p.annual_pay_usd or 0.0, effective_tax_rate=0.28,
        annual_housing_low=24000, annual_housing_high=32000, annual_other_costs=24000,
        equity_note=p.equity,
    )


def _num_from_grounding(text: str) -> tuple[float, float] | None:
    """Pull a dollar range out of a grounded answer (monthly figures are annualised)."""
    vals = []
    for m in re.finditer(r"\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?", text):
        v = float(m.group(1).replace(",", "")) * (1000 if m.group(2) else 1)
        vals.append(v)
    if not vals:
        return None
    monthly = bool(re.search(r"(per|a|/)\s?month|monthly|/mo", text, re.I))
    vals = [v * 12 if monthly else v for v in vals[:2]]
    return (min(vals), max(vals))


# ------------------------------------------------------------------ specialists

async def run_specialist(llm: LLM, sim: Simulation, domain: str, branch: str, focus: str, shock_ctx: str | None = None,
                         shock_plan: BranchShockPlan | None = None, shock_month: int = 0) -> SpecialistOutput:
    spec = sim.decision
    p = path_of(spec, branch)
    instructions = system(
        "specialist", domain=domain, branch=branch, path_label=p.label,
        allowed_fields="\n".join(f"- {f}" for f in DOMAIN_WRITES[domain]),
        domain_guidance=DOMAIN_GUIDANCE[domain], focus=focus,
    )
    if shock_ctx:
        instructions += "\n\n" + shock_ctx
    other = "B" if branch == "A" else "A"
    spec_view = spec.model_dump(exclude={"clarifying_questions"})
    spec_view.pop("path_b" if branch == "A" else "path_a")
    payload = (
        f"DECISION (your path only):\n{json.dumps(spec_view, indent=1)}\n\n"
        f"EVIDENCE YOU CAN CITE:\n{citable(sim, branch)}\n"
    )
    if shock_ctx and branch in sim.branches:
        payload += f"\nYOUR WORLD BEFORE THE SHOCK:\n{world_text(sim, branch)}\n"
    payload += f"\n(You do not know anything about Path {other}.)"
    schema = FinanceOutput if domain == "finance" else SpecialistOutput
    if shock_plan is not None:
        mock_fn = lambda: mock.shock_recompute(spec, domain, branch, shock_month, shock_plan)  # noqa: E731
    elif domain == "finance":
        mock_fn = lambda: mock.finance(spec, branch)  # noqa: E731
    else:
        user_ids = {"priorities": next((e.id for e in sim.evidence if e.text.startswith("Your priorities")), "new:0")}
        mock_fn = lambda: mock.specialist(spec, domain, branch, user_ids)  # noqa: E731
    return await llm.structured(
        agent=f"{domain}_{branch}", model=_s().specialist_model, instructions=instructions, input=payload,
        schema=schema, effort="medium", cache_key=f"elsewhere-specialist-{domain}-v1", mock=mock_fn,
        max_output_tokens=8000,
    )


async def ground_fact(llm: LLM, reg: Registry, question: str, branch: str) -> dict[str, Any]:
    r = await llm.ground(agent=f"grounding_{branch}", question=question, mock=lambda: mock.ground(question))
    prefix = branch if branch in ("A", "B") else "S"
    if r.searched and r.citations:
        eid = reg.evidence(prefix, "FACT", "web", "evidence-resolver", f"{question}: {r.text}", "high",
                           model_id=_s().specialist_model, citation=ground_citation(r.citations[0]))
    else:
        eid = reg.evidence(prefix, "INFERENCE", "model", "evidence-resolver", f"{question}: {r.text}", "low", model_id=_s().specialist_model)
    return {"evidence_id": eid, "answer": r.text, "searched": r.searched, "citations": r.citations[:3], "question": question, "branch": branch}


# ------------------------------------------------------------------ simulate

ORCH_TOOLS = [
    {
        "type": "function", "name": "run_specialist", "strict": True,
        "description": "Run one specialist agent (Muse Spark) for one domain in one branch. Returns its structured output.",
        "parameters": {
            "type": "object", "additionalProperties": False, "required": ["domain", "branch", "focus"],
            "properties": {
                "domain": {"type": "string", "enum": ["career", "finance", "lifestyle", "risk", "values"]},
                "branch": {"type": "string", "enum": ["A", "B"]},
                "focus": {"type": "string", "description": "What this specialist should pay most attention to for this decision"},
            },
        },
    },
    {
        "type": "function", "name": "ground_fact", "strict": True,
        "description": "Look up one current public fact with web search. One narrow question.",
        "parameters": {
            "type": "object", "additionalProperties": False, "required": ["question", "branch"],
            "properties": {
                "question": {"type": "string"},
                "branch": {"type": "string", "enum": ["A", "B", "shared"]},
            },
        },
    },
]


async def simulate(llm: LLM, sim: Simulation, emit: Emit) -> Simulation:
    s = _s()
    spec = sim.decision
    sim.evidence, sim.events, sim.shocks, sim.checks = [], [], [], []
    sim.version = 1
    reg = Registry(sim)
    user_ids = seed_user_evidence(reg, spec)
    for b in ("A", "B"):
        p = path_of(spec, b)
        bw = BranchWorld(branch=b, label=p.label, persona=Persona(name=f"Future {b}", voice="", temperament=""),
                         finance_inputs=initial_finance(spec, b), snapshots=blank_snapshots())
        if p.city:
            bw.snap("m0").location.city = Claim(text=p.city, evidence_id=user_ids.get(f"city_{b}"), status="known")
        sim.branches[b] = bw

    results: dict[tuple[str, str], SpecialistOutput] = {}
    grounded: list[dict[str, Any]] = []
    started: set[tuple[str, str]] = set()

    async def specialist_job(domain: str, branch: str, focus: str) -> dict[str, Any]:
        key = (domain, branch)
        if key in started:
            return {"note": "already running"}
        started.add(key)
        await emit("agent_started", {"agent": domain, "branch": branch, "model": s.specialist_model})
        out = await run_specialist(llm, sim, domain, branch, focus)
        results[key] = out
        await emit("agent_done", {"agent": domain, "branch": branch, "model": s.specialist_model, "summary": out.summary[:160]})
        return out.model_dump()

    async def run_tool(name: str, args: dict[str, Any]) -> Any:
        if name == "run_specialist":
            return await specialist_job(args["domain"], args["branch"], args.get("focus", ""))
        if name == "ground_fact":
            await emit("agent_started", {"agent": "evidence", "branch": args.get("branch", "shared"), "model": f"{s.specialist_model} + web_search"})
            g = await ground_fact(llm, reg, args["question"], args.get("branch", "shared"))
            grounded.append(g)
            await emit("agent_done", {"agent": "evidence", "branch": g["branch"], "model": f"{s.specialist_model} + web_search",
                                      "summary": ("Grounded: " if g["searched"] else "Not found, kept as inference: ") + g["question"][:100]})
            return g
        return {"error": f"unknown tool {name}"}

    await emit("agent_started", {"agent": "orchestrator", "branch": "both", "model": s.orchestrator_model, "summary": "Planning both worlds"})
    prev_id = await llm.tool_loop(
        agent="orchestrator_plan", model=s.orchestrator_model, instructions=system("orchestrator"),
        input=f"DECISION:\n{spec.model_dump_json(indent=1, exclude={'clarifying_questions'})}",
        tools=ORCH_TOOLS, run_tool=run_tool, effort="high", mock_calls=lambda: mock.plan_calls(spec),
    )
    await emit("agent_done", {"agent": "orchestrator", "branch": "both", "model": s.orchestrator_model, "summary": "Delegation finished"})

    # Wonder decides the plan, but every domain must exist before we can render a world.
    missing = [(d, b) for b in ("A", "B") for d in ("career", "finance", "lifestyle", "risk", "values") if (d, b) not in results]
    if missing:
        await asyncio.gather(*(specialist_job(d, b, "Cover the essentials for this domain.") for d, b in missing))

    # ---- compile
    await emit("agent_started", {"agent": "compiler", "branch": "both", "model": "code", "summary": "Compiling WorldState"})
    for b in ("A", "B"):
        bw = sim.branches[b]
        fo = results[("finance", b)]
        fi = bw.finance_inputs
        if isinstance(fo, FinanceOutput):
            fi.effective_tax_rate = fo.effective_tax_rate
            fi.annual_housing_low, fi.annual_housing_high = min(fo.annual_housing_low, fo.annual_housing_high), max(fo.annual_housing_low, fo.annual_housing_high)
            fi.annual_other_costs = fo.annual_other_costs
            fi.raise_pct_per_year = fo.raise_pct_per_year
            if not path_of(spec, b).annual_pay_usd:
                fi.annual_pay = fo.annual_pay_if_unknown
            if fo.planned_pay_segments:
                segs = sorted(fo.planned_pay_segments, key=lambda x: x.start_month)
                fi.pay_segments = [PaySegment(**x.model_dump()) for x in segs]
                if path_of(spec, b).annual_pay_usd and segs[0].start_month == 0 and segs[0].annual_pay > 0:
                    fi.pay_segments[0].annual_pay = path_of(spec, b).annual_pay_usd  # the user's number wins
                    fi.pay_segments[0].label = "base pay"
            fi.one_time_costs = [OneTimeCost(month=c.month, amount=c.amount, label=c.label) for c in fo.planned_costs]
        housing_ev = None
        for g in grounded:
            if g["branch"] == b and re.search(r"rent|housing|apartment", g["question"], re.I):
                rng = _num_from_grounding(g["answer"])
                if rng and g["searched"]:
                    lo, hi = rng
                    if hi - lo < 1000:
                        lo, hi = lo * 0.9, hi * 1.1
                    fi.annual_housing_low, fi.annual_housing_high = lo, hi
                housing_ev = g["evidence_id"]
        if spec.current.monthly_expenses_usd:
            fi.annual_other_costs = spec.current.monthly_expenses_usd * 12 * LIVING_COST_SHARE
            reg.evidence(b, "INFERENCE", "engine", "finance-engine",
                         f"Non-housing living costs assumed to be {int(LIVING_COST_SHARE * 100)}% of your stated monthly spending.", "medium")
        if not housing_ev:
            housing_ev = reg.evidence(b, "INFERENCE", "model", "finance", f"Typical housing cost in {path_of(spec, b).city or 'this city'} (estimate).", "low", model_id=s.specialist_model)
        for d in ("career", "finance", "lifestyle", "risk", "values"):
            apply_specialist(reg, bw, d, results[(d, b)], s.specialist_model)
        apply_finance(reg, bw, user_ids.get(f"pay_{b}"), housing_ev)
    await emit("agent_done", {"agent": "compiler", "branch": "both", "model": "code", "summary": f"{len(sim.evidence)} evidence items, {len(sim.events)} events"})

    # ---- reconcile (Wonder, continuing the delegation conversation when live)
    await emit("agent_started", {"agent": "reconcile", "branch": "both", "model": s.orchestrator_model, "summary": "Reconciling both worlds"})
    recon = await llm.structured(
        agent="orchestrator_reconcile", model=s.orchestrator_model, instructions=system("reconcile"),
        input=f"COMPILED WORLDS:\n{world_text(sim, 'A')}\n\n{world_text(sim, 'B')}\n\nUSER PRIORITIES: {spec.priorities.model_dump_json()}",
        schema=Reconciliation, effort="high", mock=lambda: mock.reconcile(spec), previous_response_id=prev_id,
        max_output_tokens=16000,
    )
    apply_reconciliation(sim, recon)
    await emit("agent_done", {"agent": "reconcile", "branch": "both", "model": s.orchestrator_model, "summary": recon.comparison.summary[:160]})

    for bw in sim.branches.values():
        carry_forward(bw)
    index_events(sim)

    # ---- checks
    await emit("agent_started", {"agent": "consistency", "branch": "both", "model": s.specialist_model, "summary": "Checking both worlds"})
    checks = invariants.run_all(sim)
    report = await llm.structured(
        agent="consistency", model=s.specialist_model, instructions=system("consistency"),
        input=f"{world_text(sim, 'A')}\n\n{world_text(sim, 'B')}", schema=ConsistencyReport, effort="low",
        cache_key="elsewhere-consistency-v1", mock=mock.consistency, max_output_tokens=6000,
    )
    repaired = apply_repairs(sim, reg, report)
    checks.append(CheckResult(name="Story holds together", passed=True, repaired=repaired, detail=report.overall))
    sim.checks = checks
    await emit("agent_done", {"agent": "consistency", "branch": "both", "model": s.specialist_model,
                              "summary": f"{sum(c.repaired for c in checks)} repairs, {sum(1 for c in checks if c.passed)}/{len(checks)} checks passed"})
    sim.status = "ready"
    return sim


def apply_reconciliation(sim: Simulation, recon: Reconciliation) -> None:
    for r in recon.branches:
        if r.branch not in sim.branches:
            continue
        bw = sim.branches[r.branch]
        bw.summary, bw.top_tradeoffs, bw.confidence = r.summary, r.top_tradeoffs[:3], r.confidence
        bw.persona = Persona(name=f"Future {r.branch}", voice=r.persona.voice, temperament=r.persona.temperament)
        for h in r.headlines:
            bw.snap(h.timepoint).headline = h.headline
        drop = {t.strip().lower() for t in r.drop_event_titles}
        if drop:
            sim.events = [e for e in sim.events if not (e.branch == r.branch and e.title.strip().lower() in drop)]
    sim.comparison = recon.comparison
    sim.suggested_shocks = recon.suggested_shocks[:3]


def apply_repairs(sim: Simulation, reg: Registry, report: ConsistencyReport) -> int:
    n = 0
    for issue in report.issues:
        if issue.branch not in sim.branches or issue.field not in ALL_FIELDS or issue.field in ENGINE_FIELDS:
            continue
        eid = reg.evidence(issue.branch, "INFERENCE", "model", "consistency", f"Repaired: {issue.problem}", "medium", model_id=_s().specialist_model)
        sim.branches[issue.branch].snap(issue.timepoint).set(issue.field, Claim(text=issue.fixed_text, evidence_id=eid, status="known"))
        n += 1
    return n


# ------------------------------------------------------------------ shocks

async def shock(llm: LLM, sim: Simulation, label: str, description: str, month: int, emit: Emit) -> ShockRecord:
    s = _s()
    spec = sim.decision
    before = {b: bw.model_copy(deep=True) for b, bw in sim.branches.items()}
    from_version = sim.version
    sim.version += 1
    reg = Registry(sim)
    shock_id = f"S-{len(sim.shocks) + 1:02d}"

    await emit("agent_started", {"agent": "shock_planner", "branch": "both", "model": s.orchestrator_model, "summary": f"Planning: {label}"})
    plan = await llm.structured(
        agent="shock_planner", model=s.orchestrator_model, instructions=system("shock_planner"),
        input=f"SHOCK: {label}. {description} (around month {month})\n\n{world_text(sim, 'A')}\n\n{world_text(sim, 'B')}",
        schema=ShockPlan, effort="medium", mock=lambda: mock.shock_plan(spec, label, description, month),
        max_output_tokens=12000,
    )
    month = plan.month
    await emit("agent_done", {"agent": "shock_planner", "branch": "both", "model": s.orchestrator_model,
                              "summary": "Reaches " + (", ".join(f"Path {bp.branch}" for bp in plan.branches if bp.applies) or "neither path")})

    record = ShockRecord(id=shock_id, label=label, description=description, month=month,
                         applies_to=[bp.branch for bp in plan.branches if bp.applies], from_version=from_version, to_version=sim.version)
    for a in plan.assumptions:
        reg.evidence("U", "ASSUMPTION", "user", "shock", f"For “{label}”: {a}", "medium")

    entry_by_branch: dict[str, list[str]] = {}
    new_events: dict[str, list[str]] = {}
    jobs = []
    for bp in plan.branches:
        if bp.branch not in sim.branches:
            continue
        if not bp.applies:
            record.not_applied_because[bp.branch] = bp.why
            continue
        bw = sim.branches[bp.branch]
        sev = reg.evidence(bp.branch, "ASSUMPTION", "user", "shock", f"You applied a shock: {label}. {description}", "high")
        ids = [reg.event(bp.branch, e.month, "shock", e.title, e.detail, [shock_id], sev) for e in sorted(bp.new_events, key=lambda e: e.month)]
        new_events[bp.branch] = ids
        entry: list[str] = []
        for ch in bp.entry_changes:
            if ch.field not in ALL_FIELDS or ch.field in ENGINE_FIELDS:
                continue
            entry.append(ch.field)
            for tp in TIMEPOINTS:
                if TIMEPOINT_MONTHS[tp] >= month:
                    bw.snap(tp).set(ch.field, Claim(text=ch.text, evidence_id=sev, status="known"))
        fi = bw.finance_inputs
        if bp.pay_segments_from_shock:
            from ..engine import finance as fin

            kept = []
            for seg in fin.segments(fi):
                if seg.start_month >= month:
                    continue
                end = month if seg.end_month is None or seg.end_month > month else seg.end_month
                kept.append(PaySegment(start_month=seg.start_month, end_month=end, annual_pay=seg.annual_pay, label=seg.label))
            fi.pay_segments = kept + [PaySegment(**p.model_dump()) for p in bp.pay_segments_from_shock]
            entry.append("finance.salary")
        if bp.one_time_cost:
            fi.one_time_costs.append(OneTimeCost(month=month, amount=bp.one_time_cost, label=label))
            entry.append("finance.savings")
        if bp.equity_to_zero:
            # Keep fi.equity_note: months before the shock still had equity. History is never rewritten.
            entry.append("finance.equity_value")
            for tp in TIMEPOINTS:
                if TIMEPOINT_MONTHS[tp] >= month:
                    bw.snap(tp).finance.equity_value = Claim(text="Worth $0", range=Range(low=0, high=0, unit="usd"), evidence_id=sev, status="known")
        entry_by_branch[bp.branch] = entry
        affected = {f.split(".")[0] for f in downstream(entry)}
        domains = [d for d in ("career", "lifestyle", "risk", "values") if d in bp.affected_domains or (d if d != "values" else "values_fit") in affected]
        ctx = load_prompt("shock_recompute").format(shock_label=label, month=str(month), shock_detail=description,
                                                    events="; ".join(f"month {e.month}: {e.title}" for e in bp.new_events))
        for d in domains:
            jobs.append((bp, d, ctx, ids, sev))

    async def recompute(bp: BranchShockPlan, d: str, ctx: str, ids: list[str], sev: str) -> None:
        await emit("agent_started", {"agent": d, "branch": bp.branch, "model": s.specialist_model, "summary": "Recomputing after shock"})
        out = await run_specialist(llm, sim, d, bp.branch, f"How {label} changes this domain.", shock_ctx=ctx, shock_plan=bp, shock_month=month)
        apply_specialist(reg, sim.branches[bp.branch], d, out, s.specialist_model, caused_by=ids[:1], only_after_month=month, event_kind="turning_point")
        await emit("agent_done", {"agent": d, "branch": bp.branch, "model": s.specialist_model, "summary": out.summary[:160]})

    await asyncio.gather(*(recompute(*j) for j in jobs))

    for b, bw in sim.branches.items():
        apply_finance(reg, bw, next((e.id for e in sim.evidence if e.text.startswith(f"Path {b} pays")), None),
                      bw.snap("m0").finance.housing_cost.evidence_id)
        carry_forward(bw)
    index_events(sim)
    sim.checks = invariants.run_all(sim) + [c for c in sim.checks if c.name == "Story holds together"]

    for b in record.applies_to:
        record.changes += diffing.branch_diff(before[b], sim.branches[b], shock_id, entry_by_branch.get(b, []), new_events.get(b, []))

    await emit("agent_started", {"agent": "front_pages", "branch": "both", "model": s.specialist_model, "summary": "Writing the year-2 front pages"})
    applies = {b: b in record.applies_to for b in ("A", "B")}
    biggest = {}
    for b in record.applies_to:
        ch = next((c for c in record.changes if c.branch == b and c.field == "finance.savings" and c.timepoint == "m24"), None) \
            or next((c for c in record.changes if c.branch == b), None)
        if ch:
            chain = [FIELD_NAMES.get(x, x.split(".")[-1]) for x in ch.because[1:] if not x.startswith("E-") and x != ch.field]
            biggest[b] = (f"{label} → " + "".join(f"{c} changed → " for c in chain)
                          + f"{FIELD_NAMES.get(ch.field, ch.field)} at {TP_WORDS[ch.timepoint]}: {ch.before} → {ch.after}.")
    diff_text = "\n".join(f"{c.branch} {c.timepoint} {c.field}: {c.before} -> {c.after} (because {' > '.join(c.because)})" for c in record.changes[:40])
    pages = await llm.structured(
        agent="front_pages", model=s.specialist_model, instructions=system("front_pages"),
        input=f"SHOCK: {label}. {description} at month {month}\nREACHES: {record.applies_to}\nNOT REACHED BECAUSE: {record.not_applied_because}\n\n"
              f"DIFF:\n{diff_text or '(no changes)'}\n\n{world_text(sim, 'A', ['m24'])}\n\n{world_text(sim, 'B', ['m24'])}",
        schema=FrontPagesOut, effort="low", mock=lambda: mock.front_pages(sim, label, applies, biggest),
        max_output_tokens=4000,
    )
    record.front_pages = pages.pages
    record.verdict = pages.verdict
    for h in pages.headlines:
        if h.branch in record.applies_to and TIMEPOINT_MONTHS[h.timepoint] >= month:
            sim.branches[h.branch].snap(h.timepoint).headline = h.headline
    sim.shocks.append(record)
    await emit("agent_done", {"agent": "front_pages", "branch": "both", "model": s.specialist_model, "summary": pages.verdict.why[:160]})
    return record


# ------------------------------------------------------------------ assumptions (no model call)

def edit_assumptions(sim: Simulation, branch: str, edits: dict[str, float]) -> Simulation:
    """Deterministic recompute after the user drags an assumption (idea 4)."""
    reg = Registry(sim)
    bw = sim.branches[branch]
    fi = bw.finance_inputs
    notes = []
    if "job_search_months" in edits:
        gap = max(0, int(edits["job_search_months"]))
        for i, seg in enumerate(fi.pay_segments):
            if seg.annual_pay == 0 and seg.end_month is not None and i + 1 < len(fi.pay_segments):
                seg.end_month = seg.start_month + gap
                fi.pay_segments[i + 1].start_month = seg.end_month
                notes.append(f"job search {gap} months")
                break
    if "next_pay" in edits and fi.pay_segments:
        fi.pay_segments[-1].annual_pay = edits["next_pay"]
        notes.append(f"next role pays ${edits['next_pay']:,.0f}")
    if "annual_housing" in edits:
        mid = edits["annual_housing"]
        fi.annual_housing_low, fi.annual_housing_high = mid * 0.9, mid * 1.1
        notes.append(f"housing about ${mid:,.0f} a year")
    if "start_savings" in edits:
        fi.start_savings = edits["start_savings"]
        notes.append(f"starting savings ${edits['start_savings']:,.0f}")
    if "effective_tax_rate" in edits:
        fi.effective_tax_rate = max(0.0, min(0.6, edits["effective_tax_rate"]))
        notes.append(f"tax rate {fi.effective_tax_rate:.0%}")
    sim.version += 1
    eid = reg.evidence("U", "ASSUMPTION", "user", "assumptions", f"You changed Path {branch}: {', '.join(notes) or 'no change'}.", "high")
    reg.event(branch, 0, "user_edit", "You changed an assumption", ", ".join(notes), [], eid)
    apply_finance(reg, bw, next((e.id for e in sim.evidence if e.text.startswith(f"Path {branch} pays")), None),
                  bw.snap("m0").finance.housing_cost.evidence_id)
    index_events(sim)
    sim.checks = invariants.run_all(sim) + [c for c in sim.checks if c.name == "Story holds together"]
    return sim
