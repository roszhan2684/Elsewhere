// Reality check-in: compare how life actually went with what each simulated world expected.

import { payAt, savingsRange, usd } from "./finance.ts";
import type { Branch, Checkin, Simulation, Snapshot } from "./types";

export type Metric = "savings" | "pay" | "stress" | "hours";
export const METRIC_LABEL: Record<Metric, string> = { savings: "Savings", pay: "Yearly pay", stress: "Stress (1–5)", hours: "Hours a week" };

export interface MetricCompare {
  metric: Metric;
  actual: number;
  ranges: Record<Branch, [number, number] | null>;
  distance: Record<Branch, number | null>; // 0 = inside the range; 1 = one range-width away
}

export interface CheckinResult {
  metrics: MetricCompare[];
  closeness: Record<Branch, number>; // 0-1
  closer: Branch | "tie";
  calibration: string[];
}

const TP_MONTHS: [Snapshot["timepoint"], number][] = [["m0", 0], ["m6", 6], ["m24", 24], ["m60", 60]];

function nearest(sim: Simulation, b: Branch, month: number): Snapshot {
  const tp = [...TP_MONTHS].sort((x, y) => Math.abs(x[1] - month) - Math.abs(y[1] - month))[0][0];
  return sim.branches[b].snapshots.find((s) => s.timepoint === tp)!;
}

function stressRange(s: Snapshot): [number, number] | null {
  const c = s.lifestyle.stress;
  if (c.range && c.range.unit === "score_1_5") return [c.range.low, c.range.high];
  const t = (c.text ?? "").toLowerCase();
  const n = t.match(/(\d)\s*\/\s*5/);
  if (n) return [Number(n[1]), Number(n[1])];
  if (/very high|extreme/.test(t)) return [4.5, 5];
  if (/high/.test(t)) return [3.5, 5];
  if (/medium|moderate/.test(t)) return [2.5, 3.5];
  if (/low/.test(t)) return [1, 2.5];
  return null;
}

function hoursRange(s: Snapshot): [number, number] | null {
  const c = s.lifestyle.work_hours;
  if (c.range) return [c.range.low, c.range.high];
  const m = (c.text ?? "").match(/(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function expected(sim: Simulation, b: Branch, metric: Metric, month: number): [number, number] | null {
  const fi = sim.branches[b].finance_inputs;
  if (metric === "savings") return savingsRange(fi, month);
  if (metric === "pay") {
    const p = payAt(fi, month);
    return [p * 0.95, p * 1.05];
  }
  const s = nearest(sim, b, month);
  return metric === "stress" ? stressRange(s) : hoursRange(s);
}

const FLOOR: Record<Metric, number> = { savings: 2000, pay: 2000, stress: 1, hours: 5 };

function distance(actual: number, r: [number, number] | null, metric: Metric): number | null {
  if (!r) return null;
  const [lo, hi] = r[0] <= r[1] ? r : [r[1], r[0]];
  if (actual >= lo && actual <= hi) return 0;
  const scale = Math.max(hi - lo, Math.abs((lo + hi) / 2) * 0.25, FLOOR[metric]);
  return Math.min(3, Math.min(Math.abs(actual - lo), Math.abs(actual - hi)) / scale);
}

export function compareCheckin(sim: Simulation, c: Checkin): CheckinResult {
  const actuals: [Metric, number | null][] = [["savings", c.savings_usd], ["pay", c.annual_pay_usd], ["stress", c.stress], ["hours", c.hours_per_week]];
  const metrics: MetricCompare[] = [];
  for (const [metric, actual] of actuals) {
    if (actual == null) continue;
    const ranges = { A: expected(sim, "A", metric, c.month), B: expected(sim, "B", metric, c.month) };
    metrics.push({ metric, actual, ranges, distance: { A: distance(actual, ranges.A, metric), B: distance(actual, ranges.B, metric) } });
  }
  const close = (b: Branch) => {
    const ds = metrics.map((m) => m.distance[b]).filter((d): d is number => d !== null);
    return ds.length ? 1 - ds.reduce((a, d) => a + Math.min(d, 2), 0) / ds.length / 2 : 0;
  };
  const closeness = { A: close("A"), B: close("B") };
  const closer: Branch | "tie" = Math.abs(closeness.A - closeness.B) < 0.05 ? "tie" : closeness.A > closeness.B ? "A" : "B";

  const calibration: string[] = [];
  if (c.took !== "neither") {
    for (const m of metrics) {
      const r = m.ranges[c.took];
      if (!r || m.distance[c.took] === 0) continue;
      const lo = Math.min(...r);
      const hi = Math.max(...r);
      const above = m.actual > hi;
      const gap = above ? m.actual - hi : lo - m.actual;
      if (m.metric === "savings") calibration.push(`Your savings are ${usd(gap)} ${above ? "above" : "below"} the lowest-to-highest range World ${c.took} expected, so the simulation was ${above ? "too cautious" : "too optimistic"} about money.`);
      else if (m.metric === "pay") calibration.push(`You earn ${usd(gap)} a year ${above ? "more" : "less"} than World ${c.took} assumed.`);
      else if (m.metric === "stress") calibration.push(`Life feels ${above ? "more" : "less"} stressful than World ${c.took} predicted.`);
      else calibration.push(`You work ${Math.round(gap)} hours a week ${above ? "more" : "less"} than World ${c.took} predicted.`);
    }
    if (!calibration.length && metrics.length) calibration.push(`Everything you reported sits inside World ${c.took}'s ranges. The simulation held up so far.`);
  }
  return { metrics, closeness, closer, calibration };
}

export function fmtMetric(m: Metric, v: number): string {
  if (m === "savings" || m === "pay") return usd(v);
  if (m === "stress") return `${Math.round(v * 10) / 10}`;
  return `${Math.round(v)}`;
}

/** A calendar file that reminds you to come back. */
export function reminderIcs(title: string, url: string, months: number, now = new Date()): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() + months);
  const day = d.toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Elsewhere//Check-in//EN", "BEGIN:VEVENT",
    `UID:${stamp}-${Math.random().toString(36).slice(2)}@elsewhere`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`,
    `SUMMARY:${esc(`Elsewhere check-in: ${title}`)}`,
    `DESCRIPTION:${esc(`${months} months ago you explored this decision. Which world are you living in? ${url}`)}`,
    `URL:${url}`, "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
