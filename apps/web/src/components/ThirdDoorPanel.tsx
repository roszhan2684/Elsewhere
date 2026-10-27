"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { usd } from "@/lib/finance";
import type { Branch, Simulation, ThirdDoor } from "@/lib/types";
import { ModeBadge } from "./ModeBadge";

/** Idea: Muse Wonder checks whether A-or-B is a false choice and proposes a third door. */
export function ThirdDoorPanel({ sim, ensureLive, onFound }: { sim: Simulation; ensureLive: () => Promise<string>; onFound: (d: ThirdDoor) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"find" | Branch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const door = sim.third_door ?? null;

  async function find() {
    setBusy("find");
    setErr(null);
    try {
      const id = await ensureLive();
      onFound(await api.thirdDoor(id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn’t look for a third door.");
    } finally {
      setBusy(null);
    }
  }

  async function simulate(against: Branch) {
    setBusy(against);
    setErr(null);
    try {
      const id = await ensureLive();
      const { simulation_id } = await api.thirdDoorSimulate(id, against);
      router.push(`/sim/${simulation_id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn’t start the simulation.");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-2">
        <span className="label-mono">Is this really either/or?</span>
        <h3 className="font-display text-[28px] leading-tight sm:text-[34px]">Most hard choices have a door you didn’t list.</h3>
        <p className="text-[15px] leading-relaxed text-soft">
          Muse Wonder reads both worlds, your goals and your fears, then checks whether A-or-B is a false choice. If there’s a realistic third path, it proposes one, and you can simulate it against either path with the same agents.
        </p>
      </div>

      {!door && (
        <button type="button" onClick={find} disabled={busy !== null}
          className="flex min-h-12 items-center gap-3 self-start rounded-full bg-paper px-6 text-[15px] font-medium text-ink disabled:opacity-50">
          <DoorIcon />{busy === "find" ? "Wonder is looking for a third door…" : "Look for a third door"}
        </button>
      )}

      {door && (
        <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-5 rounded-2xl border border-path-c/50 bg-raised p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-path-c font-mono text-[13px] font-semibold text-ink">C</span>
              <span className="label-mono text-path-c">{door.is_real_alternative ? "Third door" : "Closest alternative"}</span>
            </span>
            <ModeBadge mode={door.mode} />
          </div>
          <h4 className="font-display text-[30px] leading-tight">{door.label}</h4>
          <p className="max-w-3xl text-[16px] leading-relaxed text-paper-2">{door.why_not_binary}</p>
          <div className="grid gap-3 md:grid-cols-3">
            <Box tone="a" label="Keeps from Path A" text={door.borrows_from_a} />
            <Box tone="b" label="Keeps from Path B" text={door.borrows_from_b} />
            <Box tone="shock" label="Gives up" text={door.gives_up} />
          </div>
          <div className="flex flex-col gap-1.5 rounded-xl bg-ink-2 p-4">
            <span className="label-mono">The path</span>
            <p className="text-[15px] leading-relaxed">{door.path.notes}</p>
            <p className="font-mono text-[12px] text-muted">
              {[door.path.city, door.path.role, door.path.annual_pay_usd ? `about ${usd(door.path.annual_pay_usd)}/yr (estimate)` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-[1.3fr_1fr]">
            <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-line-2 p-4">
              <span className="label-mono">Test it this week</span>
              <p className="text-[15px] leading-relaxed">{door.first_step}</p>
            </div>
            {door.risks.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-line p-4">
                <span className="label-mono">Risks</span>
                <ul className="flex flex-col gap-1 text-[14px] text-paper-2">{door.risks.map((r) => <li key={r}>— {r}</li>)}</ul>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="text-[14px] text-soft">Simulate it:</span>
            {(["A", "B"] as Branch[]).map((b) => (
              <button key={b} type="button" onClick={() => simulate(b)} disabled={busy !== null}
                className={clsx("min-h-11 rounded-full border px-5 text-[14px] disabled:opacity-50", b === "A" ? "border-path-a/60 hover:border-path-a" : "border-path-b/60 hover:border-path-b")}>
                {busy === b ? "Building the worlds…" : <>Door C vs Path {b} · {sim.branches[b].label}</>}
              </button>
            ))}
            <button type="button" onClick={find} disabled={busy !== null} className="min-h-11 rounded-full px-4 text-[13px] text-muted hover:text-paper disabled:opacity-50">
              {busy === "find" ? "Looking…" : "Ask again"}
            </button>
          </div>
          <p className="text-[12px] text-muted">The third door is an INFERENCE by Muse Wonder. Simulating it builds two new worlds with the same agents and checks.</p>
        </motion.article>
      )}
      {err && <p role="alert" className="text-[14px] text-shock">{err}</p>}
    </div>
  );
}

function Box({ tone, label, text }: { tone: "a" | "b" | "shock"; label: string; text: string }) {
  return (
    <div className={clsx("flex flex-col gap-1.5 rounded-xl border p-4", tone === "a" ? "border-path-a/40" : tone === "b" ? "border-path-b/40" : "border-shock/40")}>
      <span className={clsx("label-mono", tone === "a" ? "text-path-a" : tone === "b" ? "text-path-b" : "text-shock")}>{label}</span>
      <p className="text-[14px] leading-relaxed">{text}</p>
    </div>
  );
}

export function DoorIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M5 21V4a1 1 0 0 1 1-1h9l4 2v16" /><path d="M3 21h18" /><circle cx="14" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}
