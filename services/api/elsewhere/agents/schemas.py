"""Model-facing output schemas (sent to Meta structured output in strict mode).

Kept flat on purpose: strict mode caps nesting at 10 and forbids recursion, and small
schemas are faster and more reliable.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..contracts import Branch, Comparison, Confidence, FrontPage, ShockVerdict, SuggestedShock, Timepoint, Unit

SpecialistDomain = Literal["career", "finance", "lifestyle", "risk", "values"]

# Fields each specialist may write. Finance savings/runway/housing come from the engine.
DOMAIN_WRITES: dict[str, list[str]] = {
    "career": ["career.role", "career.employment_status", "career.scope", "career.skills", "career.network", "career.optionality"],
    "finance": ["finance.equity_value"],
    "lifestyle": ["lifestyle.work_hours", "lifestyle.stress", "lifestyle.flexibility", "lifestyle.social_support", "location.commute", "location.support_network"],
    "risk": ["risk.job_security", "risk.reversibility", "risk.downside"],
    "values": ["values_fit.learning", "values_fit.stability", "values_fit.ownership", "values_fit.location", "values_fit.autonomy"],
}


class FieldPatch(BaseModel):
    timepoint: Timepoint
    field: str = Field(description="One of the allowed field paths for your domain")
    text: str = Field(description="Short value, under 12 words. Write it as a state, not advice.")
    low: float | None
    high: float | None
    unit: Unit
    evidence: str = Field(description="What supports this value: 'new:N' for item N of your own evidence list, or an existing id from the EVIDENCE YOU CAN CITE list, e.g. 'ev_U_002'")


class EvidenceDraft(BaseModel):
    """Always stored as INFERENCE. User assumptions and web facts already have ids; cite those instead."""

    text: str = Field(description="One sentence: the reasoning behind a value")
    confidence: Confidence


class EventDraft(BaseModel):
    month: int = Field(ge=0, le=60)
    title: str = Field(description="Under 8 words, past tense, e.g. 'Promoted to senior engineer'")
    detail: str


class SpecialistOutput(BaseModel):
    summary: str
    field_patches: list[FieldPatch]
    evidence: list[EvidenceDraft]
    events: list[EventDraft]
    risks: list[str]
    opportunities: list[str]
    confidence: Confidence
    unresolved_questions: list[str]


class FinanceOutput(SpecialistOutput):
    effective_tax_rate: float = Field(ge=0, le=0.6, description="All-in income tax rate for this branch's city, as a fraction")
    annual_housing_low: float
    annual_housing_high: float
    annual_other_costs: float = Field(description="Non-housing living costs per year, USD")
    raise_pct_per_year: float = Field(ge=0, le=0.3)
    annual_pay_if_unknown: float = Field(description="Typical annual pay for this role and city. Only used if the user did not state pay.")
    planned_pay_segments: list["ShockPaySegment"] = Field(description="Only if income changes on a known schedule (e.g. no pay while studying, then a job at month 24). Empty if pay is steady.")
    planned_costs: list["PlannedCost"] = Field(description="Large known one-off costs such as tuition or relocation. Empty if none.")


class PlannedCost(BaseModel):
    month: int = Field(ge=0, le=60)
    amount: float
    label: str


class GroundedNumber(BaseModel):
    answer: str
    low: float | None
    high: float | None
    unit: Unit


class PersonaDraft(BaseModel):
    voice: str = Field(description="How this future self talks, one sentence")
    temperament: str = Field(description="Their mood about life at year 2, one sentence")


class HeadlineDraft(BaseModel):
    timepoint: Timepoint
    headline: str = Field(description="One line, under 12 words, the state of this life at this time")


class BranchRecon(BaseModel):
    branch: Branch
    summary: str
    top_tradeoffs: list[str] = Field(max_length=3)
    confidence: Confidence
    persona: PersonaDraft
    headlines: list[HeadlineDraft]
    drop_event_titles: list[str] = Field(description="Duplicate or contradictory event titles to remove")
    conflicts_resolved: list[str]


class Reconciliation(BaseModel):
    branches: list[BranchRecon]
    comparison: Comparison
    suggested_shocks: list[SuggestedShock] = Field(max_length=3)


class ConsistencyIssue(BaseModel):
    branch: Branch
    timepoint: Timepoint
    field: str
    problem: str
    fixed_text: str


class ConsistencyReport(BaseModel):
    issues: list[ConsistencyIssue]
    overall: str


class EntryChange(BaseModel):
    field: str
    text: str


class ShockPaySegment(BaseModel):
    start_month: int
    end_month: int | None
    annual_pay: float
    label: str


class BranchShockPlan(BaseModel):
    branch: Branch
    applies: bool
    why: str = Field(description="Why this shock does or does not reach this branch")
    entry_changes: list[EntryChange]
    new_events: list[EventDraft]
    pay_segments_from_shock: list[ShockPaySegment] = Field(description="Income from the shock month onward. Empty if pay is unchanged.")
    one_time_cost: float | None
    equity_to_zero: bool
    affected_domains: list[Literal["career", "lifestyle", "risk", "values"]]


class ShockPlan(BaseModel):
    month: int = Field(ge=0, le=60)
    label: str
    branches: list[BranchShockPlan]
    assumptions: list[str] = Field(description="Assumptions you had to make, each one sentence the user could change")


class ShockHeadline(BaseModel):
    branch: Branch
    timepoint: Timepoint
    headline: str = Field(description="One line, under 12 words, the state of this life at this time after the shock")


class FrontPagesOut(BaseModel):
    pages: list[FrontPage]
    verdict: ShockVerdict
    headlines: list[ShockHeadline] = Field(description="New timeline headlines for every timepoint at or after the shock month, only in branches the shock reached")


FinanceOutput.model_rebuild()
