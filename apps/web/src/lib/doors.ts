// Door-Closing Meter: for each month, what it would cost to change your mind and switch to the
// other path, and whether your savings on this path could cover it. Plain math, no model call.

import { payAt, savingsAt } from "./finance.ts";
import { pathKind } from "./kinds.ts";
import type { Branch, FinanceInputs, Simulation } from "./types";

export const DOOR_MONTHS = 60;

export interface DoorAssumptions {
  baseSearch: number; // months to land the other path if you switched right away
  extraPerYear: number; // extra search months per year spent away from it
  maxSearch: number;
  moveCost: number; // one-off cost to move cities (0 if both paths are in the same city)
  bufferMonths: number; // months of living costs you'd want left after switching
}

export type DoorState = "open" | "narrowing" | "closed";

export interface DoorMonth {
  month: number;
  searchMonths: number;
  livingCost: number;
  moveCost: number;
  upfront: number; // tuition or fees the other path needs up front
  total: number;
  available: number; // savings on the current path at this month (pessimistic)
  state: DoorState;
}

export interface DoorReport {
  from: Branch;
  to: Branch;
  months: DoorMonth[];
  closesAt: number | null; // first month after which the door never reopens
  openUntil: number | null; // last month it is fully open
  notes: string[];
}

const monthlyCosts = (fi: FinanceInputs) => ((fi.annual_housing_low + fi.annual_housing_high) / 2 + fi.annual_other_costs) / 12;

export function defaultAssumptions(sim: Simulation): DoorAssumptions {
  const a = sim.decision.path_a;
  const b = sim.decision.path_b;
  const sameCity = !!a.city && !!b.city && a.city === b.city;
  const pay = Math.max(1, (payAt(sim.branches.A.finance_inputs, 0) + payAt(sim.branches.B.finance_inputs, 0)) / 2 || 40000);
  return {
    baseSearch: 2,
    extraPerYear: 1,
    maxSearch: 9,
    moveCost: sameCity ? 0 : Math.round(Math.min(6000, Math.max(300, pay * 0.06)) / 100) * 100,
    bufferMonths: 3,
  };
}

export function doorReport(sim: Simulation, from: Branch, a: DoorAssumptions): DoorReport {
  const to: Branch = from === "A" ? "B" : "A";
  const fiFrom = sim.branches[from].finance_inputs;
  const fiTo = sim.branches[to].finance_inputs;
  const toSpec = to === "A" ? sim.decision.path_a : sim.decision.path_b;
  const fromSpec = from === "A" ? sim.decision.path_a : sim.decision.path_b;
  const toSchool = pathKind(toSpec) === "school";
  const upfront = toSchool ? fiTo.one_time_costs.filter((c) => c.month === 0).reduce((s, c) => s + Math.max(0, c.amount), 0) : 0;
  const costs = monthlyCosts(fiFrom);
  const months: DoorMonth[] = [];
  for (let m = 0; m <= DOOR_MONTHS; m++) {
    // School starts on an intake: you keep earning until it begins, so there's no search gap.
    const searchMonths = toSchool ? 0 : Math.min(a.maxSearch, a.baseSearch + (a.extraPerYear * m) / 12);
    const livingCost = searchMonths * costs;
    const total = livingCost + a.moveCost + upfront;
    const available = savingsAt(fiFrom, m, true);
    const buffer = a.bufferMonths * costs;
    const state: DoorState = available >= total + buffer ? "open" : available >= total ? "narrowing" : "closed";
    months.push({ month: m, searchMonths, livingCost, moveCost: a.moveCost, upfront, total, available, state });
  }
  let closesAt: number | null = null;
  for (let m = DOOR_MONTHS; m >= 0; m--) {
    if (months[m].state !== "closed") {
      closesAt = m === DOOR_MONTHS ? null : m + 1;
      break;
    }
    if (m === 0) closesAt = 0;
  }
  let openUntil: number | null = null;
  for (const d of months) {
    if (d.state === "open") openUntil = d.month;
    else if (openUntil !== null) break;
  }
  const notes: string[] = [];
  if (fiFrom.equity_note && pathKind(fromSpec) === "startup") {
    notes.push("Leaving before month 12 usually forfeits unvested equity (a common one-year cliff). That isn’t counted in the cost.");
  }
  if (toSchool) notes.push("Switching into school means paying the first tuition bill up front; there’s no job search, so it’s counted as an upfront cost.");
  if (pathKind(toSpec) === "migrant") notes.push("Work abroad usually needs a new offer, visa and travel; recruitment fees aren’t counted here.");
  return { from, to, months, closesAt, openUntil, notes };
}
