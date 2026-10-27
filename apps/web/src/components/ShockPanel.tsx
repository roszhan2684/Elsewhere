"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, subscribe } from "@/lib/api";
import type { ShockRecord, Simulation } from "@/lib/types";
import { AgentList, type AgentRow, reduceAgentEvent } from "./AgentList";
import { FrontPages } from "./FrontPages";

export function ShockPanel({
  sim,
  ensureLive,
  onApplied,
  fallback,
  onSelect,
}: {
  sim: Simulation;
  ensureLive: () => Promise<string>;
  onApplied: (sim: Simulation, shock: ShockRecord, note?: string) => void;
  fallback?: { request: { label: string; description: string; month: number }; simulation: Simulation };
  onSelect: (ref: string) => void;
}) {
  // A demo's saved shock goes first: it's the default, and the only one with a saved run to fall back on.
  const presets = fallback
    ? [fallback.request, ...sim.suggested_shocks.filter((s) => s.label !== fallback.request.label)].slice(0, 3)
    : sim.suggested_shocks;
  const [label, setLabel] = useState(presets[0]?.label ?? "");
  const [description, setDescription] = useState(presets[0]?.description ?? "");
  const [month, setMonth] = useState(presets[0]?.month ?? 12);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null); // null = latest
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => () => unsub.current?.(), []);

  function applyFallback(reason: string) {
    if (fallback && fallback.request.label === label) {
      const rec = fallback.simulation.shocks[0];
      setViewing(null);
      onApplied(fallback.simulation, rec, reason);
      setNote(reason);
      return true;
    }
    return false;
  }

  async function apply() {
    if (!label.trim() || running) return;
    setRunning(true);
    setError(null);
    setNote(null);
    setRows([]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const id = await ensureLive();
      const { job } = await api.shock(id, { label, description, month });
      let mine = false;
      const finish = () => {
        clearTimeout(timer);
        unsub.current?.();
        unsub.current = null;
        setRunning(false);
      };
      timer = setTimeout(() => {
        finish();
        if (!applyFallback("Live models took too long — showing a saved run of this shock.")) setError("This is taking longer than expected. Try again in a moment.");
      }, 120_000);
      unsub.current = subscribe(id, async (type, data) => {
        if (type === "shock_started" && data.job === job) mine = true;
        if (!mine) return;
        if (type === "agent_started" || type === "agent_done") setRows((r) => reduceAgentEvent(r, type, data));
        if (type === "shock_ready" && data.job === job) {
          finish();
          const fresh = await api.simulation(id);
          const rec = fresh.shocks.find((s) => s.id === data.shock_id) ?? fresh.shocks.at(-1)!;
          setViewing(null);
          onApplied(fresh, rec);
        }
        if (type === "shock_failed" && data.job === job) {
          finish();
          if (!applyFallback("Live run failed — showing a saved run of this shock.")) setError(String(data.error));
        }
      });
    } catch (e) {
      clearTimeout(timer);
      setRunning(false);
      if (!applyFallback("Live models unavailable — showing a saved run of this shock.")) setError(e instanceof ApiError ? e.message : "Couldn't apply the shock.");
    }
  }

  const shown = sim.shocks.find((s) => s.id === viewing) ?? sim.shocks.at(-1);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-4">
          <p className="text-[15px] leading-relaxed text-soft">
            Throw a surprise at both worlds. Muse Wonder plans where it enters each one, code traces everything downstream, and Spark agents recompute only what changed.
          </p>
          <div className="flex flex-col gap-2">
            {presets.map((p) => (
              <button key={p.label} type="button" onClick={() => { setLabel(p.label); setDescription(p.description); setMonth(p.month); }}
                className={clsx("flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition", label === p.label ? "border-shock bg-shock/10" : "border-line hover:border-line-2")}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-shock" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block text-[15px] font-medium">{p.label}</span>
                  <span className="block text-[13px] text-muted">{p.description}</span>
                </span>
                <span className="font-mono text-[11px] text-muted">M{p.month}</span>
              </button>
            ))}
          </div>
          <details className="rounded-xl border border-line px-4 py-3">
            <summary className="cursor-pointer text-[14px] text-paper-2">Write your own shock</summary>
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-[13px] text-muted">What happens
                <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className="min-h-11 rounded-lg border border-line bg-ink-2 px-3 text-[15px] text-paper outline-none focus:border-line-2" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-muted">Details (optional)
                <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} className="min-h-11 rounded-lg border border-line bg-ink-2 px-3 text-[15px] text-paper outline-none focus:border-line-2" />
              </label>
            </div>
          </details>
          <label className="flex flex-col gap-2 text-[13px] text-muted">
            <span className="flex justify-between"><span>When it happens</span><span className="font-mono text-paper">month {month}</span></span>
            <input type="range" min={1} max={59} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="accent-shock" />
          </label>
          <button type="button" onClick={apply} disabled={running || !label.trim()}
            className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper px-6 text-[15px] font-medium text-ink disabled:opacity-50">
            <span className="h-2 w-2 rounded-full bg-shock" aria-hidden="true" />
            {running ? "Recomputing both worlds…" : "Apply shock to both worlds"}
          </button>
          {error && <p role="alert" className="text-[14px] text-shock">{error}</p>}
          {note && <p className="text-[13px] text-muted">{note}</p>}
        </div>
        <div className="flex min-h-[200px] flex-col gap-3 rounded-2xl bg-ink-2 p-4">
          <span className="label-mono px-2 pt-1">{running ? "Live recompute" : rows.length ? "Last recompute" : "Agents"}</span>
          {rows.length ? <AgentList rows={rows} /> : <p className="px-2 text-[14px] text-muted">Agent progress shows here while a shock is applied.</p>}
        </div>
      </div>

      {sim.shocks.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-mono mr-2">Shocks applied</span>
            {sim.shocks.map((s) => (
              <button key={s.id} type="button" onClick={() => setViewing(s.id)}
                className={clsx("min-h-9 rounded-full border px-3 text-[13px]", shown?.id === s.id ? "border-paper bg-paper text-ink" : "border-line-2 text-paper-2")}>
                {s.id} · {s.label}
              </button>
            ))}
          </div>
          {shown && <FrontPages sim={sim} shock={shown} onSelect={onSelect} />}
        </div>
      )}
    </div>
  );
}
