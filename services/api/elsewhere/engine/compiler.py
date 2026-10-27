"""Turn agent outputs into WorldState. Code owns ids, provenance and money math."""

from __future__ import annotations

import re

from ..contracts import (
    TIMEPOINT_MONTHS,
    TIMEPOINTS,
    ALL_FIELDS,
    BranchWorld,
    Citation,
    Claim,
    Confidence,
    EvidenceItem,
    EvidenceKind,
    EvidenceSource,
    Range,
    Simulation,
    Snapshot,
    WorldEvent,
    now_iso,
)
from ..agents.schemas import DOMAIN_WRITES, EventDraft, SpecialistOutput
from . import finance as fin

EVIDENCE_ID = re.compile(r"^ev_([UABS])_(\d{3})$")
ENGINE_NOTE = "Calculated by Elsewhere's finance model from pay, tax rate, housing and living costs. A scenario value, not a prediction."


def _next_number(ids) -> int:
    """Highest existing number + 1. Counting instead would reuse ids after a shock removes later events."""
    nums = [int(m.group(1)) for i in ids if (m := re.search(r"(\d+)$", i))]
    return max(nums, default=0) + 1


class Registry:
    """Assigns stable ids. Ids carry their branch letter so isolation can be checked by code."""

    def __init__(self, sim: Simulation):
        self.sim = sim

    def evidence(
        self,
        prefix: str,
        kind: EvidenceKind,
        source: EvidenceSource,
        agent: str,
        text: str,
        confidence: Confidence,
        model_id: str | None = None,
        citation: Citation | None = None,
    ) -> str:
        n = _next_number(e.id for e in self.sim.evidence if e.id.startswith(f"ev_{prefix}_"))
        eid = f"ev_{prefix}_{n:03d}"
        self.sim.evidence.append(
            EvidenceItem(id=eid, kind=kind, source=source, agent=agent, model_id=model_id, text=text, citation=citation, confidence=confidence)
        )
        return eid

    def find_evidence(self, prefix: str, text: str) -> str | None:
        for e in self.sim.evidence:
            if e.id.startswith(f"ev_{prefix}_") and e.text == text:
                return e.id
        return None

    def event(
        self,
        branch: str,
        month: int,
        kind: str,
        title: str,
        detail: str = "",
        caused_by: list[str] | None = None,
        evidence_id: str | None = None,
    ) -> str:
        n = _next_number(e.id for e in self.sim.events if e.id.startswith(f"E-{branch}-"))
        eid = f"E-{branch}-{n:03d}"
        self.sim.events.append(
            WorldEvent(
                id=eid, branch=branch, month=max(0, min(60, month)), kind=kind, title=title, detail=detail,
                caused_by=caused_by or [], evidence_id=evidence_id, version=self.sim.version,
            )
        )
        return eid


def blank_snapshots() -> list[Snapshot]:
    return [Snapshot(timepoint=tp) for tp in TIMEPOINTS]


def resolve_ref(ref: str, branch: str, new_ids: list[str], known: set[str]) -> str | None:
    """Map a specialist's evidence pointer to a real id, refusing the other branch's ids."""
    ref = (ref or "").strip()
    m = EVIDENCE_ID.match(ref)
    if m:
        letter = m.group(1)
        if ref in known and letter in ("U", "S", branch):
            return ref
        return new_ids[0] if new_ids else None
    if ref.startswith("new:"):
        ref = ref[4:]
    if ref.isdigit() and int(ref) < len(new_ids):
        return new_ids[int(ref)]
    return new_ids[0] if new_ids else None


def apply_specialist(
    reg: Registry,
    bw: BranchWorld,
    domain: str,
    out: SpecialistOutput,
    model_id: str,
    caused_by: list[str] | None = None,
    only_after_month: int = -1,
    event_kind: str = "turning_point",
) -> tuple[list[str], int]:
    """Write one specialist's patches into the branch. Returns (new event ids, rejected patch count)."""
    new_ids = [
        reg.evidence(bw.branch, "INFERENCE", "model", domain, d.text, d.confidence, model_id=model_id) for d in out.evidence
    ]
    known = {e.id for e in reg.sim.evidence}
    allowed = set(DOMAIN_WRITES.get(domain, []))
    rejected = 0
    for p in out.field_patches:
        if p.field not in allowed or TIMEPOINT_MONTHS[p.timepoint] < only_after_month:
            rejected += 1
            continue
        rng = None
        if p.low is not None and p.high is not None and p.unit != "none":
            rng = Range(low=min(p.low, p.high), high=max(p.low, p.high), unit=p.unit)
        eid = resolve_ref(p.evidence, bw.branch, new_ids, known)
        bw.snap(p.timepoint).set(p.field, Claim(text=p.text, range=rng, evidence_id=eid, status="known"))
    events = [
        reg.event(bw.branch, e.month, event_kind, e.title, e.detail, caused_by, new_ids[0] if new_ids else None)
        for e in out.events
        if e.month > only_after_month
    ]
    return events, rejected


def add_events(reg: Registry, branch: str, drafts: list[EventDraft], kind: str, caused_by: list[str], evidence_id: str | None) -> list[str]:
    return [reg.event(branch, d.month, kind, d.title, d.detail, caused_by, evidence_id) for d in drafts]


def apply_finance(reg: Registry, bw: BranchWorld, pay_evidence: str | None, housing_evidence: str | None) -> None:
    """Fill salary, housing, savings and runway at every timepoint from the engine."""
    fi = bw.finance_inputs
    # The engine is plain arithmetic, so its numbers are only as good as their inputs.
    inputs_solid = _is_solid(reg.sim, pay_evidence) and _is_solid(reg.sim, housing_evidence)
    engine_ev = reg.find_evidence(bw.branch, ENGINE_NOTE) or reg.evidence(
        bw.branch, "INFERENCE", "engine", "finance-engine", ENGINE_NOTE, "high" if inputs_solid else "medium")
    points = fin.timeline(fi)
    for tp in TIMEPOINTS:
        p = points[tp]
        snap = bw.snap(tp)
        month = TIMEPOINT_MONTHS[tp]
        seg_label = next((s.label for s in reversed(fin.segments(fi)) if s.start_month <= month and (s.end_month is None or month < s.end_month)), "base pay")
        if p.annual_pay > 0:
            pay_text = f"{fin.usd(p.annual_pay)} a year" + (f" + {fi.equity_note}" if fi.equity_note and seg_label == "base pay" else "")
        else:
            pay_text = f"No salary ({seg_label})"
        prior_salary = snap.finance.salary
        stated = seg_label == "base pay" and abs(p.annual_pay - fi.annual_pay) < 1
        # Only the number you actually stated cites you; raises and later roles are calculated.
        salary_ev = pay_evidence if stated and pay_evidence else (engine_ev if seg_label == "base pay" else (prior_salary.evidence_id or engine_ev))
        snap.finance.salary = Claim(
            text=pay_text, range=Range(low=p.annual_pay, high=p.annual_pay, unit="usd_per_year"), evidence_id=salary_ev, status="known"
        )
        snap.finance.housing_cost = Claim(
            text=f"{fin.usd_range(fi.annual_housing_low, fi.annual_housing_high)} a year",
            range=Range(low=fi.annual_housing_low, high=fi.annual_housing_high, unit="usd_per_year"),
            evidence_id=housing_evidence or engine_ev,
            status="known",
        )
        snap.finance.savings = Claim(
            text=fin.usd_range(p.savings_low, p.savings_high),
            range=Range(low=p.savings_low, high=p.savings_high, unit="usd"),
            evidence_id=engine_ev,
            status="known",
        )
        rl, rh = round(p.runway_low, 1), round(p.runway_high, 1)
        snap.finance.runway_months = Claim(
            text=f"{rl:g}–{rh:g} months of expenses" if rl != rh else f"{rl:g} months of expenses",
            range=Range(low=rl, high=rh, unit="months"),
            evidence_id=engine_ev,
            status="known",
        )


def _is_solid(sim: Simulation, evidence_id: str | None) -> bool:
    """True for a sourced FACT, a number the user stated, or engine math on such inputs."""
    e = next((x for x in sim.evidence if x.id == evidence_id), None) if evidence_id else None
    if e is None:
        return False
    return e.kind == "FACT" or (e.kind == "ASSUMPTION" and e.source == "user") or (e.source == "engine" and e.confidence == "high")


CONFIDENCE_ORDER: list[Confidence] = ["low", "medium", "high"]


def evidence_confidence(sim: Simulation, branch: str, model_view: Confidence) -> Confidence:
    """Overall confidence for one branch, earned from its evidence rather than asserted.

    high:   pay and housing rest on facts or your own numbers, and at least two sourced facts apply
    low:    neither of those, and no sourced facts at all
    medium: anything in between
    The model's own view can be raised by at most one step, never more.
    """
    m0 = sim.branches[branch].snap("m0").finance
    money_solid = _is_solid(sim, m0.salary.evidence_id) and _is_solid(sim, m0.housing_cost.evidence_id)
    facts = sum(1 for e in sim.evidence if e.kind == "FACT" and e.id.startswith((f"ev_{branch}_", "ev_S_")))
    grade = 2 if money_solid and facts >= 2 else 0 if not money_solid and facts == 0 else 1
    return CONFIDENCE_ORDER[min(grade, CONFIDENCE_ORDER.index(model_view) + 1)]


def carry_forward(bw: BranchWorld) -> None:
    """A value known at an earlier timepoint holds until something changes it."""
    for path in ALL_FIELDS:
        prev: Claim | None = None
        for tp in TIMEPOINTS:
            c = bw.snap(tp).get(path)
            if c.status == "unknown" and prev is not None and prev.status == "known":
                bw.snap(tp).set(path, prev.model_copy(deep=True))
            else:
                prev = bw.snap(tp).get(path)


def index_events(sim: Simulation) -> None:
    for bw in sim.branches.values():
        for snap in bw.snapshots:
            limit = TIMEPOINT_MONTHS[snap.timepoint]
            snap.event_ids = [
                e.id for e in sorted(sim.events, key=lambda e: (e.month, e.id)) if e.branch == bw.branch and e.month <= limit
            ]


def ground_citation(c: dict[str, str]) -> Citation:
    return Citation(url=c["url"], title=c.get("title") or c["url"], retrieved_at=now_iso())
