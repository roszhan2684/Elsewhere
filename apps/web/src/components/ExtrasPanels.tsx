"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { ApiError, type ModelCall, api, assetUrl } from "@/lib/api";
import type { Branch, Simulation } from "@/lib/types";
import { snap } from "@/lib/types";
import { AgentGraph, callsToReplay, scriptedBuild, useReplay } from "./AgentGraph";
import { CounselorBrief } from "./CounselorBrief";

// ------------------------------------------------------------ postcards

export function PostcardsPanel({
  sim,
  ensureLive,
  initial,
  liveId,
}: {
  sim: Simulation;
  ensureLive: () => Promise<string>;
  initial?: Partial<Record<Branch, string>>;
  liveId: string | null;
}) {
  const [cards, setCards] = useState<Partial<Record<Branch, string>>>(initial ?? {});
  const [busy, setBusy] = useState<Branch | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!liveId) return;
    api.assets(liveId).then((as) => {
      const next: Partial<Record<Branch, string>> = {};
      for (const a of as) if (a.kind === "postcard") next[a.branch] = a.url;
      if (Object.keys(next).length) setCards((c) => ({ ...c, ...next }));
    }).catch(() => {});
  }, [liveId]);

  async function make(b: Branch) {
    setBusy(b);
    setErr(null);
    try {
      const id = await ensureLive();
      const r = await api.postcard(id, b);
      setCards((c) => ({ ...c, [b]: r.url }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't make the postcard.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-[15px] leading-relaxed text-soft">
        A postcard from each life at year two. Muse Image paints it from that world’s state: the city, the work, the mood.
      </p>
      <div className="grid gap-5 md:grid-cols-2">
        {(["A", "B"] as Branch[]).map((b) => {
          const s = snap(sim.branches[b], "m24");
          return (
            <figure key={b} className="flex flex-col gap-3">
              <div className={clsx("relative aspect-[3/2] overflow-hidden rounded-xl border bg-ink-2", b === "A" ? "border-path-a/40" : "border-path-b/40")}>
                {cards[b] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(cards[b]!)} alt={`Postcard from Path ${b}: ${s.location.city.text ?? sim.branches[b].label}, year two`} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center p-6 text-center text-[14px] text-muted">No postcard yet</div>
                )}
              </div>
              <figcaption className="flex items-center justify-between gap-3">
                <span className="text-[14px]"><b className={b === "A" ? "text-path-a" : "text-path-b"}>Path {b}</b> · {s.headline}</span>
                <button type="button" onClick={() => make(b)} disabled={busy !== null}
                  className="min-h-10 shrink-0 rounded-full border border-line-2 px-4 text-[13px] hover:border-paper disabled:opacity-50">
                  {busy === b ? "Painting…" : cards[b] ? "Repaint" : "Make postcard"}
                </button>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {err && <p role="alert" className="text-[14px] text-shock">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------ brief

export function BriefPanel({ sim }: { sim: Simulation }) {
  const [view, setView] = useState<"brief" | "counselor">("brief");
  return (
    <div className="flex flex-col gap-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Brief style" className="flex gap-1 rounded-full bg-ink-2 p-1 text-[14px]">
          {([["brief", "Decision brief"], ["counselor", "Counselor handout"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} type="button" onClick={() => setView(k)}
              className={clsx("min-h-10 rounded-full px-4", view === k ? "bg-paper font-medium text-ink" : "text-soft")}>{l}</button>
          ))}
        </div>
        {view === "counselor" && (
          <button type="button" onClick={() => window.print()} className="min-h-10 rounded-full bg-paper px-4 text-[13px] font-medium text-ink">Print / save PDF</button>
        )}
      </div>
      {view === "counselor" ? (
        <>
          <p className="no-print max-w-3xl text-[14px] leading-relaxed text-soft">
            A one-page guide for a school counselor, mentor or caseworker to go through together: plain language, the same numbers as the app, questions to talk about, and space for notes. Built in your browser with no model call.
          </p>
          <CounselorBrief sim={sim} />
        </>
      ) : <StandardBrief sim={sim} />}
    </div>
  );
}

function StandardBrief({ sim }: { sim: Simulation }) {
  const c = sim.comparison;
  return (
    <article className="print-area flex flex-col gap-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-2">
          <span className="label-mono">Decision brief · version {sim.version}</span>
          <h3 className="font-display text-[30px] leading-tight">{sim.decision.question || sim.decision.title}</h3>
        </div>
        <button type="button" onClick={() => window.print()} className="no-print min-h-10 rounded-full border border-line-2 px-4 text-[13px]">Print / save PDF</button>
      </div>
      {c && <p className="max-w-3xl text-[16px] leading-relaxed text-paper-2">{c.summary}</p>}
      <div className="grid gap-5 md:grid-cols-2">
        {(["A", "B"] as Branch[]).map((b) => {
          const bw = sim.branches[b];
          return (
            <div key={b} className="flex flex-col gap-3 rounded-xl border border-line p-5">
              <span className={clsx("font-medium", b === "A" ? "text-path-a" : "text-path-b")}>Path {b} · {bw.label}</span>
              <p className="text-[14px] leading-relaxed text-paper-2">{bw.summary}</p>
              <ul className="flex flex-col gap-1.5 text-[14px]">
                {bw.top_tradeoffs.map((t) => <li key={t}>— {t}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      {c && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="label-mono">Assumptions that decide it</span>
            <ul className="flex flex-col gap-1.5 text-[15px]">{c.dominant_assumptions.map((a) => <li key={a}>— {a}</li>)}</ul>
          </div>
          <div className="flex flex-col gap-2">
            <span className="label-mono">What would change my mind</span>
            <ul className="flex flex-col gap-1.5 text-[15px]">{c.what_would_change_my_mind.map((a) => <li key={a}>— {a}</li>)}</ul>
          </div>
        </div>
      )}
      {sim.shocks.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="label-mono">Stress tests</span>
          <ul className="flex flex-col gap-2 text-[15px]">
            {sim.shocks.map((s) => (
              <li key={s.id}><b className="font-medium">{s.label}</b> — {s.verdict ? `${s.verdict.more_robust === "tie" ? "no clear winner" : `Path ${s.verdict.more_robust} more robust`}. ${s.verdict.why}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[13px] leading-relaxed text-muted">
        Elsewhere explores scenarios. It does not predict your future or give financial, legal or medical advice. Every number is a range built from the assumptions listed in Evidence.
      </p>
    </article>
  );
}

// ------------------------------------------------------------ under the hood

export function HoodPanel({ sim, liveId }: { sim: Simulation; liveId: string | null }) {
  const [budget, setBudget] = useState<{ mode: string; limit_usd: number; spent_usd: number; remaining_usd: number } | null>(null);
  useEffect(() => {
    api.budget().then(setBudget).catch(() => setBudget(null));
  }, [sim.version]);
  const [calls, setCalls] = useState<{ calls: ModelCall[]; by_model: Record<string, { calls: number; input_tokens: number; output_tokens: number; cached_tokens: number; latency_ms: number }> } | null>(null);
  useEffect(() => {
    if (liveId) api.calls(liveId).then(setCalls).catch(() => setCalls(null));
  }, [liveId, sim.version]);
  const roles: Record<string, string> = {
    "muse-wonder-1.0": "Plans the worlds, delegates to specialists, reconciles them, plans shocks",
    "muse-spark-1.3": "Career, finance, lifestyle, risk and values agents; web grounding; consistency; future selves",
    "muse-image-1.0": "Future postcards",
    "muse-voice-transcribe-1.0": "Voice intake",
  };
  const replay = useReplay();
  const real = calls ? callsToReplay(calls.calls) : [];
  const usesReal = real.some((s) => s.agent === "orchestrator") && real.length > 8;
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="label-mono">Watch this world get built</span>
          <button type="button" onClick={() => replay.play(usesReal ? real : scriptedBuild())} disabled={replay.playing}
            className="min-h-10 rounded-full bg-paper px-4 text-[13px] font-medium text-ink disabled:opacity-50">
            {replay.playing ? "Replaying…" : "Replay the build"}
          </button>
        </div>
        <AgentGraph rows={replay.rows} mode="simulate"
          caption={usesReal ? "real call timings from this run, 4× speed" : "real pipeline order; timing is illustrative"} />
      </div>
      <div className="flex flex-col gap-3">
        <span className="label-mono">How this world was built</span>
        <ol className="grid gap-2 text-[14px] md:grid-cols-5">
          {[
            ["Muse Wonder", "plans and delegates with function tools"],
            ["Muse Spark × 10", "specialists run in parallel, plus web-search grounding"],
            ["Code", "compiles a typed WorldState and does all the money math"],
            ["Muse Wonder", "reconciles both worlds"],
            ["Checks", "code invariants + a Spark consistency pass"],
          ].map(([t, d], i) => (
            <li key={i} className="flex flex-col gap-1 rounded-xl border border-line p-3.5">
              <span className="font-mono text-[10px] text-muted">STEP {i + 1}</span>
              <span className="font-medium">{t}</span>
              <span className="text-[13px] leading-snug text-soft">{d}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        <span className="label-mono">Checks before this world was shown</span>
        <ul className="grid gap-2 md:grid-cols-2">
          {sim.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-3 rounded-xl bg-raised px-4 py-3">
              <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", c.passed ? "bg-[#5fd38d]" : "bg-shock")} aria-hidden="true" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium">{c.name}{c.repaired ? <span className="ml-2 font-mono text-[11px] text-path-b">{c.repaired} repaired</span> : null}</span>
                <span className="text-[13px] leading-snug text-muted">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <span className="label-mono">Meta models used {sim.mode === "mock" && "(offline mock — scripted stand-ins, not real calls)"}</span>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-normal">Model</th><th className="px-4 py-2.5 font-normal">Job in Elsewhere</th>
                <th className="px-4 py-2.5 text-right font-normal">Calls</th><th className="px-4 py-2.5 text-right font-normal">Tokens in / cached / out</th>
                <th className="px-4 py-2.5 text-right font-normal">Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(roles).map((m) => {
                const s = calls?.by_model[m];
                return (
                  <tr key={m} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-mono">{m}</td>
                    <td className="px-4 py-2.5 text-soft">{roles[m]}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{s?.calls ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{s ? `${s.input_tokens.toLocaleString()} / ${s.cached_tokens.toLocaleString()} / ${s.output_tokens.toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{s ? `${Math.round(s.latency_ms / s.calls)}ms` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!liveId && <p className="text-[13px] text-muted">This is the saved demo. Call stats appear once you run something live on it.</p>}
        {calls && <p className="text-[13px] text-muted">Recorded cost of this simulation: ${calls.calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(4)} (includes a 15% safety margin).</p>}
        {budget && (
          <p className="text-[13px] text-muted">
            Hard budget for live Meta calls: ${budget.spent_usd.toFixed(2)} of ${budget.limit_usd.toFixed(2)} used{budget.mode === "mock" ? " · live calls are switched off" : ""}. Calls that could exceed it are refused before they reach Meta.
          </p>
        )}
      </div>
    </div>
  );
}
