"""Shared data contracts. Every screen and agent reads from these shapes.

Spec: docs/worldstate-schema.md. Model-facing schemas (the ones sent to Meta's
structured output) are kept flat and small; see strict_schema.py.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

Branch = Literal["A", "B"]
Timepoint = Literal["m0", "m6", "m24", "m60"]
TIMEPOINTS: list[Timepoint] = ["m0", "m6", "m24", "m60"]
TIMEPOINT_MONTHS: dict[str, int] = {"m0": 0, "m6": 6, "m24": 24, "m60": 60}
Confidence = Literal["high", "medium", "low"]
EvidenceKind = Literal["FACT", "ASSUMPTION", "INFERENCE"]
EvidenceSource = Literal["user", "web", "model", "engine"]
Unit = Literal["usd", "usd_per_year", "months", "hours_per_week", "score_1_5", "none"]
Domain = Literal["career", "finance", "location", "lifestyle", "risk", "values_fit"]
SPECIALIST_DOMAINS = ["career", "finance", "lifestyle", "risk", "values"]
OrgType = Literal["startup", "established_company", "school", "self_employed", "other"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- decision ---

class PathSpec(BaseModel):
    label: str = Field(description="Short name, e.g. 'Startup in San Francisco'")
    city: str | None
    role: str | None
    org_type: OrgType
    annual_pay_usd: float | None
    equity: str | None
    notes: str


class Priorities(BaseModel):
    learning: int = Field(ge=1, le=5)
    stability: int = Field(ge=1, le=5)
    ownership: int = Field(ge=1, le=5)
    location: int = Field(ge=1, le=5)
    autonomy: int = Field(ge=1, le=5)


class CurrentSituation(BaseModel):
    city: str | None
    profession: str | None
    age_band: str | None
    savings_usd: float | None
    monthly_expenses_usd: float | None


class ClarifyingQuestion(BaseModel):
    id: str
    text: str
    why: str


class DecisionSpec(BaseModel):
    title: str = Field(description="Under 40 chars, 'X vs Y'")
    question: str
    path_a: PathSpec
    path_b: PathSpec
    priorities: Priorities
    goals: list[str]
    fears: list[str]
    constraints: list[str]
    current: CurrentSituation
    clarifying_questions: list[ClarifyingQuestion] = Field(max_length=3)


# ------------------------------------------------------------ world state ---

class Range(BaseModel):
    low: float
    high: float
    unit: Unit


class Claim(BaseModel):
    text: str | None = None
    range: Range | None = None
    evidence_id: str | None = None
    status: Literal["known", "unknown", "needs_user"] = "unknown"


class Career(BaseModel):
    role: Claim = Field(default_factory=Claim)
    employment_status: Claim = Field(default_factory=Claim)
    scope: Claim = Field(default_factory=Claim)
    skills: Claim = Field(default_factory=Claim)
    network: Claim = Field(default_factory=Claim)
    optionality: Claim = Field(default_factory=Claim)


class Finance(BaseModel):
    salary: Claim = Field(default_factory=Claim)
    equity_value: Claim = Field(default_factory=Claim)
    housing_cost: Claim = Field(default_factory=Claim)
    savings: Claim = Field(default_factory=Claim)
    runway_months: Claim = Field(default_factory=Claim)


class Location(BaseModel):
    city: Claim = Field(default_factory=Claim)
    commute: Claim = Field(default_factory=Claim)
    support_network: Claim = Field(default_factory=Claim)


class Lifestyle(BaseModel):
    work_hours: Claim = Field(default_factory=Claim)
    stress: Claim = Field(default_factory=Claim)
    flexibility: Claim = Field(default_factory=Claim)
    social_support: Claim = Field(default_factory=Claim)


class Risk(BaseModel):
    job_security: Claim = Field(default_factory=Claim)
    reversibility: Claim = Field(default_factory=Claim)
    downside: Claim = Field(default_factory=Claim)


class ValuesFit(BaseModel):
    learning: Claim = Field(default_factory=Claim)
    stability: Claim = Field(default_factory=Claim)
    ownership: Claim = Field(default_factory=Claim)
    location: Claim = Field(default_factory=Claim)
    autonomy: Claim = Field(default_factory=Claim)


DOMAIN_FIELDS: dict[str, list[str]] = {
    "career": list(Career.model_fields),
    "finance": list(Finance.model_fields),
    "location": list(Location.model_fields),
    "lifestyle": list(Lifestyle.model_fields),
    "risk": list(Risk.model_fields),
    "values_fit": list(ValuesFit.model_fields),
}
ALL_FIELDS: list[str] = [f"{d}.{f}" for d, fs in DOMAIN_FIELDS.items() for f in fs]


class Snapshot(BaseModel):
    timepoint: Timepoint
    headline: str = ""
    career: Career = Field(default_factory=Career)
    finance: Finance = Field(default_factory=Finance)
    location: Location = Field(default_factory=Location)
    lifestyle: Lifestyle = Field(default_factory=Lifestyle)
    risk: Risk = Field(default_factory=Risk)
    values_fit: ValuesFit = Field(default_factory=ValuesFit)
    event_ids: list[str] = []

    def get(self, path: str) -> Claim:
        domain, field = path.split(".")
        return getattr(getattr(self, domain), field)

    def set(self, path: str, claim: Claim) -> None:
        domain, field = path.split(".")
        setattr(getattr(self, domain), field, claim)


class Persona(BaseModel):
    name: str
    voice: str
    temperament: str


class FinanceInputs(BaseModel):
    """Deterministic finance model inputs for one branch (all annual USD unless noted)."""

    start_savings: float
    annual_pay: float
    effective_tax_rate: float = Field(ge=0, le=0.7)
    annual_housing_low: float
    annual_housing_high: float
    annual_other_costs: float
    raise_pct_per_year: float = 0.03
    equity_note: str | None = None
    # Income over time. Shocks rewrite these. end_month None = open-ended.
    pay_segments: list["PaySegment"] = []
    one_time_costs: list["OneTimeCost"] = []


class PaySegment(BaseModel):
    start_month: int
    end_month: int | None
    annual_pay: float
    label: str


class OneTimeCost(BaseModel):
    month: int
    amount: float
    label: str


FinanceInputs.model_rebuild()


class BranchWorld(BaseModel):
    branch: Branch
    label: str
    summary: str = ""
    top_tradeoffs: list[str] = []
    confidence: Confidence = "medium"
    persona: Persona
    finance_inputs: FinanceInputs
    snapshots: list[Snapshot]

    def snap(self, tp: str) -> Snapshot:
        return next(s for s in self.snapshots if s.timepoint == tp)


class Citation(BaseModel):
    url: str
    title: str
    retrieved_at: str


class EvidenceItem(BaseModel):
    id: str  # ev_A_001 / ev_B_001 / ev_U_001 (user, shared) / ev_S_001 (shared fact)
    kind: EvidenceKind
    source: EvidenceSource
    agent: str
    model_id: str | None
    text: str
    citation: Citation | None = None
    confidence: Confidence
    created_at: str = Field(default_factory=now_iso)


class WorldEvent(BaseModel):
    id: str  # E-A-001
    branch: Branch
    month: int
    kind: Literal["turning_point", "shock", "user_edit"]
    title: str
    detail: str = ""
    caused_by: list[str] = []
    evidence_id: str | None = None
    version: int = 1


class FieldChange(BaseModel):
    branch: Branch
    timepoint: Timepoint
    field: str
    before: str
    after: str
    because: list[str]


class FrontPage(BaseModel):
    branch: Branch
    headline: str
    deck: str
    changed_because: str
    unchanged: bool


class ShockVerdict(BaseModel):
    more_robust: Literal["A", "B", "tie"]
    why: str
    dominant_assumption: str
    confidence: Confidence


class ShockRecord(BaseModel):
    id: str
    label: str
    description: str
    month: int
    applies_to: list[Branch]
    not_applied_because: dict[str, str] = {}
    changes: list[FieldChange] = []
    front_pages: list[FrontPage] = []
    verdict: ShockVerdict | None = None
    from_version: int
    to_version: int
    created_at: str = Field(default_factory=now_iso)


class SuggestedShock(BaseModel):
    label: str
    description: str
    month: int


class CheckResult(BaseModel):
    name: str
    passed: bool
    repaired: int = 0
    detail: str = ""


class Comparison(BaseModel):
    summary: str
    dominant_assumptions: list[str]
    what_would_change_my_mind: list[str]


class ThirdDoor(BaseModel):
    """A path Wonder proposes when the decision may be a false either/or."""

    is_real_alternative: bool
    label: str
    path: PathSpec
    why_not_binary: str
    borrows_from_a: str
    borrows_from_b: str
    gives_up: str
    first_step: str
    risks: list[str] = []
    mode: Literal["live", "mock"] = "mock"
    created_at: str = Field(default_factory=now_iso)


class Simulation(BaseModel):
    id: str
    slug: str | None = None
    mode: Literal["live", "mock"]
    status: Literal["draft", "running", "ready", "failed"]
    version: int = 1
    decision: DecisionSpec
    branches: dict[str, BranchWorld] = {}
    evidence: list[EvidenceItem] = []
    events: list[WorldEvent] = []
    shocks: list[ShockRecord] = []
    suggested_shocks: list[SuggestedShock] = []
    checks: list[CheckResult] = []
    comparison: Comparison | None = None
    third_door: ThirdDoor | None = None
    derived_from: str | None = None  # the simulation this one's third door came from
    created_at: str = Field(default_factory=now_iso)

    def evidence_by_id(self) -> dict[str, EvidenceItem]:
        return {e.id: e for e in self.evidence}


# ------------------------------------------------------------ chat ---

class ClaimSpan(BaseModel):
    start: int
    end: int
    ref: str  # evidence id or event id


class PersonaMessage(BaseModel):
    id: str
    role: Literal["user", "future_a", "future_b"]
    text: str
    claims: list[ClaimSpan] = []
    guard_rewrites: int = 0
    timepoint: Timepoint = "m24"
    created_at: str = Field(default_factory=now_iso)
