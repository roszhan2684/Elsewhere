"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { DecisionSpec } from "@/lib/types";
import { ForkMark } from "./ForkMark";
import { ModeBadge } from "./ModeBadge";
import { VoiceButton } from "./VoiceButton";

const EXAMPLES = [
  "I'm deciding between joining a 7-person AI startup in San Francisco at $145K plus equity, or taking a stable software engineering role in Seattle at $180K. I care most about learning and ownership, but I also want financial stability. I have about $40K saved and spend around $4,500 a month.",
  "Should I do a two-year master's in machine learning in Boston, or take a full-time software engineering job in Austin at $125K? Tuition is about $60K a year. I have $25K saved and spend about $3,000 a month.",
  "I'm thinking about quitting my job to build my own product full-time, or staying at my established company in New York at $165K. Ownership and autonomy matter most to me. I have $70K saved and spend about $5,000 a month.",
];
const PRIORITIES = ["learning", "stability", "ownership", "location", "autonomy"] as const;

export function Intake() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [step, setStep] = useState<"describe" | "review">("describe");
  const [id, setId] = useState<string | null>(null);
  const [spec, setSpec] = useState<DecisionSpec | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"live" | "mock" | null>(null);
  const [recent, setRecent] = useState<{ id: string; title: string; status: string }[]>([]);

  useEffect(() => {
    api.meta().then((m) => setMode(m.mode)).catch(() => {});
    api.recent().then((r) => setRecent(r.filter((x) => x.status === "ready").slice(0, 5))).catch(() => {});
  }, []);

  async function read() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createDecision(text);
      setId(r.id);
      setSpec(r.decision);
      setStep("review");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    if (!id || !spec) return;
    setBusy(true);
    setErr(null);
    try {
      await api.editDecision(id, spec);
      if (Object.values(answers).some((a) => a.trim())) await api.clarify(id, answers);
      await api.simulate(id);
      router.push(`/sim/${id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const setPath = (k: "path_a" | "path_b", patch: Partial<DecisionSpec["path_a"]>) => setSpec((s) => (s ? { ...s, [k]: { ...s[k], ...patch } } : s));

  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-10 px-4 py-10 sm:px-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 font-display text-[22px]"><ForkMark />Elsewhere</Link>
        {mode && <ModeBadge mode={mode} />}
      </div>

      {step === "describe" && (
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="label-mono">New fork</span>
            <h1 className="font-display text-[38px] leading-tight sm:text-[52px]">What decision is keeping you up at night?</h1>
            <p className="text-[16px] leading-relaxed text-soft">Describe both options, what you care about, what you’re afraid of, and any numbers you know. Typing or talking both work.</p>
          </div>
          <label htmlFor="decision" className="sr-only">Your decision</label>
          <textarea id="decision" value={text} onChange={(e) => setText(e.target.value)} rows={7}
            placeholder="I'm deciding between… or… I care most about… I'm worried that…"
            className="w-full resize-y rounded-2xl border border-line bg-raised p-5 text-[17px] leading-relaxed outline-none placeholder:text-faint focus:border-line-2" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <VoiceButton onText={(t) => setText((x) => (x ? `${x} ${t}` : t))} />
            <button type="button" onClick={read} disabled={busy || text.trim().length < 20}
              className="min-h-12 rounded-full bg-paper px-6 text-[15px] font-medium text-ink disabled:opacity-40">
              {busy ? "Reading your decision…" : "Continue"}
            </button>
          </div>
          {err && <p role="alert" className="text-[14px] text-shock">{err}</p>}
          <div className="flex flex-col gap-2">
            <span className="label-mono">Or start from an example</span>
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => setText(e)} className="rounded-xl border border-line px-4 py-3 text-left text-[14px] leading-relaxed text-soft hover:border-line-2 hover:text-paper">
                {e}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="label-mono">Your recent forks</span>
              <ul className="flex flex-wrap gap-2">
                {recent.map((r) => <li key={r.id}><Link href={`/sim/${r.id}`} className="inline-block rounded-full border border-line-2 px-3.5 py-2 text-[13px] hover:border-paper">{r.title}</Link></li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {step === "review" && spec && (
        <section className="flex flex-col gap-7">
          <div className="flex flex-col gap-3">
            <span className="label-mono">Here’s what I heard</span>
            <h1 className="font-display text-[34px] leading-tight sm:text-[44px]">{spec.title}</h1>
            <p className="text-[15px] text-soft">Fix anything that’s wrong. These become your ASSUMPTIONS — you can change them later too.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(["path_a", "path_b"] as const).map((k, i) => (
              <fieldset key={k} className={clsx("flex flex-col gap-3 rounded-2xl border bg-raised p-5", i === 0 ? "border-path-a/40" : "border-path-b/40")}>
                <legend className={clsx("px-1 font-mono text-[11px]", i === 0 ? "text-path-a" : "text-path-b")}>PATH {i === 0 ? "A" : "B"}</legend>
                <Field label="Name"><input value={spec[k].label} onChange={(e) => setPath(k, { label: e.target.value })} className={input} /></Field>
                <Field label="City"><input value={spec[k].city ?? ""} onChange={(e) => setPath(k, { city: e.target.value || null })} className={input} /></Field>
                <Field label="Pay per year (USD)">
                  <input inputMode="numeric" value={spec[k].annual_pay_usd ?? ""} placeholder="Unknown"
                    onChange={(e) => setPath(k, { annual_pay_usd: e.target.value ? Number(e.target.value.replace(/[^\d.]/g, "")) : null })} className={input} />
                </Field>
              </fieldset>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Savings right now (USD)">
              <input inputMode="numeric" value={spec.current.savings_usd ?? ""} placeholder="Unknown"
                onChange={(e) => setSpec({ ...spec, current: { ...spec.current, savings_usd: e.target.value ? Number(e.target.value.replace(/[^\d.]/g, "")) : null } })} className={input} />
            </Field>
            <Field label="Monthly spending (USD)">
              <input inputMode="numeric" value={spec.current.monthly_expenses_usd ?? ""} placeholder="Unknown"
                onChange={(e) => setSpec({ ...spec, current: { ...spec.current, monthly_expenses_usd: e.target.value ? Number(e.target.value.replace(/[^\d.]/g, "")) : null } })} className={input} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-3 rounded-2xl border border-line p-5">
            <legend className="px-1 label-mono">How much each matters to you</legend>
            {PRIORITIES.map((p) => (
              <label key={p} className="grid grid-cols-[110px_1fr_24px] items-center gap-4 text-[15px] capitalize">
                {p}
                <input type="range" min={1} max={5} value={spec.priorities[p]} className="accent-paper"
                  onChange={(e) => setSpec({ ...spec, priorities: { ...spec.priorities, [p]: Number(e.target.value) } })} />
                <span className="font-mono text-[13px]">{spec.priorities[p]}</span>
              </label>
            ))}
          </fieldset>
          {spec.clarifying_questions.length > 0 && (
            <div className="flex flex-col gap-4">
              <span className="label-mono">A few questions that change the simulation most</span>
              {spec.clarifying_questions.map((q) => (
                <Field key={q.id} label={q.text} hint={q.why}>
                  <input value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Skip if you’re not sure" className={input} />
                </Field>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={build} disabled={busy} className="min-h-12 rounded-full bg-paper px-6 text-[15px] font-medium text-ink disabled:opacity-40">
              {busy ? "Starting…" : "Build my two worlds"}
            </button>
            <button type="button" onClick={() => setStep("describe")} className="min-h-12 rounded-full border border-line-2 px-6 text-[15px]">Back</button>
          </div>
          {err && <p role="alert" className="text-[14px] text-shock">{err}</p>}
        </section>
      )}
    </main>
  );
}

const input = "min-h-11 w-full rounded-lg border border-line bg-ink-2 px-3 text-[15px] text-paper outline-none placeholder:text-faint focus:border-line-2";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[14px] text-paper-2">{label}</span>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
      {children}
    </label>
  );
}
