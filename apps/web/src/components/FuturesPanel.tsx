"use client";

import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { usd } from "@/lib/finance";
import { type FuturesResult, MONTHS, hazardTable, runFutures } from "@/lib/futures";
import type { Branch, Simulation } from "@/lib/types";

const W = 720;
const H = 300;
const PAD = { l: 58, r: 12, t: 12, b: 28 };
const pctFmt = { style: "percent", maximumFractionDigits: 0 } as const;
const moneyFmt = { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 0 } as const;

/** Idea: run both worlds through 1,000 random lives. Plain math in the browser, no model call. */
export function FuturesPanel({ sim }: { sim: Simulation }) {
  const [seed, setSeed] = useState(1);
  const [rough, setRough] = useState(1);
  const [threads, setThreads] = useState(true);
  const [open, setOpen] = useState(0);
  const res = useMemo(() => runFutures(sim, { seed, n: 1000, roughness: rough }), [sim, seed, rough]);
  const lead: Branch = res.aheadA >= 0.5 ? "A" : "B";
  const leadPct = lead === "A" ? res.aheadA : 1 - res.aheadA;
  const fut = res.futures[open % res.futures.length];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-2">
          <span className="label-mono">1,000 futures · same luck in both worlds</span>
          <h3 className="font-display text-[28px] leading-tight sm:text-[34px]">
            Path <span className={lead === "A" ? "text-path-a" : "text-path-b"}>{lead}</span> ends year 5 with more savings in{" "}
            <NumberFlow value={leadPct} format={pctFmt} /> of 1,000 futures.
          </h3>
          <p className="text-[15px] leading-relaxed text-soft">
            Each future rolls real-life surprises — layoffs, medical bills, rent jumps, raises — at rough yearly rates. Things that happen to <i>you</i> hit both paths the same way, so only the decision differs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setSeed((s) => s + 1); setOpen(0); }}
            className="flex min-h-11 items-center gap-2 rounded-full bg-paper px-5 text-[14px] font-medium text-ink">
            <Dice /> Roll 1,000 new futures
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["A", "B"] as Branch[]).map((br) => {
          const s = res.branches[br];
          return (
            <div key={br} className={clsx("grid grid-cols-3 gap-3 rounded-2xl border p-4", br === "A" ? "border-path-a/40" : "border-path-b/40")}>
              <span className={clsx("col-span-3 text-[13px] font-medium", br === "A" ? "text-path-a" : "text-path-b")}>Path {br} · {sim.branches[br].label}</span>
              <Stat label="Ever in debt" value={<NumberFlow value={s.debtPct} format={pctFmt} />} note={s.plannedDebt ? "the plan itself borrows" : undefined} />
              <Stat label="Typical at year 5" value={<NumberFlow value={s.medianEnd} format={moneyFmt} />} />
              <Stat label="Unlucky 10%" value={<NumberFlow value={s.p10End} format={moneyFmt} />} note="or worse" />
            </div>
          );
        })}
      </div>

      <figure className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4">
        <Fan res={res} threads={threads} />
        <figcaption className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12px] text-muted">
          <span>Savings over 5 years. Line = typical future, band = middle 80%, faint lines = single futures.</span>
          <label className="flex items-center gap-2"><input type="checkbox" checked={threads} onChange={(e) => setThreads(e.target.checked)} className="accent-paper" /> Show single futures</label>
        </figcaption>
      </figure>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-raised p-5">
          <label className="flex flex-col gap-2">
            <span className="flex justify-between text-[14px]"><span>How rough is life?</span><span className="font-mono text-[13px]">{rough.toFixed(1)}× the usual rates</span></span>
            <input type="range" min={0} max={2} step={0.1} value={rough} onChange={(e) => setRough(Number(e.target.value))} className="accent-paper" />
          </label>
          <details className="text-[13px]">
            <summary className="cursor-pointer text-paper-2">What’s in the dice</summary>
            <table className="mt-3 w-full text-left">
              <tbody>
                {hazardTable(sim).map(({ branch, hazard }) => (
                  <tr key={`${branch}-${hazard.id}`} className="border-t border-line">
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-muted">{branch === "both" ? "You" : `Path ${branch}`}</td>
                    <td className="py-1.5 pr-2">{hazard.label}</td>
                    <td className="py-1.5 text-right font-mono text-[12px]">{Math.round(hazard.yearly * rough * 100)}%/yr</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 leading-relaxed text-muted">These rates are rough ballparks, not facts. Treat them as ASSUMPTIONS and use the slider to see how much they matter.</p>
          </details>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-line p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="label-mono">Open one future · #{(open % res.n) + 1}</span>
            <button type="button" onClick={() => setOpen((o) => o + 1 + Math.floor(Math.random() * 97))} className="min-h-9 rounded-full border border-line-2 px-3 text-[13px] hover:border-paper">Another one</button>
          </div>
          {fut.events.length === 0 ? (
            <p className="text-[14px] text-soft">A quiet five years: nothing unusual happened in either world.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {fut.events.slice(0, 8).map((e, i) => (
                <li key={i} className="flex items-baseline gap-3 text-[14px]">
                  <span className="w-10 shrink-0 font-mono text-[11px] text-muted">M{e.month}</span>
                  <span className={clsx("w-14 shrink-0 font-mono text-[11px]", e.branch === "A" ? "text-path-a" : e.branch === "B" ? "text-path-b" : "text-paper-2")}>
                    {e.branch === "both" ? "BOTH" : `PATH ${e.branch}`}
                  </span>
                  <span className={clsx(e.hazard.good && "text-[#5fd38d]")}>{e.hazard.label}</span>
                </li>
              ))}
              {fut.events.length > 8 && <li className="text-[13px] text-muted">…and {fut.events.length - 8} more</li>}
            </ol>
          )}
          <p className="text-[14px] text-soft">
            Year 5: Path A <b className="font-medium text-path-a">{usd(fut.end.A)}</b> · Path B <b className="font-medium text-path-b">{usd(fut.end.B)}</b>
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="font-display text-[22px] leading-none">{value}</span>
      {note && <span className="text-[11px] text-faint">{note}</span>}
    </div>
  );
}

function Fan({ res, threads }: { res: FuturesResult; threads: boolean }) {
  const all = [...res.branches.A.p10, ...res.branches.B.p10, ...res.branches.A.p90, ...res.branches.B.p90, 0];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1000;
  lo -= pad;
  hi += pad;
  const x = (m: number) => PAD.l + (m / MONTHS) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = (vals: number[]) => vals.map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const band = (p10: number[], p90: number[]) => `${line(p90)}${p10.map((v, m) => `L${x(p10.length - 1 - m).toFixed(1)},${y(p10[p10.length - 1 - m]).toFixed(1)}`).join("")}Z`;
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * (i + 0.5)) / 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
      aria-label={`Fan chart of savings over five years. Path A typical year-5 savings ${usd(res.branches.A.medianEnd)}, Path B ${usd(res.branches.B.medianEnd)}.`}>
      <defs>
        <clipPath id="fan-clip"><rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} /></clipPath>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
          <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="fill-muted font-mono text-[10px]">{usd(t)}</text>
        </g>
      ))}
      {lo < 0 && hi > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-shock/60" strokeDasharray="4 4" />}
      {[0, 12, 24, 36, 48, 60].map((m) => (
        <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className="fill-muted font-mono text-[10px]">{m === 0 ? "Now" : `${m / 12}y`}</text>
      ))}
      <g clipPath="url(#fan-clip)">
        {threads && (["A", "B"] as Branch[]).map((b) =>
          res.branches[b].traces.map((tr, i) => (
            <motion.path key={`${res.seed}-${b}-${i}`} d={line(tr)} fill="none" strokeWidth={1}
              className={b === "A" ? "stroke-path-a" : "stroke-path-b"} strokeOpacity={0.13}
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: i * 0.006, ease: "easeOut" }} />
          )),
        )}
        {(["B", "A"] as Branch[]).map((b) => (
          <g key={b}>
            <path d={band(res.branches[b].p10, res.branches[b].p90)} className={b === "A" ? "fill-path-a/15" : "fill-path-b/15"} />
            <path d={line(res.branches[b].p50)} fill="none" strokeWidth={2.5} className={b === "A" ? "stroke-path-a" : "stroke-path-b"} />
          </g>
        ))}
      </g>
      {(["A", "B"] as Branch[]).map((b) => (
        <text key={b} x={W - PAD.r - 4} y={y(res.branches[b].p50[MONTHS]) - 8} textAnchor="end"
          className={clsx("font-mono text-[11px] font-semibold", b === "A" ? "fill-path-a" : "fill-path-b")}>{b}</text>
      ))}
    </svg>
  );
}

export function Dice({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />
    </svg>
  );
}
