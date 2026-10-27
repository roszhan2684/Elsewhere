"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AgentRow } from "./AgentList";

type Kind = "wonder" | "spark" | "code";
interface Node {
  id: string; // agent:branch, matching AgentRow.key
  label: string;
  x: number;
  y: number;
  kind: Kind;
  branch?: "A" | "B";
  alt?: string[]; // other keys that light the same node
}
interface Edge {
  from: string;
  to: string;
}

const SPEC = ["career", "finance", "lifestyle", "risk", "values"];
const SHOCK_SPEC = ["career", "lifestyle", "risk", "values"];

function layout(mode: "simulate" | "shock"): { nodes: Node[]; edges: Edge[]; h: number } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  if (mode === "simulate") {
    nodes.push({ id: "orchestrator:both", label: "Wonder · plan", x: 320, y: 34, kind: "wonder" });
    nodes.push({ id: "evidence:A", label: "Web search", x: 160, y: 104, kind: "spark", branch: "A" });
    nodes.push({ id: "evidence:B", label: "Web search", x: 480, y: 104, kind: "spark", branch: "B", alt: ["evidence:shared"] });
    SPEC.forEach((d, i) => {
      nodes.push({ id: `${d}:A`, label: d, x: 44 + i * 56, y: 178, kind: "spark", branch: "A" });
      nodes.push({ id: `${d}:B`, label: d, x: 372 + i * 56, y: 178, kind: "spark", branch: "B" });
    });
    nodes.push({ id: "compiler:both", label: "Compile · code", x: 320, y: 250, kind: "code" });
    nodes.push({ id: "reconcile:both", label: "Wonder · reconcile", x: 220, y: 316, kind: "wonder" });
    nodes.push({ id: "consistency:both", label: "Spark · checks", x: 420, y: 316, kind: "spark" });
    for (const n of nodes) if (n.kind === "spark" && n.y >= 100 && n.y <= 180) {
      edges.push({ from: "orchestrator:both", to: n.id });
      if (!n.id.startsWith("evidence")) edges.push({ from: n.id, to: "compiler:both" });
    }
    edges.push({ from: "compiler:both", to: "reconcile:both" }, { from: "reconcile:both", to: "consistency:both" });
    return { nodes, edges, h: 350 };
  }
  nodes.push({ id: "shock_planner:both", label: "Wonder · shock plan", x: 320, y: 34, kind: "wonder" });
  SHOCK_SPEC.forEach((d, i) => {
    nodes.push({ id: `${d}:A`, label: d, x: 74 + i * 60, y: 130, kind: "spark", branch: "A" });
    nodes.push({ id: `${d}:B`, label: d, x: 386 + i * 60, y: 130, kind: "spark", branch: "B" });
  });
  nodes.push({ id: "front_pages:both", label: "Spark · front pages", x: 320, y: 222, kind: "spark" });
  for (const n of nodes) if (n.y === 130) edges.push({ from: "shock_planner:both", to: n.id }, { from: n.id, to: "front_pages:both" });
  return { nodes, edges, h: 256 };
}

/** Wonder delegating to Spark specialists, lit up live as each agent starts and finishes. */
export function AgentGraph({ rows, mode, caption }: { rows: AgentRow[]; mode: "simulate" | "shock"; caption?: string }) {
  const { nodes, edges, h } = layout(mode);
  const state = (n: Node): "idle" | "running" | "done" => {
    const keys = [n.id, ...(n.alt ?? [])];
    const rs = rows.filter((r) => keys.includes(r.key));
    if (rs.some((r) => r.status === "running")) return "running";
    if (rs.length) return "done";
    return "idle";
  };
  const by = new Map(nodes.map((n) => [n.id, n]));
  const states = new Map(nodes.map((n) => [n.id, state(n)]));
  const running = [...states.values()].filter((s) => s === "running").length;
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 640 ${h}`} className="h-auto w-full" role="img"
        aria-label={`Agent graph: ${running} agents running, ${[...states.values()].filter((s) => s === "done").length} done.`}>
        {edges.map((e) => {
          const a = by.get(e.from)!;
          const b = by.get(e.to)!;
          const sa = states.get(e.from);
          const sb = states.get(e.to);
          const live = sb === "running" || (sa === "running" && sb !== "done");
          const color = b.branch === "A" || a.branch === "A" ? "stroke-path-a" : b.branch === "B" || a.branch === "B" ? "stroke-path-b" : "stroke-paper";
          const d = `M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}`;
          return (
            <path key={`${e.from}-${e.to}`} d={d} fill="none" strokeWidth={live ? 1.6 : 1}
              className={clsx(live ? `${color} agent-flow` : sb === "done" && sa === "done" ? `${color} opacity-40` : "stroke-line")}
              strokeDasharray={live ? "4 6" : undefined} />
          );
        })}
        {nodes.map((n) => {
          const s = states.get(n.id)!;
          const r = n.kind === "wonder" ? 15 : 11;
          const tone = n.kind === "wonder" ? "paper" : n.kind === "code" ? "soft" : n.branch === "A" ? "a" : n.branch === "B" ? "b" : "paper2";
          const fill = { paper: "fill-paper", soft: "fill-soft", a: "fill-path-a", b: "fill-path-b", paper2: "fill-paper-2" }[tone];
          const stroke = { paper: "stroke-paper", soft: "stroke-soft", a: "stroke-path-a", b: "stroke-path-b", paper2: "stroke-paper-2" }[tone];
          return (
            <g key={n.id} className={clsx(s === "idle" && "opacity-35")}>
              {s === "running" && (
                <motion.circle cx={n.x} cy={n.y} r={r} className={clsx("fill-none", stroke)} strokeWidth={2}
                  initial={{ scale: 1, opacity: 0.9 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ repeat: Infinity, duration: 1.1, ease: "easeOut" }}
                  style={{ transformOrigin: `${n.x}px ${n.y}px` }} />
              )}
              {n.kind === "code" ? (
                <rect x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} rx={3} className={clsx(s === "done" ? fill : "fill-ink-2", stroke)} strokeWidth={1.5} />
              ) : (
                <circle cx={n.x} cy={n.y} r={r} className={clsx(s === "done" ? fill : "fill-ink-2", stroke)} strokeWidth={1.5} />
              )}
              <text x={n.x} y={n.y + r + 13} textAnchor="middle" className="fill-soft text-[10px]">{n.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-paper" />Muse Wonder</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-path-a" /><span className="-ml-1 h-2.5 w-2.5 rounded-full bg-path-b" />Muse Spark</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-soft" />Code</span>
        {caption && <span className="ml-auto">{caption}</span>}
      </figcaption>
    </figure>
  );
}

export interface ReplayStep {
  at: number; // ms from start
  type: "agent_started" | "agent_done";
  agent: string;
  branch: string;
}

/** The order the pipeline really runs in (timings are illustrative unless real call logs are used). */
export function scriptedBuild(): ReplayStep[] {
  const out: ReplayStep[] = [{ at: 0, type: "agent_started", agent: "orchestrator", branch: "both" }];
  let t = 500;
  for (const b of ["A", "B"]) out.push({ at: t, type: "agent_started", agent: "evidence", branch: b });
  for (const b of ["A", "B"]) for (const d of SPEC) out.push({ at: t + 150 + Math.random() * 300, type: "agent_started", agent: d, branch: b });
  for (const b of ["A", "B"]) out.push({ at: t + 1200 + Math.random() * 400, type: "agent_done", agent: "evidence", branch: b });
  for (const b of ["A", "B"]) for (const d of SPEC) out.push({ at: t + 1500 + Math.random() * 1600, type: "agent_done", agent: d, branch: b });
  t += 3300;
  out.push({ at: t, type: "agent_done", agent: "orchestrator", branch: "both" });
  out.push({ at: t + 100, type: "agent_started", agent: "compiler", branch: "both" }, { at: t + 500, type: "agent_done", agent: "compiler", branch: "both" });
  out.push({ at: t + 600, type: "agent_started", agent: "reconcile", branch: "both" }, { at: t + 1700, type: "agent_done", agent: "reconcile", branch: "both" });
  out.push({ at: t + 1800, type: "agent_started", agent: "consistency", branch: "both" }, { at: t + 2500, type: "agent_done", agent: "consistency", branch: "both" });
  return out.sort((a, b) => a.at - b.at);
}

const AGENT_OF: Record<string, [string, string]> = {
  orchestrator_plan: ["orchestrator", "both"], orchestrator_reconcile: ["reconcile", "both"], consistency: ["consistency", "both"],
};

/** Turn recorded model calls (agent, created_at = end time, latency) into a replay at 4x speed. */
export function callsToReplay(calls: { agent: string; created_at: string; latency_ms: number }[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  const spans = calls.map((c) => {
    const end = new Date(c.created_at).getTime();
    let agent: string;
    let branch: string;
    if (AGENT_OF[c.agent]) [agent, branch] = AGENT_OF[c.agent];
    else if (c.agent.startsWith("grounding_")) [agent, branch] = ["evidence", c.agent.split("_")[1] === "shared" ? "shared" : c.agent.split("_")[1]];
    else {
      const m = c.agent.match(/^(career|finance|lifestyle|risk|values)_([AB])$/);
      if (!m) return null;
      [agent, branch] = [m[1], m[2]];
    }
    return { agent, branch, start: end - c.latency_ms, end };
  }).filter((x): x is { agent: string; branch: string; start: number; end: number } => !!x);
  if (!spans.length) return [];
  const t0 = Math.min(...spans.map((s) => s.start));
  const speed = 4;
  for (const s of spans) {
    steps.push({ at: (s.start - t0) / speed, type: "agent_started", agent: s.agent, branch: s.branch });
    steps.push({ at: (s.end - t0) / speed, type: "agent_done", agent: s.agent, branch: s.branch });
  }
  const recon = steps.find((s) => s.agent === "reconcile" && s.type === "agent_started");
  if (recon) {
    steps.push({ at: recon.at - 300, type: "agent_started", agent: "compiler", branch: "both" }, { at: recon.at - 50, type: "agent_done", agent: "compiler", branch: "both" });
  }
  return steps.sort((a, b) => a.at - b.at);
}

/** Plays a list of steps into AgentRows. */
export function useReplay(): { rows: AgentRow[]; play: (steps: ReplayStep[]) => void; playing: boolean } {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [playing, setPlaying] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  function play(steps: ReplayStep[]) {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRows([]);
    setPlaying(true);
    for (const s of steps) {
      timers.current.push(setTimeout(() => {
        setRows((rs) => {
          const key = `${s.agent}:${s.branch}`;
          const row: AgentRow = { key, agent: s.agent, branch: s.branch, model: "", status: s.type === "agent_started" ? "running" : "done" };
          return rs.some((r) => r.key === key) ? rs.map((r) => (r.key === key ? row : r)) : [...rs, row];
        });
      }, s.at));
    }
    const end = Math.max(0, ...steps.map((s) => s.at)) + 400;
    timers.current.push(setTimeout(() => setPlaying(false), end));
  }
  return { rows, play, playing };
}
