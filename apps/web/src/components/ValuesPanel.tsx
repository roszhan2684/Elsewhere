"use client";

import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import type { Branch, Simulation, Timepoint } from "@/lib/types";
import { TIMEPOINTS, TP_LABEL } from "@/lib/types";
import { VALUE_KEYS, VALUE_LABEL, type Weights, fit, scores, tensions } from "@/lib/values";

const pctFmt = { style: "percent", maximumFractionDigits: 0 } as const;

/** Idea: score each world against what you said matters, and show where the trade really is. */
export function ValuesPanel({ sim, tp: initialTp }: { sim: Simulation; tp: Timepoint }) {
  const initial = sim.decision.priorities as Weights;
  const [w, setW] = useState<Weights>(initial);
  const [tp, setTp] = useState<Timepoint>(initialTp);
  const sa = useMemo(() => scores(sim, "A", tp), [sim, tp]);
  const sb = useMemo(() => scores(sim, "B", tp), [sim, tp]);
  const fa = fit(sa, w);
  const fb = fit(sb, w);
  const ts = tensions(sim, w, tp);
  const dirty = VALUE_KEYS.some((k) => w[k] !== initial[k]);
  const over = TIMEPOINTS.map((t) => ({ t, a: fit(scores(sim, "A", t), w), b: fit(scores(sim, "B", t), w) }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-2">
          <span className="label-mono">Values compass</span>
          <h3 className="font-display text-[28px] leading-tight sm:text-[34px]">
            At {TP_LABEL[tp].toLowerCase()}, Path A fits what you care about <NumberFlow value={fa} format={pctFmt} />, Path B <NumberFlow value={fb} format={pctFmt} />.
          </h3>
          <p className="text-[15px] text-soft">Drag your priorities to ask “what if I cared more about stability?” The worlds don’t change; only how much each part counts.</p>
        </div>
        <div role="tablist" aria-label="When" className="grid grid-cols-4 gap-1 rounded-full bg-ink-2 p-1 text-[13px]">
          {TIMEPOINTS.map((t) => (
            <button key={t} role="tab" aria-selected={tp === t} type="button" onClick={() => setTp(t)}
              className={clsx("min-h-9 rounded-full px-3", tp === t ? "bg-paper font-medium text-ink" : "text-soft")}>{TP_LABEL[t]}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-ink-2 p-5">
          <Radar sa={sa} sb={sb} w={w} />
          <div className="flex flex-wrap justify-center gap-4 text-[12px] text-soft">
            <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-path-a" />Path A</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-path-b" />Path B</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-paper" />What you want</span>
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-line bg-raised p-5">
            <span className="label-mono">How much each one matters to you</span>
            {VALUE_KEYS.map((k) => (
              <label key={k} className="flex flex-col gap-1.5">
                <span className="flex justify-between gap-3 text-[14px]">
                  <span>{VALUE_LABEL[k]}</span>
                  <span className="font-mono text-[12px] text-muted">
                    <span className="text-path-a">A {sa[k] ?? "?"}</span> · <span className="text-path-b">B {sb[k] ?? "?"}</span> · <span className={clsx(w[k] !== initial[k] && "text-paper")}>you {w[k]}/5</span>
                  </span>
                </span>
                <input type="range" min={1} max={5} step={1} value={w[k]} onChange={(e) => setW((x) => ({ ...x, [k]: Number(e.target.value) }))} className="accent-paper" />
              </label>
            ))}
            <button type="button" disabled={!dirty} onClick={() => setW(initial)} className="min-h-10 self-start rounded-full border border-line-2 px-4 text-[13px] disabled:opacity-40">Back to what you said</button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3 rounded-2xl border border-line p-5">
          <span className="label-mono">Tensions worth talking about</span>
          {ts.length === 0 ? <p className="text-[15px] text-soft">No sharp tensions: both paths serve your priorities in similar ways.</p> : (
            <ul className="flex flex-col gap-2.5 text-[15px] leading-relaxed">
              {ts.map((t) => (
                <li key={t.text} className="flex gap-3">
                  <span className={clsx("mt-2 h-2 w-2 shrink-0 rounded-full", t.kind === "money" ? "bg-warn" : t.kind === "neither" ? "bg-shock" : "bg-paper")} aria-hidden="true" />
                  {t.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-line p-5">
          <span className="label-mono">Fit over time</span>
          {over.map(({ t, a, b }) => (
            <div key={t} className="grid grid-cols-[72px_1fr] items-center gap-3 text-[13px]">
              <span className="text-muted">{TP_LABEL[t]}</span>
              <div className="flex flex-col gap-1">
                {([["A", a], ["B", b]] as [Branch, number][]).map(([br, v]) => (
                  <div key={br} className="h-2.5 overflow-hidden rounded-full bg-raised">
                    <motion.div className={clsx("h-full rounded-full", br === "A" ? "bg-path-a" : "bg-path-b")} initial={false} animate={{ width: `${Math.round(v * 100)}%` }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[12px] text-muted">Scores come from the values agents in each world (INFERENCE). Your weights are ASSUMPTIONS.</p>
        </div>
      </div>
    </div>
  );
}

function Radar({ sa, sb, w }: { sa: Record<string, number | null>; sb: Record<string, number | null>; w: Weights }) {
  const S = 300;
  const c = S / 2;
  const R = 108;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / VALUE_KEYS.length;
    return [c + Math.cos(a) * R * (v / 5), c + Math.sin(a) * R * (v / 5)];
  };
  const poly = (s: Record<string, number | null>) => VALUE_KEYS.map((k, i) => pt(i, s[k] ?? 0).map((n) => n.toFixed(1)).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="h-auto w-full max-w-[340px]" role="img"
      aria-label={`Radar chart. ${VALUE_KEYS.map((k) => `${VALUE_LABEL[k]}: A ${sa[k] ?? "unknown"}, B ${sb[k] ?? "unknown"}, you ${w[k]}`).join("; ")}`}>
      {[1, 2, 3, 4, 5].map((r) => (
        <polygon key={r} points={VALUE_KEYS.map((_, i) => pt(i, r).join(",")).join(" ")} fill="none" className="stroke-line" strokeWidth={1} />
      ))}
      {VALUE_KEYS.map((k, i) => {
        const [x, y] = pt(i, 5);
        const [lx, ly] = pt(i, 6.1);
        return (
          <g key={k}>
            <line x1={c} y1={c} x2={x} y2={y} className="stroke-line" />
            <text x={lx} y={ly + 4} textAnchor="middle" className="fill-soft text-[11px]">{VALUE_LABEL[k]}</text>
          </g>
        );
      })}
      <motion.polygon initial={false} animate={{ points: poly(sb) }} className="fill-path-b/20 stroke-path-b" strokeWidth={2} />
      <motion.polygon initial={false} animate={{ points: poly(sa) }} className="fill-path-a/20 stroke-path-a" strokeWidth={2} />
      <motion.polygon initial={false} animate={{ points: poly(w) }} fill="none" className="stroke-paper" strokeWidth={1.5} strokeDasharray="4 4" />
    </svg>
  );
}
