"""Which WorldState fields depend on which. Fixed in code so the model never decides causality.

A shock names entry fields; `downstream` walks this map to find everything that must be
recomputed, and the diff uses the same map to explain *why* a field changed.
"""

from __future__ import annotations

DEPENDS_ON: dict[str, list[str]] = {
    # finance
    "finance.salary": ["career.employment_status", "career.role"],
    "finance.equity_value": ["career.employment_status"],
    "finance.savings": ["finance.salary", "finance.housing_cost", "finance.equity_value"],
    "finance.runway_months": ["finance.savings", "finance.housing_cost"],
    "finance.housing_cost": ["location.city"],
    # career
    "career.role": ["career.employment_status"],
    "career.scope": ["career.role"],
    "career.skills": ["career.role", "career.scope"],
    "career.network": ["location.city", "career.role"],
    "career.optionality": ["career.skills", "career.network", "finance.runway_months"],
    # location
    "location.commute": ["location.city", "career.role"],
    "location.support_network": ["location.city"],
    # lifestyle
    "lifestyle.work_hours": ["career.role", "career.employment_status"],
    "lifestyle.stress": ["finance.runway_months", "lifestyle.work_hours", "career.employment_status"],
    "lifestyle.flexibility": ["career.role", "lifestyle.work_hours"],
    "lifestyle.social_support": ["location.support_network"],
    # risk
    "risk.job_security": ["career.employment_status", "career.optionality"],
    "risk.reversibility": ["career.optionality", "finance.runway_months"],
    "risk.downside": ["risk.job_security", "finance.runway_months"],
    # values
    "values_fit.learning": ["career.skills", "career.scope"],
    "values_fit.stability": ["risk.job_security", "finance.runway_months"],
    "values_fit.ownership": ["career.role", "finance.equity_value"],
    "values_fit.location": ["location.city"],
    "values_fit.autonomy": ["career.role", "lifestyle.flexibility"],
}

# Reverse edges: field -> fields that read it
_READERS: dict[str, set[str]] = {}
for _f, _ups in DEPENDS_ON.items():
    for _u in _ups:
        _READERS.setdefault(_u, set()).add(_f)


def downstream(entry_fields: list[str]) -> set[str]:
    """Every field reachable from the entry fields (entry fields included)."""
    seen: set[str] = set()
    stack = list(entry_fields)
    while stack:
        f = stack.pop()
        if f in seen:
            continue
        seen.add(f)
        stack.extend(_READERS.get(f, ()))
    return seen


def upstream_path(field: str, changed: set[str], entry: set[str]) -> list[str]:
    """Shortest chain from an entry field to `field`, through fields that actually changed."""
    if field in entry:
        return [field]
    frontier: list[list[str]] = [[field]]
    seen = {field}
    while frontier:
        nxt: list[list[str]] = []
        for path in frontier:
            for up in DEPENDS_ON.get(path[0], []):
                if up in seen or (up not in changed and up not in entry):
                    continue
                new = [up, *path]
                if up in entry:
                    return new
                seen.add(up)
                nxt.append(new)
        frontier = nxt
    return [field]


def domain_of(field: str) -> str:
    return field.split(".")[0]
