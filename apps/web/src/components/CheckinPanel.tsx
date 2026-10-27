"use client";

import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { METRIC_LABEL, compareCheckin, fmtMetric, reminderIcs } from "@/lib/checkin";
import type { Branch, Checkin, Simulation } from "@/lib/types";

const pctFmt = { style: "percent", maximumFractionDigits: 0 } as const;

function monthsSince(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 3;
  const now = new Date();
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth());
}

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,\s]/g, "")));

/** Idea: come back later, report real life, and see which simulated world you're actually living in. */
export function CheckinPanel({ sim, liveId, ensureLive, demoSlug }: { sim: Simulation; liveId: string | null; ensureLive: () => Promise<string>; demoSlug?: string }) {
  const [list, setList] = useState<Checkin[]>([]);
  const [month, setMonth] = useState(String(Math.max(3, monthsSince(sim.created_at))));
  const [took, setTook] = useState<Branch | "neither">("A");
  const [savings, setSavings] = useState("");
  const [pay, setPay] = useState("");
  const [stress, setStress] = useState<number | null>(null);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (liveId) api.checkins(liveId).then(setList).catch(() => {});
  }, [liveId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const id = await ensureLive();
      const c = await api.addCheckin(id, {
        month: Math.max(0, Math.min(120, Math.round(Number(month) || 0))), took,
        savings_usd: num(savings), annual_pay_usd: num(pay), stress, hours_per_week: num(hours), note,
      });
      setList((l) => [...l, c]);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Couldn’t save your check-in.");
    } finally {
      setBusy(false);
    }
  }

  async function remind(months: number) {
    let url = typeof window !== "undefined" ? window.location.href : "";
    try {
      const id = await ensureLive();
      url = `${window.location.origin}/sim/${id}`;
    } catch {
      if (demoSlug) url = `${window.location.origin}/demo/${demoSlug}`;
    }
    const blob = new Blob([reminderIcs(sim.decision.title, url, months)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `elsewhere-check-in-${months}m.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const latest = list.at(-1);
  const result = latest ? compareCheckin(sim, latest) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-2">
        <span className="label-mono">Reality check-in</span>
        <h3 className="font-display text-[28px] leading-tight sm:text-[34px]">Come back later. See which world you’re living in.</h3>
        <p className="text-[15px] leading-relaxed text-soft">
          A few months after you decide, tell Elsewhere how life actually went. It compares your real numbers with both simulated worlds and shows where the simulation was right and where it was off.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-soft">Set a reminder:</span>
        {[3, 6, 12].map((m) => (
          <button key={m} type="button" onClick={() => remind(m)} className="min-h-10 rounded-full border border-line-2 px-4 text-[13px] hover:border-paper">In {m} months</button>
        ))}
        <span className="text-[12px] text-muted">Adds an event to your calendar app (.ics); no email needed.</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-raised p-5">
          <span className="label-mono">How it’s actually going</span>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Months since deciding"><input inputMode="numeric" value={month} onChange={(e) => setMonth(e.target.value)} className={input} /></Field>
            <Field label="Which path did you take?">
              <select value={took} onChange={(e) => setTook(e.target.value as Branch | "neither")} className={input}>
                <option value="A">Path A · {sim.branches.A.label}</option>
                <option value="B">Path B · {sim.branches.B.label}</option>
                <option value="neither">Something else</option>
              </select>
            </Field>
            <Field label="Savings now ($)"><input inputMode="numeric" value={savings} onChange={(e) => setSavings(e.target.value)} placeholder="e.g. 12000" className={input} /></Field>
            <Field label="Yearly pay ($)"><input inputMode="numeric" value={pay} onChange={(e) => setPay(e.target.value)} placeholder="e.g. 38000" className={input} /></Field>
            <Field label="Hours a week"><input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 45" className={input} /></Field>
            <Field label={`Stress${stress ? `: ${stress}/5` : " (tap 1–5)"}`}>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setStress(stress === n ? null : n)} aria-pressed={stress === n}
                    className={clsx("min-h-11 flex-1 rounded-lg border text-[14px]", stress === n ? "border-paper bg-paper text-ink" : "border-line text-soft")}>{n}</button>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Anything else (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className={clsx(input, "py-2")} /></Field>
          <button type="submit" disabled={busy} className="min-h-11 self-start rounded-full bg-paper px-5 text-[14px] font-medium text-ink disabled:opacity-50">{busy ? "Saving…" : "Compare with both worlds"}</button>
          {err && <p role="alert" className="text-[13px] text-shock">{err}</p>}
          <p className="text-[12px] text-muted">Leave any box empty to skip it. Your check-ins stay on this simulation.</p>
        </form>

        <div className="flex flex-col gap-4">
          {!result ? (
            <div className="grid min-h-[200px] place-items-center rounded-2xl bg-ink-2 p-6 text-center text-[14px] text-muted">Your first check-in shows up here.</div>
          ) : (
            <div className="flex flex-col gap-4 rounded-2xl bg-ink-2 p-5">
              <h4 className="font-display text-[26px] leading-tight">
                {result.closer === "tie" ? "Your life sits between the two worlds." : <>You’re living closer to <span className={result.closer === "A" ? "text-path-a" : "text-path-b"}>World {result.closer}</span>.</>}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {(["A", "B"] as Branch[]).map((b) => (
                  <div key={b} className="flex flex-col gap-1.5">
                    <span className="flex justify-between text-[13px]"><span className={b === "A" ? "text-path-a" : "text-path-b"}>World {b}</span><NumberFlow value={result.closeness[b]} format={pctFmt} /></span>
                    <div className="h-2 overflow-hidden rounded-full bg-raised"><div className={clsx("h-full rounded-full", b === "A" ? "bg-path-a" : "bg-path-b")} style={{ width: `${result.closeness[b] * 100}%` }} /></div>
                  </div>
                ))}
              </div>
              <table className="w-full text-left text-[13px]">
                <thead className="text-muted"><tr><th className="py-1.5 font-normal">At month {latest!.month}</th><th className="font-normal">You</th><th className="font-normal text-path-a">World A</th><th className="font-normal text-path-b">World B</th></tr></thead>
                <tbody>
                  {result.metrics.map((m) => (
                    <tr key={m.metric} className="border-t border-line">
                      <td className="py-2 text-soft">{METRIC_LABEL[m.metric]}</td>
                      <td className="font-medium">{fmtMetric(m.metric, m.actual)}</td>
                      {(["A", "B"] as Branch[]).map((b) => (
                        <td key={b} className={clsx(m.distance[b] === 0 && "text-ok")}>
                          {m.ranges[b] ? `${fmtMetric(m.metric, Math.min(...m.ranges[b]!))}–${fmtMetric(m.metric, Math.max(...m.ranges[b]!))}` : "—"}{m.distance[b] === 0 ? " ✓" : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.calibration.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-line-2 p-4">
                  <span className="label-mono">How the simulation held up</span>
                  <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed">{result.calibration.map((c) => <li key={c}>— {c}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {list.length > 1 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-line p-4">
              <span className="label-mono">Earlier check-ins</span>
              <ul className="flex flex-col gap-1 text-[13px]">
                {list.slice(0, -1).reverse().map((c) => {
                  const r = compareCheckin(sim, c);
                  return <li key={c.id} className="flex justify-between gap-3"><span>Month {c.month}{c.note ? ` · ${c.note.slice(0, 60)}` : ""}</span><span className="text-muted">{r.closer === "tie" ? "between both" : `closer to ${r.closer}`}</span></li>;
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const input = "min-h-11 w-full rounded-lg border border-line bg-ink-2 px-3 text-[15px] text-paper outline-none placeholder:text-faint focus:border-line-2";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-[13px] text-muted">{label}{children}</label>;
}
