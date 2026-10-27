"use client";

import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Branch, PublicShare, Simulation, Snapshot, Tally } from "@/lib/types";
import { valuesPick } from "@/lib/values";
import { ForkMark } from "./ForkMark";
import { LoadingShell } from "./LoadingShell";
import { ModeBadge } from "./ModeBadge";

const moneyFmt = { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 0 } as const;

function voterToken(): string {
  try {
    const k = "elsewhere-voter";
    const v = localStorage.getItem(k);
    if (v) return v;
    const t = crypto.randomUUID();
    localStorage.setItem(k, t);
    return t;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** What a friend sees: both futures, one question — which life would you pick for them? */
export function SharePage() {
  const { id } = useParams<{ id: string }>();
  const [share, setShare] = useState<PublicShare | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [token] = useState(() => (typeof window === "undefined" ? "" : voterToken()));
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Branch | null>(null);

  useEffect(() => {
    api.publicShare(id, token).then((s) => { setShare(s); setTally(s.votes); }).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn’t open this link."));
  }, [id, token]);

  async function vote(choice: Branch) {
    setBusy(choice);
    try {
      setTally(await api.vote(id, { choice, token, name, reason }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Your vote didn’t go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !share) return <LoadingShell message={error} />;
  if (!share || !tally) return <LoadingShell />;
  const voted = tally.mine;
  const pick = valuesPick({ branches: share.branches } as unknown as Simulation, share.priorities);

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 font-display text-[22px]"><ForkMark />Elsewhere</Link>
        <ModeBadge mode={share.mode} />
      </div>
      <div className="flex flex-col gap-3">
        <span className="label-mono">A friend is deciding</span>
        <h1 className="font-display text-[34px] leading-tight sm:text-[48px]">{share.question || share.title}</h1>
        <p className="text-[16px] text-soft">Here are both of their simulated futures. Which life would you pick for them?</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {(["A", "B"] as Branch[]).map((b) => {
          const br = share.branches[b];
          const s24 = br.snapshots.find((s) => s.timepoint === "m24");
          const s60 = br.snapshots.find((s) => s.timepoint === "m60");
          return (
            <article key={b} className={clsx("flex flex-col gap-4 rounded-md bg-newsprint p-6 text-[#16161a] sm:p-7", voted === b && "ring-4 ring-paper")}>
              <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.1em] text-[#4a4a52]">
                <span className="flex items-center gap-2">
                  <span className={clsx("grid h-[18px] w-[18px] place-items-center rounded-full text-white", b === "A" ? "bg-path-a-ink" : "bg-path-b-ink")}>{b}</span>
                  {(br.city ?? br.label).toUpperCase()} EDITION
                </span>
                <span>YEAR 2</span>
              </div>
              <div className="border-y border-[#16161a] border-t-[3px] pb-2 pt-2.5 text-center font-display text-[26px] font-bold leading-none">The Elsewhere Ledger</div>
              <h2 className="font-display text-[26px] font-semibold leading-[1.1]">{s24?.headline || br.label}</h2>
              <p className="font-display text-[17px] italic leading-snug text-[#34343a]">{br.summary}</p>
              <div className="grid grid-cols-3 border-t border-[#16161a] pt-3 text-[13px]">
                <Stat label="SAVINGS · YR 2" value={money(s24)} />
                <Stat label="STRESS" value={s24?.lifestyle.stress.text ?? "—"} />
                <Stat label="HOURS" value={s24?.lifestyle.work_hours.text ?? "—"} />
              </div>
              <ul className="flex flex-col gap-1 text-[14px]">{br.top_tradeoffs.slice(0, 2).map((t) => <li key={t}>— {t}</li>)}</ul>
              {s60?.headline && <p className="rounded bg-newsprint-2 px-3 py-2 text-[13px]"><b className="font-mono text-[10px] tracking-[0.1em]">YEAR 5 · </b>{s60.headline}</p>}
              <button type="button" onClick={() => vote(b)} disabled={busy !== null}
                className={clsx("mt-auto min-h-12 rounded-full text-[15px] font-medium text-white disabled:opacity-60", b === "A" ? "bg-path-a-ink" : "bg-path-b-ink")}>
                {busy === b ? "Voting…" : voted === b ? `You picked Path ${b} ✓` : `I’d pick Path ${b}`}
              </button>
            </article>
          );
        })}
      </div>

      {!voted && (
        <div className="grid gap-3 rounded-2xl border border-line p-5 sm:grid-cols-[1fr_2fr]">
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">Your name (optional)
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="min-h-11 rounded-lg border border-line bg-ink-2 px-3 text-[15px] text-paper outline-none focus:border-line-2" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">Why? One line they’ll see (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} placeholder="You light up when you talk about…" className="min-h-11 rounded-lg border border-line bg-ink-2 px-3 text-[15px] text-paper outline-none placeholder:text-faint focus:border-line-2" />
          </label>
        </div>
      )}

      <AnimatePresence>
        {voted && (
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5 rounded-2xl bg-raised p-6">
            <Votes tally={tally} />
            <div className="flex flex-col gap-1 rounded-xl border border-line-2 p-4">
              <span className="label-mono">The twist</span>
              <p className="text-[16px] leading-relaxed">
                {pick.pick === "tie" ? "Their own priorities don’t clearly favor either life." : <>Their own priorities point to <b className={pick.pick === "A" ? "text-path-a" : "text-path-b"}>Path {pick.pick}</b> ({Math.round(Math.max(pick.fitA, pick.fitB) * 100)}% fit vs {Math.round(Math.min(pick.fitA, pick.fitB) * 100)}%).</>}
                {" "}{pick.pick !== "tie" && voted !== pick.pick ? "You picked the other one, which is exactly the conversation worth having." : pick.pick === voted ? "You and their values agree." : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/new" className="rounded-full bg-paper px-5 py-3 text-[14px] font-medium text-ink">Fork your own decision →</Link>
              <button type="button" onClick={() => setTally({ ...tally, mine: null })} className="rounded-full border border-line-2 px-5 py-3 text-[14px]">Change my vote</button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      {error && <p role="alert" className="text-[14px] text-shock">{error}</p>}
      <p className="text-[13px] text-muted">Elsewhere explores scenarios; it doesn’t predict anyone’s future. This page shows simulated worlds only, not their private chats or notes.</p>
    </main>
  );
}

function money(s?: Snapshot) {
  const r = s?.finance.savings.range;
  if (!r) return s?.finance.savings.text ?? "—";
  return <NumberFlow value={(r.low + r.high) / 2} format={moneyFmt} />;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 pr-2">
      <span className="font-mono text-[9px] tracking-[0.08em] text-[#4a4a52]">{label}</span>
      <span className="font-display text-[17px] leading-tight">{value}</span>
    </div>
  );
}

export function Votes({ tally }: { tally: Tally }) {
  const pa = tally.total ? tally.A / tally.total : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-mono">How friends voted</span>
        <span className="font-mono text-[12px] text-muted">{tally.total} vote{tally.total === 1 ? "" : "s"}</span>
      </div>
      <div className="flex h-10 overflow-hidden rounded-full bg-ink-2 text-[13px] font-medium text-ink">
        {tally.total > 0 && (
          <>
            <motion.div className="flex items-center bg-path-a pl-4" initial={false} animate={{ width: `${pa * 100}%` }}>{tally.A > 0 && <>A · <NumberFlow value={pa} format={{ style: "percent" }} /></>}</motion.div>
            <motion.div className="flex items-center justify-end bg-path-b pr-4" initial={false} animate={{ width: `${(1 - pa) * 100}%` }}>{tally.B > 0 && <>B · <NumberFlow value={1 - pa} format={{ style: "percent" }} /></>}</motion.div>
          </>
        )}
      </div>
      {tally.reasons.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tally.reasons.slice(0, 8).map((r, i) => (
            <li key={i} className="flex gap-3 text-[14px]">
              <span className={clsx("font-mono text-[12px]", r.choice === "A" ? "text-path-a" : "text-path-b")}>{r.choice}</span>
              <span className="text-paper-2">“{r.reason}”{r.name && <span className="text-muted"> — {r.name}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
