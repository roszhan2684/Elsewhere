"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";

export interface AgentRow {
  key: string;
  agent: string;
  branch: string;
  model: string;
  summary?: string;
  status: "running" | "done";
}

const NAMES: Record<string, string> = {
  orchestrator: "Orchestrator — plan & delegate",
  reconcile: "Orchestrator — reconcile",
  career: "Career agent",
  finance: "Finance agent",
  lifestyle: "Lifestyle agent",
  risk: "Risk agent",
  values: "Values agent",
  evidence: "Evidence resolver",
  compiler: "World compiler",
  consistency: "Consistency checks",
  shock_planner: "Shock planner",
  front_pages: "Front-page writer",
};

/** Shows what each agent finished — never its private reasoning. */
export function AgentList({ rows }: { rows: AgentRow[] }) {
  return (
    <ol className="flex flex-col gap-1" aria-live="polite">
      <AnimatePresence initial={false}>
        {rows.map((r) => (
          <motion.li key={r.key} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 sm:gap-4", r.status === "running" && "bg-raised")}>
            <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full",
              r.status === "done" ? "bg-paper" : "bg-path-a shadow-[0_0_0_4px_rgba(126,182,255,.18)] animate-pulse")} aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[15px] font-medium">{NAMES[r.agent] ?? r.agent}</span>
                {r.branch !== "both" && r.branch !== "shared" && (
                  <span className={clsx("font-mono text-[11px]", r.branch === "A" ? "text-path-a" : r.branch === "B" ? "text-path-b" : "text-muted")}>
                    {r.branch === "A" || r.branch === "B" ? `Path ${r.branch}` : r.branch}
                  </span>
                )}
              </div>
              {r.summary && <span className="truncate text-[13px] text-muted">{r.summary}</span>}
            </div>
            <span className="hidden shrink-0 font-mono text-[11px] text-muted sm:inline">{r.model}</span>
            <span className={clsx("w-16 shrink-0 text-right font-mono text-[10px] tracking-[0.08em]", r.status === "done" ? "text-paper" : "text-path-a")}>
              {r.status === "done" ? "DONE" : "RUNNING"}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

export function reduceAgentEvent(rows: AgentRow[], type: string, data: Record<string, unknown>): AgentRow[] {
  const agent = String(data.agent ?? "");
  const branch = String(data.branch ?? "");
  const key = `${agent}:${branch}`;
  if (type === "agent_started") {
    if (rows.some((r) => r.key === key && r.status === "running")) return rows;
    return [...rows.filter((r) => r.key !== key), { key, agent, branch, model: String(data.model ?? ""), summary: data.summary as string | undefined, status: "running" }];
  }
  if (type === "agent_done") {
    const exists = rows.some((r) => r.key === key);
    const done: AgentRow = { key, agent, branch, model: String(data.model ?? ""), summary: data.summary as string | undefined, status: "done" };
    return exists ? rows.map((r) => (r.key === key ? done : r)) : [...rows, done];
  }
  return rows;
}
