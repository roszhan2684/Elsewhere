"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The branching line — one motif for hero, loading, dashboard and shocks.
 * Same inputs as the Rive spec (docs/design-direction.md): split, progressA/B, shockA/B, focus.
 */
export function ForkLine({
  split = 1,
  progressA = 1,
  progressB = 1,
  shockA = 0,
  shockB = 0,
  dimA = false,
  dimB = false,
  labels = true,
  labelA = "A",
  labelB = "B",
  className,
  title,
  instant = false,
}: {
  split?: number;
  progressA?: number;
  progressB?: number;
  shockA?: number; // increment to fire a pulse
  shockB?: number;
  dimA?: boolean;
  dimB?: boolean;
  labels?: boolean;
  labelA?: string;
  labelB?: string;
  className?: string;
  title?: string;
  instant?: boolean;
}) {
  const reduce = useReducedMotion();
  const t = reduce || instant ? { duration: 0 } : { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };
  const A = "M100 140 C100 96 40 92 40 24";
  const B = "M100 140 C100 96 160 92 160 24";
  return (
    <svg viewBox="0 0 200 240" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d="M100 236 L100 140" stroke="var(--color-paper)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* faint full branches = where the world could go */}
      <path d={A} stroke="var(--color-path-a)" strokeOpacity={0.18 * split} strokeWidth="2" strokeDasharray="2 5" fill="none" />
      <path d={B} stroke="var(--color-path-b)" strokeOpacity={0.18 * split} strokeWidth="2" strokeDasharray="2 5" fill="none" />
      {/* glow */}
      <motion.path d={A} stroke="var(--color-path-a)" strokeWidth="10" strokeLinecap="round" fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: split * progressA, strokeOpacity: dimA ? 0.04 : 0.16 }} transition={t} />
      <motion.path d={B} stroke="var(--color-path-b)" strokeWidth="10" strokeLinecap="round" fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: split * progressB, strokeOpacity: dimB ? 0.04 : 0.16 }} transition={t} />
      <motion.path d={A} stroke="var(--color-path-a)" strokeWidth="2.75" strokeLinecap="round" fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: split * progressA, strokeOpacity: dimA ? 0.35 : 1 }} transition={t} />
      <motion.path d={B} stroke="var(--color-path-b)" strokeWidth="2.75" strokeLinecap="round" fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: split * progressB, strokeOpacity: dimB ? 0.35 : 1 }} transition={t} />
      <circle cx="100" cy="140" r="5" fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth="2" />
      {shockA > 0 && <Pulse key={`a${shockA}`} cx={58} cy={78} />}
      {shockB > 0 && <Pulse key={`b${shockB}`} cx={142} cy={78} />}
      {labels && (
        <>
          <text x="40" y="13" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-path-a)">{labelA}</text>
          <text x="160" y="13" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--color-path-b)">{labelB}</text>
        </>
      )}
    </svg>
  );
}

function Pulse({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="6" fill="none" stroke="var(--color-shock)" strokeWidth="2"
        style={{ transformOrigin: `${cx}px ${cy}px`, animation: "shock-pulse 1.4s var(--ease-out-soft) 3" }} />
      <circle cx={cx} cy={cy} r="4.5" fill="var(--color-shock)" />
    </g>
  );
}
