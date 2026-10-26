// TypeScript port of services/api/elsewhere/engine/finance.py.
// Powers the "What decides this?" chart instantly in the browser.
// Both engines are checked against packages/evals/finance_golden.json.

import type { FinanceInputs, PaySegment } from "./types";

const OTHER_COST_SPREAD = 0.1;

export function segments(fi: FinanceInputs): PaySegment[] {
  if (fi.pay_segments.length) return [...fi.pay_segments].sort((a, b) => a.start_month - b.start_month);
  return [{ start_month: 0, end_month: null, annual_pay: fi.annual_pay, label: "base pay" }];
}

export function payAt(fi: FinanceInputs, month: number): number {
  const segs = segments(fi);
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.start_month <= month && (s.end_month === null || month < s.end_month)) {
      const years = Math.floor((month - s.start_month) / 12);
      return s.annual_pay * Math.pow(1 + fi.raise_pct_per_year, years);
    }
  }
  return 0;
}

function monthlyCosts(fi: FinanceInputs, pessimistic: boolean): number {
  const housing = pessimistic ? fi.annual_housing_high : fi.annual_housing_low;
  const other = fi.annual_other_costs * (pessimistic ? 1 + OTHER_COST_SPREAD : 1 - OTHER_COST_SPREAD);
  return (housing + other) / 12;
}

export function savingsAt(fi: FinanceInputs, month: number, pessimistic: boolean): number {
  let total = fi.start_savings;
  const costs = monthlyCosts(fi, pessimistic);
  for (let m = 0; m < month; m++) total += (payAt(fi, m) / 12) * (1 - fi.effective_tax_rate) - costs;
  for (const c of fi.one_time_costs) if (c.month < month) total -= c.amount;
  return total;
}

export function savingsRange(fi: FinanceInputs, month: number): [number, number] {
  return [savingsAt(fi, month, true), savingsAt(fi, month, false)];
}

export function savingsMid(fi: FinanceInputs, month: number): number {
  const [lo, hi] = savingsRange(fi, month);
  return (lo + hi) / 2;
}

export function usd(v: number): string {
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1000) return `${sign}$${Math.round(a / 1000).toLocaleString("en-US")}K`;
  return `${sign}$${Math.round(a)}`;
}

/** Find the job-search gap segment a shock created, if any. */
export function gapSegment(fi: FinanceInputs): { index: number; months: number } | null {
  const segs = fi.pay_segments;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (s.annual_pay === 0 && s.end_month !== null) return { index: i, months: s.end_month - s.start_month };
  }
  return null;
}

export function withGap(fi: FinanceInputs, months: number): FinanceInputs {
  const g = gapSegment(fi);
  if (!g) return fi;
  const segs = fi.pay_segments.map((s) => ({ ...s }));
  const s = segs[g.index];
  s.end_month = s.start_month + months;
  segs[g.index + 1].start_month = s.end_month;
  return { ...fi, pay_segments: segs };
}
