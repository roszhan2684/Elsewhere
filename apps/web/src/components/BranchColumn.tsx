"use client";

import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import type { BranchWorld, Claim, EvidenceItem, FieldChange, Snapshot, Timepoint, WorldEvent } from "@/lib/types";
import { TP_MONTHS, claimAt, snap } from "@/lib/types";
import { Chip } from "./Chip";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  { title: "Career", rows: [["career.role", "Role"], ["career.scope", "Owns"], ["career.skills", "Learning"], ["career.optionality", "Options"]] },
  { title: "Money", rows: [["finance.salary", "Pay"], ["finance.savings", "Savings"], ["finance.runway_months", "Runway"], ["finance.equity_value", "Equity"]] },
  { title: "Life", rows: [["location.city", "City"], ["lifestyle.work_hours", "Hours"], ["lifestyle.stress", "Stress"], ["lifestyle.social_support", "Support"]] },
  { title: "Risk", rows: [["risk.job_security", "Security"], ["risk.reversibility", "Switch back?"], ["risk.downside", "Downside"]] },
];
const VALUES: [string, string][] = [
  ["values_fit.learning", "Learning"], ["values_fit.stability", "Stability"], ["values_fit.ownership", "Ownership"],
  ["values_fit.location", "Place"], ["values_fit.autonomy", "Autonomy"],
];

export function BranchColumn({
  bw,
  tp,
  evidence,
  events,
  changes,
  selected,
  onSelect,
}: {
  bw: BranchWorld;
  tp: Timepoint;
  evidence: Map<string, EvidenceItem>;
  events: WorldEvent[];
  changes: FieldChange[];
  selected: string | null;
  onSelect: (ref: string) => void;
}) {
  const s = snap(bw, tp);
  const isA = bw.branch === "A";
  const changed = new Map(changes.filter((c) => c.branch === bw.branch && c.timepoint === tp).map((c) => [c.field, c]));
  const month = TP_MONTHS[tp];
  const visibleEvents = events.filter((e) => e.branch === bw.branch && e.month <= month).sort((a, b) => a.month - b.month);

  return (
    <section aria-label={`Path ${bw.branch}: ${bw.label}`} className="flex min-w-0 flex-col gap-5 rounded-2xl border border-line bg-raised p-5 sm:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={clsx("grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[13px] font-semibold text-ink", isA ? "bg-path-a" : "bg-path-b")}>
              {bw.branch}
            </span>
            <span className="truncate font-medium">{bw.label}</span>
          </div>
          <span className="label-mono shrink-0">{bw.confidence} confidence</span>
        </div>
        <AnimatePresence mode="wait">
          <motion.h3
            key={`${tp}-${s.headline}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="font-display text-[26px] leading-[1.15] tracking-[-0.01em] sm:text-[28px]"
          >
            {s.headline || bw.summary}
          </motion.h3>
        </AnimatePresence>
      </header>

      <div className="flex flex-col gap-5">
        {GROUPS.map((g) => (
          <div key={g.title} className="flex flex-col">
            <div className="label-mono mb-1.5">{g.title}</div>
            <dl className="flex flex-col divide-y divide-line border-y border-line">
              {g.rows.map(([path, label]) => (
                <Row key={path} label={label} claim={claimAt(s, path)} path={path} evidence={evidence} change={changed.get(path)}
                  selected={selected} onSelect={onSelect} />
              ))}
            </dl>
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <div className="label-mono">Fit with your priorities</div>
          <div className="grid grid-cols-5 gap-2">
            {VALUES.map(([path, label]) => {
              const c = claimAt(s, path);
              const score = c.range?.low ?? null;
              const ev = c.evidence_id ? evidence.get(c.evidence_id) : undefined;
              return (
                <button key={path} type="button" onClick={() => c.evidence_id && onSelect(c.evidence_id)} title={c.text ?? "Unknown"}
                  className="flex min-w-0 flex-col items-start gap-1.5 rounded-lg p-1 text-left hover:bg-raised-2">
                  <div className="flex h-12 w-full items-end gap-[3px]" aria-label={`${label}: ${score ?? "unknown"} of 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <motion.span key={n} className={clsx("flex-1 rounded-sm", score != null && n <= score ? (isA ? "bg-path-a" : "bg-path-b") : "bg-raised-2")}
                        initial={false} animate={{ height: `${n * 20}%` }} />
                    ))}
                  </div>
                  <span className="w-full truncate text-[12px] text-soft">{label}</span>
                  {ev && <span className="sr-only">{ev.kind}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {visibleEvents.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="label-mono">What happened by month {month}</div>
            <ol className="flex flex-col gap-1.5">
              {visibleEvents.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onSelect(e.id)}
                    className={clsx("flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-raised-2", selected === e.id && "bg-raised-2")}>
                    <span className="w-9 shrink-0 font-mono text-[11px] text-muted">M{e.month}</span>
                    <span className="flex-1">{e.title}</span>
                    {e.kind === "shock" && <span className="h-2 w-2 shrink-0 rounded-full bg-shock" aria-label="caused by a shock" />}
                    {e.kind === "user_edit" && <span className="font-mono text-[10px] text-muted">YOU</span>}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

function Row({
  label,
  claim,
  path,
  evidence,
  change,
  selected,
  onSelect,
}: {
  label: string;
  claim: Claim;
  path: string;
  evidence: Map<string, EvidenceItem>;
  change?: FieldChange;
  selected: string | null;
  onSelect: (ref: string) => void;
}) {
  const ev = claim.evidence_id ? evidence.get(claim.evidence_id) : undefined;
  const known = claim.status === "known" && claim.text;
  return (
    <div className={clsx("flex items-start gap-3 py-2.5", change && "relative")}>
      <dt className="w-[84px] shrink-0 pt-0.5 text-[13px] text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={clsx("text-[15px] leading-snug", !known && "italic text-faint")}>
          {path === "finance.savings" && claim.range ? <Money lo={claim.range.low} hi={claim.range.high} /> : known ? claim.text : "Unknown"}
        </span>
        {change && (
          <span className="text-[12px] leading-snug text-shock/90">
            <span aria-hidden="true">● </span>was {change.before}
          </span>
        )}
      </dd>
      {ev && <Chip kind={ev.kind} small selected={selected === ev.id} onClick={() => onSelect(ev.id)} />}
    </div>
  );
}

function Money({ lo, hi }: { lo: number; hi: number }) {
  const fmt = { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 0 } as const;
  if (hi < 0) {
    return (
      <span>
        <NumberFlow value={-hi} format={fmt} /> to <NumberFlow value={-lo} format={fmt} /> in debt
      </span>
    );
  }
  if (Math.abs(hi - lo) < 1000) return <NumberFlow value={(lo + hi) / 2} format={fmt} />;
  return (
    <span>
      <NumberFlow value={lo} format={fmt} /> to <NumberFlow value={hi} format={fmt} />
    </span>
  );
}

export type { Snapshot };
