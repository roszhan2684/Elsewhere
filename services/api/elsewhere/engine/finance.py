"""Deterministic money model. No model calls here.

Agents propose the inputs (pay, tax rate, housing, other costs); this code turns them
into savings and runway ranges at every timepoint. The web app's "What decides this?"
chart runs the same math in TypeScript (apps/web/src/lib/finance.ts); both are checked
against packages/evals/finance_golden.json.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..contracts import TIMEPOINT_MONTHS, FinanceInputs, PaySegment

OTHER_COST_SPREAD = 0.10  # +/-10% on non-housing costs for the low/high band


@dataclass
class MonthPoint:
    savings_low: float
    savings_high: float
    runway_low: float
    runway_high: float
    annual_pay: float


def segments(fi: FinanceInputs) -> list[PaySegment]:
    if fi.pay_segments:
        return sorted(fi.pay_segments, key=lambda s: s.start_month)
    return [PaySegment(start_month=0, end_month=None, annual_pay=fi.annual_pay, label="base pay")]


def pay_at(fi: FinanceInputs, month: int) -> float:
    for seg in reversed(segments(fi)):
        if seg.start_month <= month and (seg.end_month is None or month < seg.end_month):
            years = (month - seg.start_month) // 12
            return seg.annual_pay * (1 + fi.raise_pct_per_year) ** years
    return 0.0


def _monthly_costs(fi: FinanceInputs, pessimistic: bool) -> float:
    housing = fi.annual_housing_high if pessimistic else fi.annual_housing_low
    other = fi.annual_other_costs * (1 + OTHER_COST_SPREAD if pessimistic else 1 - OTHER_COST_SPREAD)
    return (housing + other) / 12


def savings_at(fi: FinanceInputs, month: int, pessimistic: bool) -> float:
    total = fi.start_savings
    costs = _monthly_costs(fi, pessimistic)
    for m in range(month):
        total += pay_at(fi, m) / 12 * (1 - fi.effective_tax_rate) - costs
    for c in fi.one_time_costs:
        if c.month < month:
            total -= c.amount
    return total


def point(fi: FinanceInputs, month: int) -> MonthPoint:
    lo = savings_at(fi, month, pessimistic=True)
    hi = savings_at(fi, month, pessimistic=False)
    burn_hi = _monthly_costs(fi, True)
    burn_lo = _monthly_costs(fi, False)
    return MonthPoint(
        savings_low=lo,
        savings_high=hi,
        runway_low=max(lo, 0) / burn_hi if burn_hi else 0,
        runway_high=max(hi, 0) / burn_lo if burn_lo else 0,
        annual_pay=pay_at(fi, month),
    )


def timeline(fi: FinanceInputs) -> dict[str, MonthPoint]:
    return {tp: point(fi, m) for tp, m in TIMEPOINT_MONTHS.items()}


def usd(v: float) -> str:
    sign = "−" if v < 0 else ""
    v = abs(v)
    if v >= 1_000_000:
        return f"{sign}${v / 1_000_000:.1f}M"
    if v >= 1000:
        return f"{sign}${round(v / 1000):,}K"
    return f"{sign}${round(v)}"


def usd_range(lo: float, hi: float) -> str:
    lo, hi = min(lo, hi), max(lo, hi)
    if hi < 0:  # both ends in debt: say it plainly
        return f"{usd(-hi)} to {usd(-lo)} in debt" if abs(hi - lo) >= 1000 else f"{usd(-(lo + hi) / 2)} in debt"
    if abs(hi - lo) < 1000:
        return usd((lo + hi) / 2)
    return f"{usd(lo)} to {usd(hi)}"
