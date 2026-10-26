"""Diff two versions of a world and explain each change through the dependency map."""

from __future__ import annotations

from ..contracts import TIMEPOINTS, ALL_FIELDS, BranchWorld, Claim, FieldChange
from . import deps


def show(c: Claim) -> str:
    if c.status != "known":
        return "unknown"
    return c.text or ""


def same(a: Claim, b: Claim) -> bool:
    if a.status != b.status or (a.text or "") != (b.text or ""):
        return False
    if (a.range is None) != (b.range is None):
        return False
    if a.range and b.range:
        return abs(a.range.low - b.range.low) < 1 and abs(a.range.high - b.range.high) < 1
    return True


def branch_diff(before: BranchWorld, after: BranchWorld, shock_id: str, entry_fields: list[str], new_event_ids: list[str]) -> list[FieldChange]:
    changed_fields: set[str] = set()
    raw: list[tuple[str, str, Claim, Claim]] = []
    for tp in TIMEPOINTS:
        for path in ALL_FIELDS:
            a, b = before.snap(tp).get(path), after.snap(tp).get(path)
            if not same(a, b):
                raw.append((tp, path, a, b))
                changed_fields.add(path)
    entry = set(entry_fields)
    out: list[FieldChange] = []
    for tp, path, a, b in raw:
        chain = deps.upstream_path(path, changed_fields, entry)
        because = [shock_id, *new_event_ids[:2], *[f for f in chain if f != path]]
        out.append(FieldChange(branch=after.branch, timepoint=tp, field=path, before=show(a), after=show(b), because=because))
    return out
