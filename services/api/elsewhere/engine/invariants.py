"""Code-level checks that run before any branch is shown. Cheap, deterministic, and they repair
what they safely can (counted in `repaired`) instead of letting bad state reach the UI."""

from __future__ import annotations

from ..contracts import TIMEPOINT_MONTHS, TIMEPOINTS, ALL_FIELDS, CheckResult, Simulation
from . import finance as fin

OTHER = {"A": "B", "B": "A"}


def branch_isolation(sim: Simulation) -> CheckResult:
    bad = 0
    for b, bw in sim.branches.items():
        foreign_ev = f"ev_{OTHER[b]}_"
        foreign_evt = f"E-{OTHER[b]}-"
        for snap in bw.snapshots:
            for path in ALL_FIELDS:
                c = snap.get(path)
                if c.evidence_id and c.evidence_id.startswith(foreign_ev):
                    c.evidence_id = None
                    bad += 1
            before = len(snap.event_ids)
            snap.event_ids = [e for e in snap.event_ids if not e.startswith(foreign_evt)]
            bad += before - len(snap.event_ids)
    for e in sim.events:
        foreign = f"E-{OTHER[e.branch]}-"
        kept = [c for c in e.caused_by if not c.startswith(foreign)]
        bad += len(e.caused_by) - len(kept)
        e.caused_by = kept
    return CheckResult(name="Branch isolation", passed=True, repaired=bad,
                       detail="No world cites the other world's evidence or events.")


def timeline_order(sim: Simulation) -> CheckResult:
    problems: list[str] = []
    by_id = {e.id: e for e in sim.events}
    for e in sim.events:
        if not 0 <= e.month <= 60:
            problems.append(f"{e.id} at month {e.month}")
        for c in e.caused_by:
            if c.startswith("E-"):
                cause = by_id.get(c)
                if cause is None:
                    problems.append(f"{e.id} cites missing {c}")
                elif cause.month > e.month:
                    problems.append(f"{e.id} happens before its cause {c}")
    return CheckResult(name="Timeline order", passed=not problems, detail="; ".join(problems[:3]) or "Every event follows its causes.")


def money_reconciles(sim: Simulation) -> CheckResult:
    problems: list[str] = []
    for bw in sim.branches.values():
        pts = fin.timeline(bw.finance_inputs)
        for tp in TIMEPOINTS:
            r = bw.snap(tp).finance.savings.range
            p = pts[tp]
            if r is None or abs(r.low - p.savings_low) > 1 or abs(r.high - p.savings_high) > 1:
                problems.append(f"{bw.branch} {tp}")
    return CheckResult(name="Money reconciles", passed=not problems,
                       detail=("Mismatch at " + ", ".join(problems)) if problems else "Savings match pay, tax and costs at every timepoint.")


def facts_have_sources(sim: Simulation) -> CheckResult:
    fixed = 0
    for e in sim.evidence:
        if e.kind == "FACT" and e.citation is None:
            e.kind = "INFERENCE"
            fixed += 1
        if e.kind == "ASSUMPTION" and e.source != "user":
            e.kind = "INFERENCE"
            fixed += 1
    return CheckResult(name="Facts have sources", passed=True, repaired=fixed,
                       detail="Every FACT has a citation; every ASSUMPTION came from you.")


def unknowns_stay_unknown(sim: Simulation) -> CheckResult:
    fixed = 0
    ids = {e.id for e in sim.evidence}
    for bw in sim.branches.values():
        for snap in bw.snapshots:
            for path in ALL_FIELDS:
                c = snap.get(path)
                if c.status == "known" and (not c.evidence_id or c.evidence_id not in ids):
                    c.status, c.text, c.range, c.evidence_id = "unknown", None, None, None
                    fixed += 1
                elif c.status == "unknown" and c.text:
                    c.text = None
                    fixed += 1
    return CheckResult(name="No unsupported values", passed=True, repaired=fixed,
                       detail="Values without evidence are shown as unknown, not filled in.")


def run_all(sim: Simulation) -> list[CheckResult]:
    return [
        branch_isolation(sim),
        timeline_order(sim),
        money_reconciles(sim),
        facts_have_sources(sim),
        unknowns_stay_unknown(sim),
    ]


def months_of(tp: str) -> int:
    return TIMEPOINT_MONTHS[tp]
