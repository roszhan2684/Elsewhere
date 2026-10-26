"""Offline stand-in for Meta models, used when no MODEL_API_KEY is set (and in tests).

It produces plausible, *templated* outputs from the DecisionSpec so the whole product runs
end to end. It never creates FACTs: grounding returns searched=False, so every number is
stored as an INFERENCE, and the UI shows an "offline mock" badge.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .agents.schemas import (
    BranchRecon,
    BranchShockPlan,
    ConsistencyReport,
    EntryChange,
    EventDraft,
    EvidenceDraft,
    FieldPatch,
    FinanceOutput,
    FrontPagesOut,
    HeadlineDraft,
    PersonaDraft,
    PlannedCost,
    Reconciliation,
    ShockPaySegment,
    ShockHeadline,
    ShockPlan,
    SpecialistOutput,
)
from .contracts import (
    ClarifyingQuestion,
    Comparison,
    CurrentSituation,
    DecisionSpec,
    FrontPage,
    PathSpec,
    Priorities,
    ShockVerdict,
    Simulation,
    SuggestedShock,
)
from .llm import GroundingResult

CANONICAL = (
    "I'm deciding between joining a 7-person AI startup in San Francisco at $145K plus equity, "
    "or taking a stable software engineering role in Seattle at $180K. I care most about learning "
    "and ownership, but I also want financial stability. I have about $40K saved and spend around "
    "$4,500 a month. I'm worried the startup could fail."
)

CITIES = [
    "San Francisco", "Seattle", "New York", "Boston", "Austin", "Los Angeles", "Chicago", "Denver",
    "London", "Toronto", "Berlin", "Paris", "Bangalore", "Singapore", "Sydney", "Remote",
]
HOUSING = {  # rough built-in annual one-bedroom ranges, offline only, always labeled INFERENCE
    "San Francisco": (36000, 48000), "Seattle": (26000, 36000), "New York": (40000, 55000),
    "Boston": (32000, 42000), "Austin": (20000, 28000), "Los Angeles": (30000, 40000),
    "London": (26000, 36000), "Toronto": (24000, 32000),
}
TAX = {"San Francisco": 0.33, "Los Angeles": 0.33, "Seattle": 0.25, "Austin": 0.25, "New York": 0.35, "Boston": 0.31}


@dataclass
class Arc:
    roles: list[str]
    status: list[str]
    scope: list[str]
    skills: list[str]
    hours: tuple[int, int]
    stress: list[str]
    scores: dict[str, int]
    security: str
    reversibility: str
    downside: str
    equity: str
    events: list[tuple[int, str, str]]
    voice: str
    temperament: str
    raise_pct: float


ARCS: dict[str, Arc] = {
    "startup": Arc(
        roles=["Early engineer, everything is new", "Owns a product area", "Leads a team of four", "Senior leader or next founder"],
        status=["employed", "employed", "employed", "employed"],
        scope=["Wide and unstructured", "Owns a core feature end to end", "Hiring and shipping a roadmap", "Sets direction for a team"],
        skills=["Learning the stack and the customers", "Shipping fast, talking to users", "Hiring, prioritising, managing", "Leadership across product and engineering"],
        hours=(50, 60), stress=["medium", "high", "high", "medium"],
        scores={"learning": 5, "stability": 2, "ownership": 5, "location": 4, "autonomy": 4},
        security="Low: depends on the company's next raise", reversibility="High: big-company roles stay open to you",
        downside="Company fails and equity goes to zero", equity="Paper equity; likely worth $0 unless the company exits",
        events=[(4, "Shipped first product to paying customers", "The first customers sign on."),
                (9, "Made first hire", "You interview and hire the team's next engineer."),
                (30, "Company reached a make-or-break funding round", "The next raise decides the company's runway.")],
        voice="Fast, a little wired, laughs at their own chaos.",
        temperament="Energised and stretched thin; proud of what they've built, watching the runway.",
        raise_pct=0.04,
    ),
    "established_company": Arc(
        roles=["New-hire engineer", "Fully ramped on the team", "Senior engineer", "Senior or staff engineer"],
        status=["employed", "employed", "employed", "employed"],
        scope=["One well-defined area", "Owns a service", "Leads projects within the team", "Leads cross-team work"],
        skills=["Learning internal systems", "Deep in one stack", "Technical leadership on projects", "Specialist with a clear niche"],
        hours=(40, 45), stress=["medium", "low", "low", "medium"],
        scores={"learning": 3, "stability": 5, "ownership": 2, "location": 3, "autonomy": 3},
        security="High: steady company, clear ladder", reversibility="Medium: startup moves get harder with a higher salary",
        downside="Slower learning curve; feeling of a road not taken", equity="Public stock grants vest on schedule",
        events=[(6, "Finished first performance cycle", "Solid review; settled into the team."),
                (14, "Promoted to senior engineer", "Promotion with a raise."),
                (40, "Led a cross-team project", "First project spanning several teams.")],
        voice="Calm, measured, a bit wistful.",
        temperament="Comfortable and secure; sometimes wonders what they'd have learned elsewhere.",
        raise_pct=0.05,
    ),
    "school": Arc(
        roles=["Full-time student", "Student, deep in coursework", "Graduated; first role after the degree", "Specialist in their field"],
        status=["studying", "studying", "employed", "employed"],
        scope=["Coursework and research", "Thesis or capstone underway", "Entry role at a higher level", "Recognised specialist"],
        skills=["Foundations and theory", "Research methods", "Applied specialism", "Deep expertise"],
        hours=(45, 55), stress=["medium", "high", "medium", "low"],
        scores={"learning": 5, "stability": 3, "ownership": 3, "location": 3, "autonomy": 3},
        security="Medium: depends on the job market at graduation", reversibility="High: industry roles remain open",
        downside="Two years of lost income and tuition costs", equity="None",
        events=[(8, "Joined a research group", "A faculty member takes you on."),
                (22, "Graduated", "Degree finished; job search begins."),
                (25, "Started first post-degree role", "Higher starting level than before.")],
        voice="Curious, a little academic, enthusiastic about ideas.",
        temperament="Stimulated but impatient to earn again.",
        raise_pct=0.04,
    ),
    "self_employed": Arc(
        roles=["Solo founder building the product", "Founder with early users", "Founder with small revenue", "Running a small company or back in a job"],
        status=["founder", "founder", "founder", "founder"],
        scope=["Everything", "Product, sales and support", "First contractor, first customers", "Small team or a clear exit"],
        skills=["Building and selling", "Talking to users daily", "Pricing, sales, hiring", "Running a business"],
        hours=(50, 65), stress=["high", "high", "medium", "medium"],
        scores={"learning": 5, "stability": 1, "ownership": 5, "location": 4, "autonomy": 5},
        security="Low: income depends on the product", reversibility="High: employment stays open",
        downside="Savings run out before revenue arrives", equity="You own most of it; value unknown",
        events=[(3, "Launched to first users", "A first version goes live."),
                (10, "First paying customer", "Someone pays."),
                (24, "Decided to keep going or return to a job", "Revenue decides it.")],
        voice="Restless, candid, optimistic in a tired way.",
        temperament="Free and anxious at the same time.",
        raise_pct=0.0,
    ),
}
ARCS["other"] = ARCS["established_company"]


# ------------------------------------------------------------------ intake

def _amounts(text: str) -> list[float]:
    out = []
    for m in re.finditer(r"\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|K|thousand)?", text):
        raw, k = m.group(1), m.group(2)
        try:
            v = float(raw.replace(",", ""))
        except ValueError:
            continue
        if k:
            v *= 1000
        out.append(v)
    return out


def _org_type(text: str) -> str:
    t = text.lower()
    if re.search(r"start ?up|seed|founding", t):
        return "startup"
    if re.search(r"grad school|master|phd|mba|degree|university|scholarship", t):
        return "school"
    if re.search(r"my own|start a product|freelanc|indie|bootstrap|start a company", t):
        return "self_employed"
    if re.search(r"stable|big ?co|corporate|established|bank|google|microsoft|amazon|meta|apple|full-time|\bjob\b|stay", t):
        return "established_company"
    return "other"


def _city(text: str) -> str | None:
    for c in CITIES:
        if c.lower() in text.lower():
            return c
    if re.search(r"\bSF\b", text):
        return "San Francisco"
    if re.search(r"\bNYC\b", text):
        return "New York"
    return None


def intake(text: str) -> DecisionSpec:
    body = text.strip() or CANONICAL
    parts = re.split(r"\bor\b|\bvs\.?\b|\bversus\b", body, maxsplit=1, flags=re.I)
    a_txt, b_txt = (parts + [""])[:2]
    b_txt = re.split(r"\.\s", b_txt, maxsplit=1)[0] if b_txt else b_txt

    def path(seg: str, fallback: str) -> PathSpec:
        org = _org_type(seg)
        city = _city(seg)
        pays = [v for v in _amounts(seg) if 20000 <= v <= 1_000_000]
        role = "Software engineer" if re.search(r"engineer|software|developer|code", seg, re.I) else None
        nice = {"startup": "Startup", "established_company": "Stable job", "school": "Grad school",
                "self_employed": "Own product", "other": fallback}[org]
        return PathSpec(
            label=f"{nice}{' in ' + city if city else ''}",
            city=city, role=role, org_type=org,  # type: ignore[arg-type]
            annual_pay_usd=pays[0] if pays else None,
            equity="equity" if re.search(r"equity|options|shares", seg, re.I) else None,
            notes=seg.strip()[:200],
        )

    a, b = path(a_txt, "Option A"), path(b_txt, "Option B")
    for x, y in ((a, b), (b, a)):  # "quit my job or stay in New York": same city for both
        if x.city is None and y.city:
            x.city = y.city
            x.label = f"{x.label} in {y.city}"
    savings = None
    m = re.search(r"\$?(\d[\d,]*\s?[kK]?)\s*(?:saved|in savings|of savings)", body)
    if m:
        vals = _amounts(m.group(1))
        savings = vals[0] if vals else None
    expenses = None
    m = re.search(r"(?:spend|expenses?)[^.$]*\$?(\d[\d,]*\s?[kK]?)\s*(?:a|per)\s*month", body, re.I)
    if m:
        vals = _amounts(m.group(1))
        expenses = vals[0] if vals else None
    low = body.lower()
    pri = Priorities(
        learning=5 if "learn" in low else 3,
        stability=4 if re.search(r"stab|secur|safe", low) else 3,
        ownership=4 if re.search(r"owner|equity|own ", low) else 3,
        location=3, autonomy=4 if "autonom" in low or "freedom" in low else 3,
    )
    qs: list[ClarifyingQuestion] = []
    if savings is None:
        qs.append(ClarifyingQuestion(id="q1", text="Roughly how much do you have saved right now?", why="Savings decide how long you can absorb a bad surprise."))
    if expenses is None:
        qs.append(ClarifyingQuestion(id="q2", text="About how much do you spend in a typical month?", why="Monthly costs set your runway in both worlds."))
    if a.annual_pay_usd is None or b.annual_pay_usd is None:
        qs.append(ClarifyingQuestion(id="q3", text="What does each option pay per year?", why="Pay is the biggest driver of the money picture."))
    def nick(p: PathSpec) -> str:
        return f"{p.label.split(' in ')[0]}{' ' + _short(p.city) if p.city else ''}"

    title = f"{nick(a)} vs {nick(b)}"
    if len(title) > 40:
        title = f"{a.label.split(' in ')[0]} vs {b.label.split(' in ')[0]}"
    return DecisionSpec(
        title=title[:40],
        question=body.split(".")[0][:200],
        path_a=a, path_b=b, priorities=pri,
        goals=[g for g in ["Keep learning fast" if pri.learning >= 4 else "", "Have real ownership" if pri.ownership >= 4 else "", "Stay financially stable" if pri.stability >= 4 else ""] if g],
        fears=["The startup could fail"] if "fail" in low else [],
        constraints=[sent.strip() for sent in re.split(r"(?<=[.!?])\s+", body) if re.search(r"tuition|visa|relocat|family", sent, re.I)][:3],
        current=CurrentSituation(city=None, profession="Software engineer" if "engineer" in low else None, age_band=None, savings_usd=savings, monthly_expenses_usd=expenses),
        clarifying_questions=qs[:3],
    )


def _short(city: str | None) -> str:
    return {"San Francisco": "SF", "New York": "NYC", "Los Angeles": "LA"}.get(city or "", city or "")


def apply_answers(spec: DecisionSpec, answers: dict[str, str]) -> DecisionSpec:
    s = spec.model_copy(deep=True)
    for qid, ans in answers.items():
        vals = _amounts(ans)
        if qid == "q1" and vals:
            s.current.savings_usd = vals[0]
        elif qid == "q2" and vals:
            s.current.monthly_expenses_usd = vals[0]
        elif qid == "q3" and vals:
            if s.path_a.annual_pay_usd is None:
                s.path_a.annual_pay_usd = vals[0]
            if s.path_b.annual_pay_usd is None and len(vals) > 1:
                s.path_b.annual_pay_usd = vals[1]
    s.clarifying_questions = []
    return s


# ------------------------------------------------------------------ simulation

def _path(spec: DecisionSpec, branch: str) -> PathSpec:
    return spec.path_a if branch == "A" else spec.path_b


def _arc(spec: DecisionSpec, branch: str) -> Arc:
    return ARCS[_path(spec, branch).org_type]


def specialist(spec: DecisionSpec, domain: str, branch: str, user_ids: dict[str, str]) -> SpecialistOutput:
    arc, p = _arc(spec, branch), _path(spec, branch)
    city = p.city or "your city"
    tps = ["m0", "m6", "m24", "m60"]
    patches: list[FieldPatch] = []
    ev: list[EvidenceDraft] = []

    def fp(tp: str, field: str, text: str, low=None, high=None, unit="none", evidence="new:0") -> FieldPatch:
        return FieldPatch(timepoint=tp, field=field, text=text, low=low, high=high, unit=unit, evidence=evidence)  # type: ignore[arg-type]

    if domain == "career":
        ev = [EvidenceDraft(text=f"Typical progression for a {p.role or 'engineer'} at a {p.org_type.replace('_', ' ')}.", confidence="medium"),
              EvidenceDraft(text=f"Professional network grows around {city}.", confidence="low")]
        for i, tp in enumerate(tps):
            patches += [fp(tp, "career.role", arc.roles[i]), fp(tp, "career.employment_status", arc.status[i]),
                        fp(tp, "career.scope", arc.scope[i]), fp(tp, "career.skills", arc.skills[i])]
        patches += [fp("m24", "career.network", f"Dense network in {city}", evidence="new:1"),
                    fp("m24", "career.optionality", "High" if arc.scores["learning"] >= 4 else "Medium")]
        events = [EventDraft(month=m, title=t, detail=d) for m, t, d in arc.events]
        return SpecialistOutput(summary=f"Career in Path {branch} follows a {p.org_type.replace('_', ' ')} arc.", field_patches=patches, evidence=ev,
                                events=events, risks=[arc.downside], opportunities=[arc.skills[2]], confidence="medium", unresolved_questions=[])
    if domain == "lifestyle":
        ev = [EvidenceDraft(text=f"Hours and stress typical of a {p.org_type.replace('_', ' ')} role.", confidence="low")]
        for i, tp in enumerate(tps):
            patches += [fp(tp, "lifestyle.work_hours", f"{arc.hours[0]}–{arc.hours[1]} hours a week", arc.hours[0], arc.hours[1], "hours_per_week"),
                        fp(tp, "lifestyle.stress", arc.stress[i].capitalize())]
        patches += [fp("m0", "lifestyle.flexibility", "Low" if arc.hours[1] > 55 else "Medium"),
                    fp("m0", "lifestyle.social_support", "Building from scratch" if p.city and p.city != spec.current.city else "Existing friends nearby"),
                    fp("m0", "location.commute", "Short, mostly in office" if p.org_type == "startup" else "Hybrid, 2–3 office days"),
                    fp("m0", "location.support_network", f"New in {city}" if p.city else "Unknown")]
        return SpecialistOutput(summary="Lifestyle inferred from role type.", field_patches=patches, evidence=ev, events=[], risks=[], opportunities=[], confidence="low", unresolved_questions=[])
    if domain == "risk":
        ev = [EvidenceDraft(text=f"Risk profile of a {p.org_type.replace('_', ' ')} path.", confidence="medium")]
        patches = [fp("m0", "risk.job_security", arc.security), fp("m0", "risk.reversibility", arc.reversibility), fp("m0", "risk.downside", arc.downside)]
        return SpecialistOutput(summary="Risk follows the company type.", field_patches=patches, evidence=ev, events=[], risks=[arc.downside], opportunities=[], confidence="medium", unresolved_questions=[])
    if domain == "values":
        ev = [EvidenceDraft(text="Scored against the priorities you gave.", confidence="medium")]
        pri = spec.priorities.model_dump()
        for k, v in arc.scores.items():
            patches.append(fp("m24", f"values_fit.{k}", f"{v}/5 (you weighted it {pri[k]}/5)", v, v, "score_1_5",
                              evidence=user_ids.get("priorities", "new:0")))
        return SpecialistOutput(summary="Values fit scored.", field_patches=patches, evidence=ev, events=[], risks=[], opportunities=[], confidence="medium", unresolved_questions=[])
    raise ValueError(domain)


def finance(spec: DecisionSpec, branch: str) -> FinanceOutput:
    arc, p = _arc(spec, branch), _path(spec, branch)
    lo, hi = HOUSING.get(p.city or "", (20000, 30000))
    patches = [FieldPatch(timepoint="m0", field="finance.equity_value", text=arc.equity, low=None, high=None, unit="none", evidence="new:0")]
    return FinanceOutput(
        summary="Finance inputs proposed.", field_patches=patches,
        evidence=[EvidenceDraft(text=f"Equity at a {p.org_type.replace('_', ' ')} is illiquid until an exit.", confidence="medium")],
        events=[], risks=[], opportunities=[], confidence="medium", unresolved_questions=[],
        effective_tax_rate=TAX.get(p.city or "", 0.28), annual_housing_low=lo, annual_housing_high=hi,
        annual_other_costs=24000, raise_pct_per_year=arc.raise_pct,
        annual_pay_if_unknown=0 if p.org_type in ("school", "self_employed") else 120000,
        planned_pay_segments=_planned_pay(spec, p),
        planned_costs=_planned_costs(spec, p),
    )


def _planned_pay(spec: DecisionSpec, p: PathSpec) -> list[ShockPaySegment]:
    if p.org_type == "school":
        return [ShockPaySegment(start_month=0, end_month=24, annual_pay=0, label="studying"),
                ShockPaySegment(start_month=24, end_month=None, annual_pay=150000, label="first role after the degree")]
    return []


def _planned_costs(spec: DecisionSpec, p: PathSpec) -> list[PlannedCost]:
    if p.org_type != "school":
        return []
    tuition = next((v for c in spec.constraints if "tuition" in c.lower() for v in _amounts(c) if v >= 1000), None)
    if not tuition:
        return []
    return [PlannedCost(month=0, amount=tuition, label="tuition, year 1"), PlannedCost(month=12, amount=tuition, label="tuition, year 2")]


def ground(question: str) -> GroundingResult:
    return GroundingResult(text=f"Offline mock: not looked up ({question[:80]}). Using a rough built-in estimate.", citations=[], searched=False)


def plan_calls(spec: DecisionSpec) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []
    for b in ("A", "B"):
        p = _path(spec, b)
        if p.city:
            calls.append(("ground_fact", {"question": f"Typical annual rent for a one-bedroom apartment in {p.city}", "branch": b}))
    for b in ("A", "B"):
        for d in ("career", "finance", "lifestyle", "risk", "values"):
            calls.append(("run_specialist", {"domain": d, "branch": b, "focus": f"What changes most for this person in Path {b}."}))
    return calls


def reconcile(spec: DecisionSpec) -> Reconciliation:
    out = []
    for b in ("A", "B"):
        arc, p = _arc(spec, b), _path(spec, b)
        city = p.city or "this path"
        out.append(BranchRecon(
            branch=b,  # type: ignore[arg-type]
            summary=f"In Path {b} you {'join a small team and grow fast' if p.org_type == 'startup' else 'build steadily'} in {city}. {arc.downside} is the main risk.",
            top_tradeoffs=[f"More {'learning' if arc.scores['learning'] >= 4 else 'stability'}, less {'stability' if arc.scores['learning'] >= 4 else 'learning'}",
                           f"More {'ownership' if arc.scores['ownership'] >= 4 else 'predictability'}, less {'predictability' if arc.scores['ownership'] >= 4 else 'ownership'}",
                           f"Life built around {city}"],
            confidence="medium",
            persona=PersonaDraft(voice=arc.voice, temperament=arc.temperament),
            headlines=[HeadlineDraft(timepoint=tp, headline=h) for tp, h in zip(["m0", "m6", "m24", "m60"], [
                f"Day one: {arc.roles[0].lower()} in {city}", f"Six months in: {arc.roles[1].lower()}",
                f"Year two: {arc.roles[2].lower()}", f"Year five: {arc.roles[3].lower()}"])],
            drop_event_titles=[], conflicts_resolved=[],
        ))
    return Reconciliation(
        branches=out,
        comparison=Comparison(
            summary=f"Path A ({spec.path_a.label}) leans toward {', '.join(k for k, v in _arc(spec, 'A').scores.items() if v >= 4) or 'balance'}; "
                    f"Path B ({spec.path_b.label}) leans toward {', '.join(k for k, v in _arc(spec, 'B').scores.items() if v >= 4) or 'balance'}.",
            dominant_assumptions=["How long a job search takes if things go wrong", "Housing cost difference between the cities", "Whether equity ends up worth anything"],
            what_would_change_my_mind=["The startup's runway is shorter than 12 months", "The stable role offers a fast promotion track"],
        ),
        suggested_shocks=_suggest(spec),
    )


def _suggest(spec: DecisionSpec) -> list[SuggestedShock]:
    out = []
    for p in (spec.path_a, spec.path_b):
        if p.org_type == "startup":
            out.append(SuggestedShock(label="Startup fails at month 14", description="The company runs out of money and shuts down.", month=14))
        elif p.org_type == "school":
            out.append(SuggestedShock(label="Scholarship after 6 months", description="A scholarship covers the remaining tuition.", month=6))
        elif p.org_type == "self_employed":
            out.append(SuggestedShock(label="First 1,000 users early", description="Users arrive faster than expected.", month=5))
        else:
            out.append(SuggestedShock(label="Layoffs hit at month 18", description="The company cuts 10% of staff.", month=18))
    out.append(SuggestedShock(label="Family needs you nearby", description="A family situation makes living near home matter more.", month=20))
    return out[:3]


def consistency() -> ConsistencyReport:
    return ConsistencyReport(issues=[], overall="Both worlds hold together.")


# ------------------------------------------------------------------ shocks

def shock_plan(spec: DecisionSpec, label: str, description: str, month: int) -> ShockPlan:
    text = f"{label} {description}".lower()
    branches = []
    assumptions: list[str] = []
    for b in ("A", "B"):
        p = _path(spec, b)
        base = p.annual_pay_usd or 120000
        hit = False
        bp = BranchShockPlan(branch=b, applies=False, why="", entry_changes=[], new_events=[], pay_segments_from_shock=[],  # type: ignore[arg-type]
                             one_time_cost=None, equity_to_zero=False, affected_domains=[])
        if re.search(r"fail|shut|fold|bankrupt", text) and p.org_type in ("startup", "self_employed"):
            hit = True
            bp.entry_changes = [EntryChange(field="career.employment_status", text="searching"), EntryChange(field="finance.equity_value", text="Worth $0 after the shutdown")]
            bp.new_events = [EventDraft(month=month, title="Company shut down", detail="The money ran out."),
                             EventDraft(month=month + 3, title="Started a new role", detail="Landed a founding-engineer role after a three-month search.")]
            bp.pay_segments_from_shock = [ShockPaySegment(start_month=month, end_month=month + 3, annual_pay=0, label="job search"),
                                          ShockPaySegment(start_month=month + 3, end_month=None, annual_pay=round(base * 1.05, -3), label="next role")]
            bp.equity_to_zero = True
            bp.affected_domains = ["career", "lifestyle", "risk", "values"]
            assumptions = ["The job search takes about 3 months", "The next role pays about 5% more than the startup did"]
        elif re.search(r"layoff|laid off|fired|cut", text) and p.org_type in ("established_company", "other"):
            hit = True
            bp.entry_changes = [EntryChange(field="career.employment_status", text="searching")]
            bp.new_events = [EventDraft(month=month, title="Laid off in a reorg", detail="The team was cut."),
                             EventDraft(month=month + 2, title="Started a new role", detail="Found a similar role.")]
            bp.pay_segments_from_shock = [ShockPaySegment(start_month=month, end_month=month + 2, annual_pay=0, label="job search"),
                                          ShockPaySegment(start_month=month + 2, end_month=None, annual_pay=base, label="next role")]
            bp.affected_domains = ["career", "lifestyle", "risk"]
            assumptions = ["The job search takes about 2 months", "Severance is not counted"]
        elif re.search(r"scholarship", text) and p.org_type == "school":
            hit = True
            bp.new_events = [EventDraft(month=month, title="Won a scholarship", detail="Remaining tuition covered.")]
            bp.one_time_cost = -30000
            bp.affected_domains = ["risk", "values"]
            assumptions = ["The scholarship saves about $30K"]
        elif re.search(r"users|traction|revenue|funding|raise", text) and p.org_type in ("self_employed", "startup"):
            hit = True
            bp.entry_changes = [EntryChange(field="finance.equity_value", text="Equity worth more after strong traction")]
            bp.new_events = [EventDraft(month=month, title="Traction arrived early", detail="Growth beat the plan.")]
            bp.pay_segments_from_shock = [ShockPaySegment(start_month=month, end_month=None, annual_pay=round(base * 1.15, -3), label="raise after traction")]
            bp.affected_domains = ["career", "lifestyle", "risk", "values"]
            assumptions = ["Traction leads to a 15% pay increase"]
        elif re.search(r"family|move|relocat|home", text):
            hit = True
            bp.new_events = [EventDraft(month=month, title="Family needed you closer", detail="Trips home became frequent.")]
            bp.one_time_cost = 6000
            bp.affected_domains = ["lifestyle", "values"]
            assumptions = ["Travel and time off cost about $6K"]
        bp.applies = hit
        bp.why = "This shock reaches this world directly." if hit else f"This shock doesn't touch Path {b}: nothing in this world depends on it."
        branches.append(bp)
    return ShockPlan(month=month, label=label, branches=branches, assumptions=assumptions or ["No extra assumptions"])


def front_pages(sim: Simulation, shock_label: str, applies: dict[str, bool], biggest: dict[str, str]) -> FrontPagesOut:
    pages = []
    for b in ("A", "B"):
        bw = sim.branches[b]
        s24 = bw.snap("m24")
        if applies.get(b):
            pages.append(FrontPage(branch=b, headline=f"{shock_label}. By year two: {(s24.career.role.text or 'a new chapter').lower()}.",  # type: ignore[arg-type]
                                   deck=f"Savings at year two: {s24.finance.savings.text}. {bw.persona.temperament}",
                                   changed_because=biggest.get(b, "The shock changed this world's income."), unchanged=False))
        else:
            pages.append(FrontPage(branch=b, headline=f"Year two: {(s24.career.role.text or 'steady').lower()}.",  # type: ignore[arg-type]
                                   deck=f"Savings at year two: {s24.finance.savings.text}.",
                                   changed_because="This shock happens somewhere this world never went.", unchanged=True))
    hit = [b for b, v in applies.items() if v]
    robust = "tie" if len(hit) != 1 else ("B" if hit[0] == "A" else "A")
    heads = []
    words = {"m0": "Now", "m6": "Six months in", "m24": "Year two", "m60": "Year five"}
    for b in ("A", "B"):
        if not applies.get(b):
            continue
        for tp in ("m0", "m6", "m24", "m60"):
            role = sim.branches[b].snap(tp).career.role.text
            heads.append(ShockHeadline(branch=b, timepoint=tp, headline=f"{words[tp]}: {(role or 'a new chapter')[0].lower()}{(role or 'a new chapter')[1:]}"))  # type: ignore[arg-type]
    return FrontPagesOut(pages=pages, headlines=heads, verdict=ShockVerdict(
        more_robust=robust,  # type: ignore[arg-type]
        why=f"Path {robust} is untouched by this shock." if robust != "tie" else "Both worlds absorb this shock in similar ways.",
        dominant_assumption=sim.comparison.dominant_assumptions[0] if sim.comparison and sim.comparison.dominant_assumptions else "Job search length",
        confidence="medium"))


def shock_recompute(spec: DecisionSpec, domain: str, branch: str, month: int, plan: BranchShockPlan) -> SpecialistOutput:
    from .contracts import TIMEPOINT_MONTHS

    after = [tp for tp, m in TIMEPOINT_MONTHS.items() if m >= month]
    patches: list[FieldPatch] = []
    ev = [EvidenceDraft(text=f"Recomputed after the shock at month {month}.", confidence="medium")]
    searching = any(c.field == "career.employment_status" and c.text == "searching" for c in plan.entry_changes)

    def fp(tp, field, text, low=None, high=None, unit="none"):
        return FieldPatch(timepoint=tp, field=field, text=text, low=low, high=high, unit=unit, evidence="new:0")

    for tp in after:
        m = TIMEPOINT_MONTHS[tp]
        if domain == "career" and searching:
            patches += [fp(tp, "career.role", "Founding engineer at a new company"), fp(tp, "career.employment_status", "employed"),
                        fp(tp, "career.optionality", "High: hiring experience travels well")]
        if domain == "lifestyle":
            patches.append(fp(tp, "lifestyle.stress", "High for a few months, then easing" if m < 36 else "Medium"))
        if domain == "risk" and searching:
            patches.append(fp(tp, "risk.downside", "Already happened once; you know you can recover"))
        if domain == "values" and searching:
            patches.append(fp(tp, "values_fit.ownership", "3/5: equity gone, ownership of craft remains", 3, 3, "score_1_5"))
    return SpecialistOutput(summary="Recomputed after shock.", field_patches=patches, evidence=ev, events=[], risks=[], opportunities=[], confidence="medium", unresolved_questions=[])


# ------------------------------------------------------------------ persona

PHRASES = {
    "My role": "My role these days: {v}.", "What I'm learning": "Most of what I'm learning is {v}.",
    "Savings": "I've got {v} saved.", "Pay": "I'm making {v}.", "Stress": "Stress? {v}.",
    "Hours": "I work {v}.", "Biggest risk": "What worries me most: {v}.", "Equity": "The equity: {v}.",
    "Learning": "On learning, I'd give this life {v}.", "Ownership": "Ownership: {v}.",
    "Runway": "If everything stopped tomorrow I'd have {v}.", "Work status": "Work-wise I'm {v}.",
}


def _phrase(text: str) -> str:
    m = re.match(r"Month (\d+): ([^.]+)", text)
    if m:
        return f"At month {m.group(1)}, {m.group(2)[0].lower()}{m.group(2)[1:]}."
    label, _, value = text.partition(": ")
    if not value:
        return text.rstrip(".") + "."
    v = value[0].lower() + value[1:] if not value[:2].isupper() else value
    return PHRASES.get(label, label + ": {v}.").format(v=v.rstrip("."))


def persona_reply(question: str, branch: str, world_lines: list[tuple[str, str]], other_said: str | None) -> str:
    """world_lines: (id, text) pairs this persona may cite."""
    q = question.lower()
    if re.search(r"money|save|savings|pay|salary|afford|financ", q):
        want = ["Savings", "Pay", "Runway", "Equity"]
    elif re.search(r"stress|tired|burn|hours|happy|life|feel", q):
        want = ["Stress", "Hours", "Month"]
    else:
        want = ["Month", "What I'm learning", "My role", "Biggest risk"]
    if other_said and branch == "A":
        want = ["Biggest risk", "Ownership", "Learning", "Stress"]
    picks: list[tuple[str, str]] = []
    for w in want:
        for i, t in world_lines:
            if t.startswith(w) and all(i != p[0] or t != p[1] for p in picks) and not i.startswith("ev_U_"):
                picks.append((i, t))
                break
        if len(picks) == 3:
            break
    picks = picks or world_lines[:2]
    if other_said and branch == "B":
        opener = "I see it differently. "
    elif other_said:
        opener = "Fair, but from where I'm standing: "
    else:
        opener = "Honestly? " if branch == "A" else "I'll be straight with you. "
    body = " ".join(f"{_phrase(t)[:-1]} [{i}]." for i, t in picks)
    return opener + body + " That's the part of this life I think about most."


def postcard_svg(city: str, caption: str, accent: str) -> bytes:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" width="1536" height="1024">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1d24"/><stop offset="1" stop-color="{accent}"/></linearGradient></defs>
<rect width="1536" height="1024" fill="url(#sky)"/>
<path d="M0 760 L180 640 L320 700 L520 560 L700 690 L900 600 L1100 700 L1300 610 L1536 720 L1536 1024 L0 1024Z" fill="#0d0e12" opacity=".85"/>
<rect x="40" y="40" width="1456" height="944" fill="none" stroke="#ece8df" stroke-width="4" opacity=".6"/>
<text x="80" y="160" font-family="Georgia, serif" font-size="96" fill="#ece8df">Greetings from {city}</text>
<text x="80" y="940" font-family="Georgia, serif" font-style="italic" font-size="44" fill="#ece8df">{caption}</text>
<text x="1456" y="940" text-anchor="end" font-family="monospace" font-size="24" fill="#ece8df" opacity=".7">OFFLINE MOCK · not generated by Muse Image</text>
</svg>""".encode()
