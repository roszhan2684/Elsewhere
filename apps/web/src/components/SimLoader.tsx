"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api, subscribe } from "@/lib/api";
import type { PersonaMessage, Simulation } from "@/lib/types";
import { AgentList, type AgentRow, reduceAgentEvent } from "./AgentList";
import { ForkLine } from "./ForkLine";
import { ForkMark } from "./ForkMark";
import { LoadingShell } from "./LoadingShell";
import { ModeBadge } from "./ModeBadge";
import { Workspace } from "./Workspace";

export function SimLoader() {
  const { id } = useParams<{ id: string }>();
  const [sim, setSim] = useState<Simulation | null>(null);
  const [messages, setMessages] = useState<PersonaMessage[]>([]);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let alive = true;
    (async () => {
      try {
        const s = await api.simulation(id);
        if (!alive) return;
        if (s.status === "ready") {
          setMessages(await api.messages(id));
          setSim(s);
          return;
        }
        setSim(s);
        unsub = subscribe(id, async (type, data) => {
          if (type === "agent_started" || type === "agent_done") setRows((r) => reduceAgentEvent(r, type, data));
          if (type === "simulation_failed") setFailed(String(data.error));
          if (type === "simulation_ready") {
            unsub?.();
            const fresh = await api.simulation(id);
            if (alive) setSim(fresh);
          }
        });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't load this simulation.");
      }
    })();
    return () => {
      alive = false;
      unsub?.();
    };
  }, [id]);

  if (error) return <LoadingShell message={error} />;
  if (!sim) return <LoadingShell />;
  if (sim.status === "ready") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <Workspace initial={sim} liveId={sim.id} messages={messages} />
      </motion.div>
    );
  }

  const done = (b: string) => rows.filter((r) => r.status === "done" && r.branch === b).length;
  const progress = (b: string) => Math.min(1, 0.06 + done(b) / 6);
  const finished = rows.filter((r) => r.status === "done").length;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-10 px-4 py-10 sm:px-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 font-display text-[22px]"><ForkMark />Elsewhere</Link>
        <ModeBadge mode={sim.mode} />
      </div>
      <div className="flex flex-col gap-3">
        <span className="label-mono">Building two worlds</span>
        <h1 className="max-w-4xl font-display text-[32px] leading-tight sm:text-[44px]">{sim.decision.question || sim.decision.title}</h1>
      </div>
      {failed ? (
        <div className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-raised p-6">
          <p className="text-[16px]">{failed}</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => { setFailed(null); setRows([]); api.simulate(id).catch(() => {}); }} className="min-h-11 rounded-full bg-paper px-5 text-[14px] font-medium text-ink">Try again</button>
            <Link href="/demo" className="flex min-h-11 items-center rounded-full border border-line-2 px-5 text-[14px]">Open a saved demo</Link>
          </div>
        </div>
      ) : sim.status === "draft" ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-soft">This decision hasn’t been simulated yet.</p>
          <button type="button" onClick={() => { api.simulate(id).then(() => location.reload()); }} className="min-h-11 rounded-full bg-paper px-5 text-[14px] font-medium text-ink">Build the two worlds</button>
        </div>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-ink-2 p-8">
            <ForkLine className="h-[300px] w-[250px]" progressA={progress("A")} progressB={progress("B")}
              labelA={`A · ${sim.decision.path_a.city ?? ""}`.trim()} labelB={`B · ${sim.decision.path_b.city ?? ""}`.trim()}
              title={`${finished} agents finished`} />
            <p className="font-mono text-[13px] text-muted">{finished} agents finished</p>
          </div>
          <div className="flex flex-col gap-3">
            <AgentList rows={rows} />
            <p className="px-3 text-[13px] leading-relaxed text-muted">We show what each agent finished, never its private reasoning. Specialists run in parallel; each branch grows as its agents finish.</p>
          </div>
        </div>
      )}
    </main>
  );
}
