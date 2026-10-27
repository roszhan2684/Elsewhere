"use client";

import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { findTipping } from "@/lib/breakeven";
import { gapSegment, savingsMid, segments, usd, withGap } from "@/lib/finance";
import type { Branch, FinanceInputs, Simulation } from "@/lib/types";

interface Lever {
  key: string;
  branch: Branch;
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  fmt: (v: number) => string;
  apply: (fi: FinanceInputs, v: number) => FinanceInputs;
  edit: string;
}

function levers(sim: Simulation): Lever[] {
  const out: Lever[] = [];
  for (const b of ["A", "B"] as Branch[]) {
    const fi = sim.branches[b].finance_inputs;
    const city = sim.branches[b].snapshots[0].location.city.text ?? `Path ${b}`;
    const gap = gapSegment(fi);
    if (gap) {
      out.push({
        key: `gap${b}`, branch: b, label: `Job search after the shock (${b})`, min: 0, max: 9, step: 1, initial: gap.months,
        fmt: (v) => `${v} month${v === 1 ? "" : "s"}`, apply: (f, v) => withGap(f, v), edit: "job_search_months",
      });
      const last = fi.pay_segments.at(-1)!;
      out.push({
        key: `next${b}`, branch: b, label: `Pay in the next role (${b})`, min: Math.round(last.annual_pay * 0.7 / 5000) * 5000,
        max: Math.round(last.annual_pay * 1.3 / 5000) * 5000, step: 5000, initial: last.annual_pay, fmt: (v) => `${usd(v)}/yr`,
        apply: (f, v) => ({ ...f, pay_segments: f.pay_segments.map((s, i, a) => (i === a.length - 1 ? { ...s, annual_pay: v } : s)) }), edit: "next_pay",
      });
    }
    const mid = (fi.annual_housing_low + fi.annual_housing_high) / 2;
    out.push({
      key: `house${b}`, branch: b, label: `Housing in ${city} (${b})`, min: Math.round(mid * 0.6 / 1000) * 1000, max: Math.round(mid * 1.4 / 1000) * 1000,
      step: 1000, initial: Math.round(mid / 1000) * 1000, fmt: (v) => `${usd(v)}/yr`,
      apply: (f, v) => ({ ...f, annual_housing_low: v * 0.9, annual_housing_high: v * 1.1 }), edit: "annual_housing",
    });
    out.push({
      key: `tax${b}`, branch: b, label: `Tax rate (${b})`, min: Math.max(0, +(fi.effective_tax_rate - 0.08).toFixed(2)),
      max: +(fi.effective_tax_rate + 0.08).toFixed(2), step: 0.01, initial: +fi.effective_tax_rate.toFixed(2), fmt: (v) => `${Math.round(v * 100)}%`,
      apply: (f, v) => ({ ...f, effective_tax_rate: v }), edit: "effective_tax_rate",
    });
  }
  return out;
}

/** Idea 4: which assumption decides the outcome. Plain math in the browser — no model call. */
export function DecidesPanel({ sim, ensureLive, onUpdated }: { sim: Simulation; ensureLive: () => Promise<string>; onUpdated: (s: Simulation) => void }) {
  const all = useMemo(() => levers(sim), [sim]);
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries(all.map((l) => [l.key, l.initial])));
  const [horizon, setHorizon] = useState<24 | 60>(24);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inputsFor = (b: Branch, override?: { key: string; v: number }) => {
    let fi = sim.branches[b].finance_inputs;
    for (const l of all) if (l.branch === b) fi = l.apply(fi, override?.key === l.key ? override.v : vals[l.key] ?? l.initial);
    return fi;
  };
  const gapWith = (override?: { key: string; v: number }) => savingsMid(inputsFor("A", override), horizon) - savingsMid(inputsFor("B", override), horizon);
  const gap = gapWith();
  const bars = all
    .map((l) => {
      const lo = gapWith({ key: l.key, v: l.min });
      const hi = gapWith({ key: l.key, v: l.max });
      return { l, lo, hi, swing: Math.abs(hi - lo) };
    })
    .sort((a, b) => b.swing - a.swing);
  const maxSwing = Math.max(...bars.map((b) => b.swing), 1);
  const leader = gap >= 0 ? "A" : "B";
  const trailer = leader === "A" ? "B" : "A";
  const tips = all
    .map((l) => ({ l, t: findTipping((v) => gapWith({ key: l.key, v }), vals[l.key], l.min, l.max) }))
    .sort((x, y) => (x.t ? Math.abs(x.t.value - vals[x.l.key]) / Math.max(1e-9, Math.abs(vals[x.l.key]) || 1) : 1e9) - (y.t ? Math.abs(y.t.value - vals[y.l.key]) / Math.max(1e-9, Math.abs(vals[y.l.key]) || 1) : 1e9));
  const flips = tips.filter((x) => x.t && x.t.value >= 0);
  const holds = tips.filter((x) => !x.t || x.t.value < 0);
  const dirty = all.some((l) => vals[l.key] !== l.initial);
  const hasGap = all.some((l) => l.key.startsWith("gap"));

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const id = await ensureLive();
      let latest = sim;
      for (const b of ["A", "B"] as Branch[]) {
        const edits: Record<string, number> = {};
        for (const l of all) if (l.branch === b && vals[l.key] !== l.initial) edits[l.edit] = vals[l.key];
        if (Object.keys(edits).length) latest = await api.assumptions(id, b, edits);
      }
      onUpdated(latest);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const behind = gap < 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-2">
          <h3 className="font-display text-[28px] leading-tight sm:text-[34px]">
            At {horizon === 24 ? "2 years" : "5 years"}, Path A ends{" "}
            <NumberFlow value={Math.abs(gap)} format={{ style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 0 }} />{" "}
            {behind ? "behind" : "ahead of"} Path B in savings.
          </h3>
          <p className="text-[15px] text-soft">
            Most decisive right now: <b className="font-medium text-paper">{bars[0]?.l.label}</b>. Drag an assumption — this view is plain math in your browser, so it updates instantly.
            {!hasGap && " Apply a job-loss shock to add job-search length as an assumption."}
          </p>
        </div>
        <div role="tablist" aria-label="Horizon" className="flex gap-1 rounded-full bg-ink-2 p-1 text-[14px]">
          {([24, 60] as const).map((h) => (
            <button key={h} role="tab" aria-selected={horizon === h} type="button" onClick={() => setHorizon(h)}
              className={clsx("min-h-10 rounded-full px-4", horizon === h ? "bg-paper font-medium text-ink" : "text-soft")}>
              {h === 24 ? "2 years" : "5 years"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="flex flex-col gap-5 rounded-2xl border border-line bg-raised p-5">
          <span className="label-mono">Your assumptions</span>
          {all.map((l) => (
            <label key={l.key} className="flex flex-col gap-2">
              <span className="flex justify-between gap-3 text-[14px]">
                <span>{l.label}</span>
                <span className={clsx("font-mono text-[13px]", vals[l.key] !== l.initial && "text-path-a")}>{l.fmt(vals[l.key])}</span>
              </span>
              <input type="range" min={l.min} max={l.max} step={l.step} value={vals[l.key]} className="accent-paper"
                onChange={(e) => setVals((v) => ({ ...v, [l.key]: Number(e.target.value) }))} />
            </label>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={!dirty || saving} onClick={save}
              className="min-h-11 rounded-full bg-paper px-5 text-[14px] font-medium text-ink disabled:opacity-40">
              {saving ? "Saving…" : "Save to both worlds"}
            </button>
            <button type="button" disabled={!dirty} onClick={() => setVals(Object.fromEntries(all.map((l) => [l.key, l.initial])))}
              className="min-h-11 rounded-full border border-line-2 px-5 text-[14px] disabled:opacity-40">
              Reset
            </button>
          </div>
          {err && <p role="alert" className="text-[13px] text-shock">{err}</p>}
          <p className="text-[12px] leading-relaxed text-muted">Saving records each change as an ASSUMPTION you made and writes a new world version.</p>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl bg-ink-2 p-5">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="label-mono">How much each assumption can swing the gap</span>
            <span className="font-mono text-[11px] text-muted">sorted by swing</span>
          </div>
          {bars.map(({ l, lo, hi, swing }, i) => (
            <div key={l.key} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap justify-between gap-2 text-[14px]">
                <span>{l.label}</span>
                <span className="font-mono text-[12px] text-soft">gap {usd(Math.min(lo, hi))} → {usd(Math.max(lo, hi))}</span>
              </div>
              <div className="h-5 overflow-hidden rounded-md bg-raised">
                <motion.div className={clsx("h-full rounded-md", i === 0 ? "bg-paper" : l.branch === "A" ? "bg-path-a/50" : "bg-path-b/50")}
                  initial={false} animate={{ width: `${Math.max(3, (swing / maxSwing) * 100)}%` }} transition={{ duration: 0.35 }} />
              </div>
            </div>
          ))}
          <p className="pt-1 text-[12px] leading-relaxed text-muted">
            Same finance model as the server ({segments(sim.branches.A.finance_inputs).length + segments(sim.branches.B.finance_inputs).length} pay periods, tax, housing and living costs), checked against shared golden tests.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-line p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="label-mono">Tipping points · what would flip it</span>
          <span className="font-mono text-[11px] text-muted">Path {leader} ahead now</span>
        </div>
        {flips.length === 0 && <p className="text-[15px] text-soft">No single assumption flips the result, even far outside the sliders. On money alone, this one is robust.</p>}
        <ul className="flex flex-col gap-2.5">
          {flips.map(({ l, t }) => (
            <li key={l.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[15px]">
              <span className={clsx("h-2 w-2 shrink-0 translate-y-[-1px] rounded-full", trailer === "A" ? "bg-path-a" : "bg-path-b")} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Path <b className={clsx("font-medium", trailer === "A" ? "text-path-a" : "text-path-b")}>{trailer}</b> pulls ahead if <b className="font-medium">{l.label.replace(/ \([AB]\)$/, "")}</b> on Path {l.branch} goes {t!.direction} <b className="font-medium">{l.fmt(roundTo(t!.value, l.step))}</b>
                <span className="text-soft"> (now {l.fmt(vals[l.key])})</span>
              </span>
              {!t!.withinRange && <span className="font-mono text-[11px] text-muted">beyond the slider range</span>}
            </li>
          ))}
        </ul>
        {holds.length > 0 && (
          <p className="text-[13px] leading-relaxed text-muted">
            Doesn’t flip at any realistic value: {holds.map((x) => x.l.label).join(", ")}.
          </p>
        )}
        <p className="text-[12px] text-muted">Found by searching each assumption for the value where the two paths end level at {horizon === 24 ? "2 years" : "5 years"}. Only money is compared here; see Values for the rest.</p>
      </div>
    </div>
  );
}

function roundTo(v: number, step: number): number {
  const r = Math.round(v / step) * step;
  return Number(r.toFixed(step < 1 ? 2 : 0));
}
