// Values Compass: how well each world serves what the user said matters, and where it pulls apart.

import { savingsMid, usd } from "./finance.ts";
import type { Branch, Simulation, Timepoint } from "./types";
import { TIMEPOINTS } from "./types.ts";

export const VALUE_KEYS = ["learning", "stability", "ownership", "location", "autonomy"] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];
export const VALUE_LABEL: Record<ValueKey, string> = {
  learning: "Learning",
  stability: "Stability",
  ownership: "Ownership",
  location: "Place",
  autonomy: "Autonomy",
};

export type Weights = Record<ValueKey, number>;

/** Score 1-5 for a value in a branch at a timepoint, falling back to the nearest known timepoint. */
export function valueScore(sim: Simulation, b: Branch, k: ValueKey, tp: Timepoint): number | null {
  const order = [tp, ...TIMEPOINTS.filter((t) => t !== tp).sort((x, y) => Math.abs(TIMEPOINTS.indexOf(x) - TIMEPOINTS.indexOf(tp)) - Math.abs(TIMEPOINTS.indexOf(y) - TIMEPOINTS.indexOf(tp)))];
  for (const t of order) {
    const s = sim.branches[b].snapshots.find((x) => x.timepoint === t);
    const c = s?.values_fit[k];
    if (c?.range && c.status === "known") return (c.range.low + c.range.high) / 2;
    const m = c?.text?.match(/^(\d)(?:\/5)?/);
    if (m) return Number(m[1]);
  }
  return null;
}

export function scores(sim: Simulation, b: Branch, tp: Timepoint): Record<ValueKey, number | null> {
  return Object.fromEntries(VALUE_KEYS.map((k) => [k, valueScore(sim, b, k, tp)])) as Record<ValueKey, number | null>;
}

/** Weighted fit, 0-1. Unknown scores are left out. */
export function fit(s: Record<ValueKey, number | null>, w: Weights): number {
  let num = 0;
  let den = 0;
  for (const k of VALUE_KEYS) {
    const v = s[k];
    if (v == null) continue;
    num += w[k] * v;
    den += w[k] * 5;
  }
  return den ? num / den : 0;
}

export interface Tension {
  kind: "neither" | "split" | "money";
  text: string;
}

export function tensions(sim: Simulation, w: Weights, tp: Timepoint): Tension[] {
  const sa = scores(sim, "A", tp);
  const sb = scores(sim, "B", tp);
  const out: Tension[] = [];
  for (const k of VALUE_KEYS) {
    const a = sa[k];
    const b = sb[k];
    if (a == null || b == null) continue;
    if (w[k] >= 4 && a <= 2 && b <= 2) {
      out.push({ kind: "neither", text: `${VALUE_LABEL[k]} matters a lot to you (${w[k]}/5), but neither path gives you much of it.` });
    }
  }
  const splits = VALUE_KEYS.filter((k) => sa[k] != null && sb[k] != null)
    .map((k) => ({ k, d: (sa[k]! - sb[k]!) * w[k] }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  if (splits[0] && Math.abs(splits[0].d) >= 2) {
    const k = splits[0].k;
    const winner = splits[0].d > 0 ? "A" : "B";
    out.push({ kind: "split", text: `The biggest trade is ${VALUE_LABEL[k].toLowerCase()}: Path ${winner} gives you ${Math.max(sa[k]!, sb[k]!)}/5, the other ${Math.min(sa[k]!, sb[k]!)}/5.` });
  }
  const fa = fit(sa, w);
  const fb = fit(sb, w);
  const money = savingsMid(sim.branches.A.finance_inputs, 60) - savingsMid(sim.branches.B.finance_inputs, 60);
  const valuesWinner: Branch | null = Math.abs(fa - fb) < 0.03 ? null : fa > fb ? "A" : "B";
  const moneyWinner: Branch = money >= 0 ? "A" : "B";
  if (valuesWinner && valuesWinner !== moneyWinner && Math.abs(money) > 1000) {
    out.push({ kind: "money", text: `Your values point to Path ${valuesWinner}; the money points to Path ${moneyWinner}, by about ${usd(Math.abs(money))} at year 5.` });
  }
  return out;
}

export function valuesPick(sim: Simulation, w: Weights, tp: Timepoint = "m24"): { pick: Branch | "tie"; fitA: number; fitB: number } {
  const fitA = fit(scores(sim, "A", tp), w);
  const fitB = fit(scores(sim, "B", tp), w);
  return { pick: Math.abs(fitA - fitB) < 0.02 ? "tie" : fitA > fitB ? "A" : "B", fitA, fitB };
}
