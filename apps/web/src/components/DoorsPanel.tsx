"use client";

import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { type DoorAssumptions, type DoorReport, type DoorState, DOOR_MONTHS, defaultAssumptions, doorReport } from "@/lib/doors";
import { usd } from "@/lib/finance";
import type { Branch, Simulation } from "@/lib/types";

const STATE_CLASS: Record<DoorState, string> = { open: "bg-ok", narrowing: "bg-warn", closed: "bg-shock" };
const STATE_WORD: Record<DoorState, string> = { open: "Open", narrowing: "Narrowing", closed: "Closed" };
const moneyFmt = { style: "currency", currency: "USD", maximumFractionDigits: 0 } as const;

export function doorSentence(r: DoorReport, sim: Simulation): string {
  const to = sim.branches[r.to].label;
  if (r.closesAt === 0) return `From Path ${r.from}, switching to “${to}” is out of reach from the start: your savings on this path can’t cover the gap.`;
  if (r.closesAt === null) return `From Path ${r.from}, you can still switch to “${to}” at year 5: your savings keep covering the cost.`;
  const at = r.months[Math.max(0, r.closesAt - 1)];
  return `From Path ${r.from}, you can switch to “${to}” until about month ${r.closesAt - 1} (for roughly ${usd(at.total)}). After that, switching costs more than you’d have saved.`;
}

/** Idea: how long each door stays open, and what it costs to walk back through it. Plain math, no model call. */
export function DoorsPanel({ sim }: { sim: Simulation }) {
  const defaults = useMemo(() => defaultAssumptions(sim), [sim]);
  const [a, setA] = useState<DoorAssumptions>(defaults);
  const [month, setMonth] = useState(12);
  const reports = useMemo(() => (["A", "B"] as Branch[]).map((b) => doorReport(sim, b, a)), [sim, a]);

  const set = (k: keyof DoorAssumptions) => (e: React.ChangeEvent<HTMLInputElement>) => setA((x) => ({ ...x, [k]: Number(e.target.value) }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-2">
        <span className="label-mono">Can I change my mind later?</span>
        <h3 className="font-display text-[28px] leading-tight sm:text-[34px]">Every choice has a door back. Here’s when each one closes.</h3>
        <p className="text-[15px] leading-relaxed text-soft">
          Switching later means a job search with no pay, maybe a move, maybe tuition up front. The longer you’re away, the longer the search. A door is <b className="font-medium text-ok">open</b> while your savings cover the switch plus a safety buffer, <b className="font-medium text-warn">narrowing</b> when they barely cover it, and <b className="font-medium text-shock">closed</b> when they can’t.
        </p>
      </div>

      <div className="flex flex-col gap-5 rounded-2xl bg-ink-2 p-5">
        {reports.map((r) => {
          const d = r.months[month];
          return (
            <div key={r.from} className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px]">
                  <b className={clsx("font-medium", r.from === "A" ? "text-path-a" : "text-path-b")}>On Path {r.from}</b>
                  <span className="text-soft"> → switching to {sim.branches[r.to].label}</span>
                </span>
                <span className="font-mono text-[12px] text-muted">{r.closesAt === null ? "open through year 5" : r.closesAt === 0 ? "closed from day one" : `closes ~month ${r.closesAt - 1}`}</span>
              </div>
              <div className="relative flex h-7 gap-[2px]" role="img" aria-label={doorSentence(r, sim)}>
                {r.months.map((m) => (
                  <button key={m.month} type="button" tabIndex={-1} onClick={() => setMonth(m.month)} title={`Month ${m.month}: ${STATE_WORD[m.state]}`}
                    className={clsx("flex-1 rounded-[2px] transition-opacity", STATE_CLASS[m.state], m.month === month ? "opacity-100" : "opacity-55 hover:opacity-90")} />
                ))}
              </div>
              <p className="text-[14px] leading-relaxed text-paper-2">{doorSentence(r, sim)}</p>
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-raised p-3.5 text-[13px] sm:grid-cols-4">
                <Cell label={`Cost at month ${month}`} value={<NumberFlow value={d.total} format={moneyFmt} />} />
                <Cell label="Search with no pay" value={d.searchMonths ? `${d.searchMonths.toFixed(1)} months` : "none"} />
                <Cell label={d.upfront ? "Move + upfront" : "Moving"} value={usd(d.moveCost + d.upfront)} />
                <Cell label="Savings you’d have" value={<span className={d.available < 0 ? "text-shock" : undefined}><NumberFlow value={d.available} format={moneyFmt} /></span>} />
              </div>
              {r.notes.map((n) => <p key={n} className="text-[12px] text-muted">{n}</p>)}
            </div>
          );
        })}
        <label className="flex flex-col gap-2 pt-1 text-[13px] text-muted">
          <span className="flex justify-between"><span>If you changed your mind at…</span><span className="font-mono text-paper">month {month}</span></span>
          <input type="range" min={0} max={DOOR_MONTHS} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="accent-paper" />
        </label>
      </div>

      <details className="rounded-2xl border border-line p-5">
        <summary className="cursor-pointer text-[14px] text-paper-2">Assumptions behind the doors (yours to change)</summary>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Slider label="Job search if you switched right away" value={`${a.baseSearch} months`} min={0} max={6} step={0.5} v={a.baseSearch} onChange={set("baseSearch")} />
          <Slider label="Extra search per year away" value={`${a.extraPerYear} months`} min={0} max={3} step={0.5} v={a.extraPerYear} onChange={set("extraPerYear")} />
          <Slider label="Longest search" value={`${a.maxSearch} months`} min={2} max={18} step={1} v={a.maxSearch} onChange={set("maxSearch")} />
          <Slider label="Cost to move cities" value={usd(a.moveCost)} min={0} max={15000} step={100} v={a.moveCost} onChange={set("moveCost")} />
          <Slider label="Safety buffer you’d want left" value={`${a.bufferMonths} months of costs`} min={0} max={6} step={1} v={a.bufferMonths} onChange={set("bufferMonths")} />
        </div>
        <button type="button" onClick={() => setA(defaults)} className="mt-4 min-h-10 rounded-full border border-line-2 px-4 text-[13px]">Reset</button>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">All of these are ASSUMPTIONS. Savings come from the same finance engine as the worlds above, on the cautious end of the range.</p>
      </details>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <span className="font-display text-[19px] leading-tight">{value}</span>
    </div>
  );
}

function Slider({ label, value, min, max, step, v, onChange }: { label: string; value: string; min: number; max: number; step: number; v: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex justify-between gap-3 text-[14px]"><span>{label}</span><span className="font-mono text-[13px]">{value}</span></span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={onChange} className="accent-paper" />
    </label>
  );
}
