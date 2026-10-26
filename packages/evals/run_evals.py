"""AI eval suite (plan section 15). Runs over every seeded demo world, base and shocked.

    services/api/.venv/bin/python packages/evals/run_evals.py

Checks: branch separation, temporal consistency, numeric consistency, shock causality,
evidence labeling, persona isolation, unknown handling.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from elsewhere.contracts import ALL_FIELDS, TIMEPOINTS, Simulation  # noqa: E402
from elsewhere.engine import finance  # noqa: E402

REF = re.compile(r"\[(ev_[UABS]_\d{3}|E-[AB]-\d{3})\]")
OTHER = {"A": "B", "B": "A"}


def branch_separation(sim: Simulation) -> list[str]:
    bad = []
    for b, bw in sim.branches.items():
        dumped = bw.model_dump_json()
        if f"ev_{OTHER[b]}_" in dumped or f"E-{OTHER[b]}-" in dumped:
            bad.append(f"Path {b} references Path {OTHER[b]}")
    return bad


def temporal(sim: Simulation) -> list[str]:
    by = {e.id: e for e in sim.events}
    return [f"{e.id} precedes cause {c}" for e in sim.events for c in e.caused_by if c in by and by[c].month > e.month]


def numeric(sim: Simulation) -> list[str]:
    bad = []
    for bw in sim.branches.values():
        tl = finance.timeline(bw.finance_inputs)
        for tp in TIMEPOINTS:
            r = bw.snap(tp).finance.savings.range
            if not r or abs(r.low - tl[tp].savings_low) > 1 or abs(r.high - tl[tp].savings_high) > 1:
                bad.append(f"{bw.branch} {tp} savings mismatch")
    return bad


def shock_causality(sim: Simulation) -> list[str]:
    bad = []
    for s in sim.shocks:
        for c in s.changes:
            if not c.because or c.because[0] != s.id:
                bad.append(f"{s.id}: {c.field} has no causal chain")
            if c.branch not in s.applies_to:
                bad.append(f"{s.id}: changed {c.branch} which it does not reach")
            if c.timepoint in ("m0", "m6") and s.month > 6 and c.field != "finance.equity_value":
                bad.append(f"{s.id}: changed {c.field} at {c.timepoint}, before the shock")
    return bad


def evidence_labels(sim: Simulation) -> list[str]:
    bad = []
    for e in sim.evidence:
        if e.kind == "FACT" and not e.citation:
            bad.append(f"{e.id} FACT without citation")
        if e.kind == "ASSUMPTION" and e.source != "user":
            bad.append(f"{e.id} ASSUMPTION not from user")
    return bad


def unknowns(sim: Simulation) -> list[str]:
    ids = {e.id for e in sim.evidence}
    bad = []
    for bw in sim.branches.values():
        for s in bw.snapshots:
            for f in ALL_FIELDS:
                c = s.get(f)
                if c.status == "known" and c.evidence_id not in ids:
                    bad.append(f"{bw.branch} {s.timepoint} {f} has no evidence")
    return bad


def persona(messages: list[dict]) -> list[str]:
    bad = []
    for m in messages:
        if m["role"] == "user":
            continue
        b = "A" if m["role"] == "future_a" else "B"
        for ref in REF.findall(m["text"]):
            if ref.startswith((f"ev_{OTHER[b]}_", f"E-{OTHER[b]}-")):
                bad.append(f"Future {b} cited {ref}")
    return bad


def main() -> int:
    failures = 0
    for f in sorted((ROOT / "demo").glob("*.json")):
        d = json.loads(f.read_text())
        worlds = {"base": Simulation.model_validate(d["simulation"]), "shocked": Simulation.model_validate(d["precomputed_shock"]["simulation"])}
        for name, sim in worlds.items():
            for check in (branch_separation, temporal, numeric, shock_causality, evidence_labels, unknowns):
                errs = check(sim)
                failures += len(errs)
                print(f"{'PASS' if not errs else 'FAIL'}  {f.stem:<24} {name:<8} {check.__name__:<18} {'; '.join(errs[:2])}")
        errs = persona(d.get("messages", []))
        failures += len(errs)
        print(f"{'PASS' if not errs else 'FAIL'}  {f.stem:<24} {'chat':<8} {'persona_isolation':<18} {'; '.join(errs[:2])}")
    print(f"\n{failures} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
