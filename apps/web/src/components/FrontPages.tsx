"use client";

import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import type { ShockRecord, Simulation } from "@/lib/types";
import { snap } from "@/lib/types";
import { Chip } from "./Chip";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function editionDate(created: string, plusMonths: number): string {
  const d = new Date(created || Date.now());
  d.setMonth(d.getMonth() + plusMonths);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`.toUpperCase();
}

/** Idea 2: shock results as two newsprint front pages from year two. */
export function FrontPages({ sim, shock, onSelect }: { sim: Simulation; shock: ShockRecord; onSelect: (ref: string) => void }) {
  const evidence = new Map(sim.evidence.map((e) => [e.id, e]));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        {(["A", "B"] as const).map((b) => {
          const page = shock.front_pages.find((p) => p.branch === b);
          const bw = sim.branches[b];
          const s24 = snap(bw, "m24");
          const changes = shock.changes.filter((c) => c.branch === b && c.timepoint === "m24");
          const savingsChange = changes.find((c) => c.field === "finance.savings");
          const hit = shock.applies_to.includes(b);
          const sav = s24.finance.savings;
          const stats = [
            { label: "Savings · year 2", path: "finance.savings", claim: sav, money: sav.range },
            { label: "Role", path: "career.role", claim: s24.career.role },
            { label: "Stress", path: "lifestyle.stress", claim: s24.lifestyle.stress },
          ];
          return (
            <motion.article key={`${shock.id}-${b}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: b === "B" ? 0.08 : 0 }}
              className={clsx("flex flex-col gap-4 rounded-md bg-newsprint p-6 text-[#16161a] sm:p-8", hit && "ring-2 ring-shock")}>
              <div className="flex items-center justify-between gap-3 font-mono text-[10px] tracking-[0.1em] text-[#4a4a52] sm:text-[11px]">
                <span className="flex items-center gap-2">
                  <span className={clsx("grid h-[18px] w-[18px] place-items-center rounded-full text-white", b === "A" ? "bg-path-a-ink" : "bg-path-b-ink")}>{b}</span>
                  {(bw.snapshots[0].location.city.text ?? bw.label).toUpperCase()} EDITION
                </span>
                <span>{editionDate(shock.created_at, 24)} · YEAR 2</span>
              </div>
              <div className="border-y border-[#16161a] border-t-[3px] pb-2 pt-2.5 text-center font-display text-[clamp(24px,3vw,36px)] font-bold leading-none tracking-[-0.01em] whitespace-nowrap">
                The Elsewhere Ledger
              </div>
              {hit ? (
                <span className="self-start rounded-[3px] bg-[#c8243a] px-2 py-1.5 font-mono text-[10px] tracking-[0.1em] text-white">REWRITTEN BY SHOCK · {shock.id}</span>
              ) : (
                <span className="self-start rounded-[3px] border-[1.5px] border-[#16161a] px-2 py-1 font-mono text-[10px] tracking-[0.1em]">UNCHANGED BY THIS SHOCK</span>
              )}
              <AnimatePresence mode="wait">
                <motion.h3 key={page?.headline} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                  className="font-display text-[28px] font-semibold leading-[1.08] tracking-[-0.01em] sm:text-[34px]">
                  {page?.headline ?? s24.headline}
                </motion.h3>
              </AnimatePresence>
              <p className="font-display text-[18px] italic leading-snug text-[#34343a]">{page?.deck}</p>
              <div className="grid grid-cols-3 border-t border-[#16161a]">
                {stats.map((st) => {
                  const ev = st.claim.evidence_id ? evidence.get(st.claim.evidence_id) : undefined;
                  const was = changes.find((c) => c.field === st.path);
                  return (
                    <div key={st.path} className="flex min-w-0 flex-col gap-2 pr-3 pt-3.5">
                      <span className="font-mono text-[10px] leading-tight tracking-[0.08em] text-[#4a4a52]">{st.label.toUpperCase()}</span>
                      <span className="font-display text-[19px] leading-tight sm:text-[21px]">
                        {st.money ? (
                          st.money.high < 0 ? <>−<NumberFlow value={-((st.money.low + st.money.high) / 2)} format={{ style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 0 }} /></>
                            : <NumberFlow value={(st.money.low + st.money.high) / 2} format={{ style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 0 }} />
                        ) : st.claim.text ?? "Unknown"}
                      </span>
                      {was && <span className="text-[12px] leading-tight text-[#8a2a2a] line-through">{was.before}</span>}
                      {ev && <span><Chip kind={ev.kind} small light onClick={() => onSelect(ev.id)} /></span>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex flex-col gap-2 rounded bg-newsprint-2 px-4 py-3.5">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[#4a4a52]">{hit ? "CHANGED BECAUSE" : "WHY NOTHING MOVED"}</span>
                <p className="text-[14px] leading-relaxed">{hit ? page?.changed_because : shock.not_applied_because[b] ?? page?.changed_because}</p>
                {savingsChange && <p className="font-mono text-[11px] text-[#4a4a52]">savings at year 2: {savingsChange.before} → {savingsChange.after}</p>}
              </div>
            </motion.article>
          );
        })}
      </div>
      {shock.verdict && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl bg-raised px-6 py-5">
          <span className="label-mono">Verdict under this shock</span>
          <span className="min-w-[260px] flex-1 text-[16px] leading-relaxed">
            {shock.verdict.more_robust === "tie" ? "Neither path is clearly more robust." : <>Path <b className={shock.verdict.more_robust === "A" ? "text-path-a" : "text-path-b"}>{shock.verdict.more_robust}</b> is more robust.</>}{" "}
            {shock.verdict.why} <span className="text-soft">Most decisive assumption: {shock.verdict.dominant_assumption}.</span>
          </span>
          <span className="rounded-full border border-line-2 px-3 py-1.5 text-[13px] text-paper-2">{shock.verdict.confidence[0].toUpperCase() + shock.verdict.confidence.slice(1)} confidence</span>
        </div>
      )}
    </div>
  );
}
