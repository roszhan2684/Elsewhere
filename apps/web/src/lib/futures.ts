// 1,000 Futures: run both worlds through a thousand random lives, in the browser, with no model call.
//
// Each future draws life events from rough yearly base rates (a layoff, a medical bill, a rent spike,
// a raise...). Events that happen to *you* (illness, family) hit both paths the same way, so the two
// paths are compared on the same luck. Money math is the same engine as lib/finance.ts.

import { payAt } from "./finance.ts";
import { type PathKind, pathKind } from "./kinds.ts";
import type { Branch, FinanceInputs, Simulation } from "./types";

export const MONTHS = 60;
const BRANCHES: Branch[] = ["A", "B"];

// ---------------------------------------------------------------- random numbers

/** Small seeded generator, so a given seed always replays the same 1,000 futures. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();
const monthly = (yearly: number) => 1 - Math.pow(1 - Math.min(0.99, yearly), 1 / 12);

// ---------------------------------------------------------------- base rates

export type Effect =
  | { type: "income_gap"; months: [number, number]; nextPay: [number, number] } // income stops, then resumes at a multiple
  | { type: "pay_pause"; months: [number, number] } // income stops, then resumes unchanged
  | { type: "cost"; share: [number, number]; pauseMonths?: number } // one-off bill, as a share of yearly pay
  | { type: "raise"; mult: [number, number] }
  | { type: "housing"; mult: [number, number] }
  | { type: "windfall"; amount: [number, number] }
  | { type: "revenue"; share: [number, number] }; // own business starts paying, as a share of the other path's pay

export interface Hazard {
  id: string;
  label: string; // past tense, for a future's story
  shock: string; // label to send to the shock planner
  detail: string;
  yearly: number;
  effect: Effect;
  needsPay?: boolean; // only while this path is earning
  good?: boolean;
}

const LAYOFF = (yearly: number, label = "Laid off"): Hazard => ({
  id: "layoff", label, shock: `${label}`, detail: "The job ends; a search follows.", yearly,
  effect: { type: "income_gap", months: [2, 5], nextPay: [0.92, 1.06] }, needsPay: true,
});
const RAISE = (yearly: number): Hazard => ({
  id: "raise", label: "Got a raise or promotion", shock: "Promoted early", detail: "Pay jumps after strong work.", yearly,
  effect: { type: "raise", mult: [1.05, 1.14] }, needsPay: true, good: true,
});
const RENT = (yearly: number): Hazard => ({
  id: "rent", label: "Rent went up sharply", shock: "Rent jumps 12%", detail: "The landlord raises the rent at renewal.", yearly,
  effect: { type: "housing", mult: [1.06, 1.16] },
});

export const HAZARDS: Record<PathKind, Hazard[]> = {
  startup: [
    { id: "fold", label: "Startup shut down", shock: "Startup fails", detail: "The company runs out of money and shuts down.", yearly: 0.18,
      effect: { type: "income_gap", months: [2, 6], nextPay: [0.95, 1.15] }, needsPay: true },
    RAISE(0.12),
    { id: "exit", label: "Equity paid out", shock: "Startup gets acquired", detail: "An acquisition turns some equity into cash.", yearly: 0.02,
      effect: { type: "windfall", amount: [20000, 200000] }, good: true },
    RENT(0.1),
  ],
  stable: [LAYOFF(0.04), RAISE(0.14), RENT(0.1)],
  school: [LAYOFF(0.04, "Laid off after graduating"), RAISE(0.1), RENT(0.08)],
  own: [
    { id: "revenue", label: "Revenue started coming in", shock: "First paying customers arrive", detail: "The product starts paying you.", yearly: 0.14,
      effect: { type: "revenue", share: [0.3, 0.9] }, good: true },
    RENT(0.1),
  ],
  gig: [
    { id: "deactivated", label: "Deactivated by the app", shock: "Deactivated by the app", detail: "The platform suspends the account; income stops while appealing or switching.", yearly: 0.06,
      effect: { type: "income_gap", months: [1, 3], nextPay: [0.85, 1.0] }, needsPay: true },
    { id: "car", label: "Car broke down", shock: "Car breaks down", detail: "A major repair and weeks off the road.", yearly: 0.18,
      effect: { type: "cost", share: [0.04, 0.1], pauseMonths: 1 }, needsPay: true },
    RENT(0.1),
  ],
  migrant: [
    { id: "wages", label: "Employer held back wages", shock: "Wages withheld for 3 months", detail: "The employer delays salary for months.", yearly: 0.1,
      effect: { type: "pay_pause", months: [2, 4] }, needsPay: true },
    { id: "sent_home", label: "Contract ended early", shock: "Contract cancelled early", detail: "The contract ends and you look for new work.", yearly: 0.05,
      effect: { type: "income_gap", months: [2, 6], nextPay: [0.5, 0.9] }, needsPay: true },
    RAISE(0.08),
  ],
  hourly: [
    { id: "hours", label: "Hours cut or laid off", shock: "Laid off", detail: "Shifts dry up and the job ends.", yearly: 0.08,
      effect: { type: "income_gap", months: [1, 4], nextPay: [0.9, 1.05] }, needsPay: true },
    { id: "raise", label: "Got a raise", shock: "Promoted to shift lead", detail: "A promotion with a raise.", yearly: 0.1,
      effect: { type: "raise", mult: [1.03, 1.1] }, needsPay: true, good: true },
    RENT(0.1),
  ],
  care: [
    LAYOFF(0.03, "Lost the job"),
    { id: "raise", label: "Got a raise", shock: "Raise after a certification", detail: "A certification brings a raise.", yearly: 0.1,
      effect: { type: "raise", mult: [1.03, 1.08] }, needsPay: true, good: true },
    RENT(0.1),
  ],
};

/** Not random: what people do when their own business is about to drain their savings. */
export const FALLBACK: Hazard = {
  id: "fallback", label: "Went back to a job before savings ran out", shock: "Back to a job", detail: "Savings fall below three months of costs, so you take a job.",
  yearly: 0, effect: { type: "income_gap", months: [2, 4], nextPay: [0.85, 1] },
};

/** Things that happen to the person, whichever path they took. */
export const PERSONAL: Hazard[] = [
  { id: "medical", label: "Medical emergency", shock: "Medical emergency", detail: "An unexpected hospital bill and time off work.", yearly: 0.06,
    effect: { type: "cost", share: [0.04, 0.15] } },
  { id: "family", label: "Family emergency", shock: "Family needs you nearby", detail: "Family needs help: travel and money.", yearly: 0.05,
    effect: { type: "cost", share: [0.03, 0.1] } },
];

// ---------------------------------------------------------------- one future

export interface LifeEvent {
  month: number;
  branch: Branch | "both";
  hazard: Hazard;
}

export interface Future {
  events: LifeEvent[];
  end: Record<Branch, number>;
  minSavings: Record<Branch, number>;
}

interface PathState {
  fi: FinanceInputs;
  kind: PathKind;
  gapUntil: number;
  payMult: number;
  override: number | null; // fixed yearly pay (own business revenue)
  housingMult: number;
  housing: number;
  other: number;
  savings: number;
}

function basePay(st: PathState, m: number): number {
  if (st.override !== null) return st.override;
  return payAt(st.fi, m) * st.payMult;
}

export interface RunOptions {
  seed: number;
  n: number;
  roughness: number; // multiplies every yearly rate (1 = the defaults)
  keepTraces?: number;
}

export interface BranchStats {
  p10: number[];
  p50: number[];
  p90: number[];
  debtPct: number; // share of futures where savings ever go below zero
  medianEnd: number;
  p10End: number;
  p90End: number;
  traces: number[][];
  plannedDebt: boolean; // the plan itself goes below zero (tuition, startup costs)
}

export interface FuturesResult {
  n: number;
  seed: number;
  branches: Record<Branch, BranchStats>;
  aheadA: number; // share of futures where A ends year 5 with more savings
  futures: Future[];
}

function pct(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function plannedMin(fi: FinanceInputs): number {
  let s = fi.start_savings;
  let min = s;
  const costs = (fi.annual_housing_low + fi.annual_housing_high) / 2 + fi.annual_other_costs;
  for (let m = 0; m < MONTHS; m++) {
    s += (payAt(fi, m) / 12) * (1 - fi.effective_tax_rate) - costs / 12;
    for (const c of fi.one_time_costs) if (c.month === m) s -= c.amount;
    min = Math.min(min, s);
  }
  return min;
}

export function runFutures(sim: Simulation, opts: RunOptions): FuturesResult {
  const r = rng(opts.seed);
  const kinds: Record<Branch, PathKind> = {
    A: pathKind(sim.decision.path_a),
    B: pathKind(sim.decision.path_b),
  };
  const startPay = (b: Branch) => Math.max(payAt(sim.branches[b].finance_inputs, 0), sim.branches[b].finance_inputs.annual_pay);
  const personPay = Math.max(1, (startPay("A") + startPay("B")) / 2);
  const ends: Record<Branch, number[]> = { A: [], B: [] };
  const series: Record<Branch, number[][]> = { A: [], B: [] }; // [month][future]
  for (const b of BRANCHES) for (let m = 0; m <= MONTHS; m++) series[b].push([]);
  const traces: Record<Branch, number[][]> = { A: [], B: [] };
  const debt: Record<Branch, number> = { A: 0, B: 0 };
  let aheadA = 0;
  const futures: Future[] = [];
  const keep = opts.keepTraces ?? 70;

  for (let i = 0; i < opts.n; i++) {
    const events: LifeEvent[] = [];
    // Personal events first, shared by both paths.
    const personal: { month: number; h: Hazard; share: number }[] = [];
    for (const h of PERSONAL) {
      const p = monthly(h.yearly * opts.roughness);
      for (let m = 0; m < MONTHS; m++) {
        if (r() < p) {
          const eff = h.effect as Extract<Effect, { type: "cost" }>;
          personal.push({ month: m, h, share: between(r, eff.share[0], eff.share[1]) });
          events.push({ month: m, branch: "both", hazard: h });
        }
      }
    }
    const housingDraw = r();
    const otherDraw = r();
    const states: Record<Branch, PathState> = {} as Record<Branch, PathState>;
    for (const b of BRANCHES) {
      const fi = sim.branches[b].finance_inputs;
      states[b] = {
        fi, kind: kinds[b], gapUntil: -1, payMult: 1, override: null, housingMult: 1,
        housing: fi.annual_housing_low + (fi.annual_housing_high - fi.annual_housing_low) * housingDraw,
        other: fi.annual_other_costs * (0.9 + 0.2 * otherDraw),
        savings: fi.start_savings,
      };
    }
    const mins: Record<Branch, number> = { A: Infinity, B: Infinity };
    for (const b of BRANCHES) {
      const st = states[b];
      const hazards = HAZARDS[st.kind];
      const other = b === "A" ? "B" : "A";
      let min = st.savings;
      const tr: number[] = [st.savings];
      series[b][0].push(st.savings);
      for (let m = 0; m < MONTHS; m++) {
        const earning = m >= st.gapUntil && basePay(st, m) > 0;
        let extra = 0;
        for (const h of hazards) {
          if (h.needsPay && !earning) continue;
          if (h.effect.type === "revenue" && st.override !== null) continue;
          if (r() >= monthly(h.yearly * opts.roughness)) continue;
          events.push({ month: m, branch: b, hazard: h });
          const e = h.effect;
          if (e.type === "income_gap") {
            st.gapUntil = m + Math.round(between(r, e.months[0], e.months[1]));
            st.payMult *= between(r, e.nextPay[0], e.nextPay[1]);
          } else if (e.type === "pay_pause") {
            st.gapUntil = m + Math.round(between(r, e.months[0], e.months[1]));
          } else if (e.type === "cost") {
            extra += Math.max(300, between(r, e.share[0], e.share[1]) * Math.max(basePay(st, m), personPay * 0.5));
            if (e.pauseMonths) st.gapUntil = Math.max(st.gapUntil, m + e.pauseMonths);
          } else if (e.type === "raise") {
            st.payMult *= between(r, e.mult[0], e.mult[1]);
          } else if (e.type === "housing") {
            st.housingMult *= between(r, e.mult[0], e.mult[1]);
          } else if (e.type === "windfall") {
            extra -= between(r, e.amount[0], e.amount[1]);
          } else if (e.type === "revenue") {
            st.override = Math.round(startPay(other) * between(r, e.share[0], e.share[1]));
          }
        }
        for (const pe of personal) if (pe.month === m) extra += Math.max(300, pe.share * personPay);
        // People building their own thing go back to a job before savings hit zero.
        const monthCost = (st.housing * st.housingMult + st.other) / 12;
        if (st.kind === "own" && st.override === null && basePay(st, m) === 0 && st.savings < 3 * monthCost) {
          events.push({ month: m, branch: b, hazard: FALLBACK });
          st.override = Math.round(startPay(other) * between(r, 0.85, 1));
          st.gapUntil = m + Math.round(between(r, 2, 4));
        }
        const pay = m < st.gapUntil ? 0 : basePay(st, m);
        st.savings += (pay / 12) * (1 - st.fi.effective_tax_rate) - (st.housing * st.housingMult + st.other) / 12 - extra;
        for (const c of st.fi.one_time_costs) if (c.month === m) st.savings -= c.amount;
        min = Math.min(min, st.savings);
        series[b][m + 1].push(st.savings);
        if (i < keep) tr.push(st.savings);
      }
      if (i < keep) traces[b].push(tr);
      if (min < 0) debt[b]++;
      mins[b] = min;
      ends[b].push(st.savings);
    }
    if (states.A.savings > states.B.savings) aheadA++;
    events.sort((x, y) => x.month - y.month);
    futures.push({ events, end: { A: states.A.savings, B: states.B.savings }, minSavings: mins });
  }

  const stats = {} as Record<Branch, BranchStats>;
  for (const b of BRANCHES) {
    const p10: number[] = [], p50: number[] = [], p90: number[] = [];
    for (const col of series[b]) {
      const s = [...col].sort((x, y) => x - y);
      p10.push(pct(s, 0.1));
      p50.push(pct(s, 0.5));
      p90.push(pct(s, 0.9));
    }
    const e = [...ends[b]].sort((x, y) => x - y);
    stats[b] = {
      p10, p50, p90, traces: traces[b],
      debtPct: debt[b] / opts.n,
      medianEnd: pct(e, 0.5), p10End: pct(e, 0.1), p90End: pct(e, 0.9),
      plannedDebt: plannedMin(sim.branches[b].finance_inputs) < 0,
    };
  }
  return { n: opts.n, seed: opts.seed, branches: stats, aheadA: aheadA / opts.n, futures };
}

// ---------------------------------------------------------------- Life Roulette

export interface RouletteDraw {
  label: string;
  description: string;
  month: number;
  hazard: Hazard;
  branch: Branch | "both";
}

/** Draws one realistic surprise for the stress test, weighted by how often it happens. */
export function rollLifeEvent(sim: Simulation, seed: number): RouletteDraw {
  const r = rng(seed);
  const pool: { h: Hazard; branch: Branch | "both" }[] = [];
  for (const b of BRANCHES) {
    const p = b === "A" ? sim.decision.path_a : sim.decision.path_b;
    for (const h of HAZARDS[pathKind(p)]) pool.push({ h, branch: b });
  }
  for (const h of PERSONAL) pool.push({ h, branch: "both" });
  const total = pool.reduce((a, x) => a + x.h.yearly, 0);
  let pick = r() * total;
  let chosen = pool[0];
  for (const x of pool) {
    pick -= x.h.yearly;
    if (pick <= 0) {
      chosen = x;
      break;
    }
  }
  const month = 3 + Math.floor(r() * 40);
  const where = chosen.branch === "both" ? "" : ` (Path ${chosen.branch})`;
  return {
    label: `${chosen.h.shock}${where}`.slice(0, 120),
    description: chosen.h.detail,
    month,
    hazard: chosen.h,
    branch: chosen.branch,
  };
}

/** Every hazard either path can draw, for the "what's in the dice" table. */
export function hazardTable(sim: Simulation): { branch: Branch | "both"; hazard: Hazard }[] {
  const out: { branch: Branch | "both"; hazard: Hazard }[] = [];
  for (const b of BRANCHES) {
    const p = b === "A" ? sim.decision.path_a : sim.decision.path_b;
    for (const h of HAZARDS[pathKind(p)]) out.push({ branch: b, hazard: h });
  }
  for (const h of PERSONAL) out.push({ branch: "both", hazard: h });
  return out;
}
