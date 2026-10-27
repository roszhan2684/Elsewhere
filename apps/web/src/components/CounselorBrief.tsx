"use client";

import { useMemo } from "react";
import { defaultAssumptions, doorReport } from "@/lib/doors";
import { payAt, savingsRange, usd } from "@/lib/finance";
import { runFutures } from "@/lib/futures";
import type { Branch, Simulation } from "@/lib/types";
import { snap } from "@/lib/types";
import { tensions, valuesPick } from "@/lib/values";
import { doorSentence } from "./DoorsPanel";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const range = ([lo, hi]: [number, number]) => (Math.abs(hi - lo) < 1000 ? usd((lo + hi) / 2) : `${usd(Math.min(lo, hi))} to ${usd(Math.max(lo, hi))}`);

/**
 * Idea: a printable handout for school counselors, mentors and caseworkers. Plain language, built
 * from the same numbers as the app (no model call), with questions to talk through and space for notes.
 */
export function CounselorBrief({ sim }: { sim: Simulation }) {
  const d = sim.decision;
  const fut = useMemo(() => runFutures(sim, { seed: 1, n: 1000, roughness: 1, keepTraces: 0 }), [sim]);
  const doors = useMemo(() => (["A", "B"] as Branch[]).map((b) => doorReport(sim, b, defaultAssumptions(sim))), [sim]);
  const values = valuesPick(sim, d.priorities);
  const ts = tensions(sim, d.priorities, "m24");
  const fits: Record<Branch, number> = { A: values.fitA, B: values.fitB };

  const questions: string[] = [];
  for (const b of ["A", "B"] as Branch[]) {
    const s = fut.branches[b];
    if (s.debtPct >= 0.2 && !s.plannedDebt) questions.push(`Path ${b} ends up in debt in about ${Math.round(s.debtPct * 10)} out of 10 simulated futures. What would the backup plan be?`);
    if (s.plannedDebt) questions.push(`Path ${b} means borrowing money on purpose. How much debt feels okay, and when should it be paid back?`);
  }
  for (const r of doors) if (r.closesAt !== null && r.closesAt <= 24) questions.push(`On Path ${r.from}, the way back to Path ${r.to} gets hard to afford around month ${Math.max(0, r.closesAt - 1)}. Is that okay?`);
  for (const t of ts) questions.push(`${t.text} Which matters more right now?`);
  for (const f of d.fears.slice(0, 2)) questions.push(`You said you worry: “${f}”. What would make that less likely on each path?`);
  for (const g of d.goals.slice(0, 2)) questions.push(`Which path gets you closer to: “${g}”?`);
  questions.push("Who else is affected by this choice, and what do they think?");
  questions.push("What would you need to see in the first three months to know it’s working?");

  const verify = sim.evidence.filter((e) => e.kind !== "FACT" && e.confidence === "low").slice(0, 6);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const rows: [string, (b: Branch) => string][] = [
    ["Pay now", (b) => `${usd(payAt(sim.branches[b].finance_inputs, 0))} a year`],
    ["Savings in 2 years", (b) => range(savingsRange(sim.branches[b].finance_inputs, 24))],
    ["Savings in 5 years", (b) => range(savingsRange(sim.branches[b].finance_inputs, 60))],
    ["Work hours", (b) => snap(sim.branches[b], "m24").lifestyle.work_hours.text ?? "Unknown"],
    ["Stress (year 2)", (b) => snap(sim.branches[b], "m24").lifestyle.stress.text ?? "Unknown"],
    ["Biggest risk", (b) => snap(sim.branches[b], "m0").risk.downside.text ?? "Unknown"],
    ["In debt in bad years", (b) => `${pct(fut.branches[b].debtPct)} of 1,000 futures${fut.branches[b].plannedDebt ? " (the plan borrows)" : ""}`],
    ["Fits their priorities", (b) => pct(fits[b])],
  ];

  return (
    <article className="print-area flex flex-col gap-7 rounded-md bg-white p-6 text-[#16161a] sm:p-10">
      <header className="flex flex-col gap-2 border-b-2 border-[#16161a] pb-4">
        <div className="flex flex-wrap justify-between gap-2 font-mono text-[11px] tracking-[0.08em] text-[#4a4a52]">
          <span>ELSEWHERE · DECISION CONVERSATION GUIDE</span>
          <span>{today.toUpperCase()}</span>
        </div>
        <h3 className="font-display text-[30px] leading-tight">{d.question || d.title}</h3>
        <p className="text-[14px] text-[#4a4a52]">For a conversation with a counselor, mentor, teacher or caseworker. Everything here is a scenario, not a prediction or advice.</p>
      </header>

      <Section n={1} title="What they told us">
        <ul className="grid gap-1 text-[15px] sm:grid-cols-2">
          <li><b>Option A:</b> {sim.branches.A.label}</li>
          <li><b>Option B:</b> {sim.branches.B.label}</li>
          {d.goals.length > 0 && <li><b>Hopes:</b> {d.goals.join("; ")}</li>}
          {d.fears.length > 0 && <li><b>Worries:</b> {d.fears.join("; ")}</li>}
          {d.constraints.length > 0 && <li className="sm:col-span-2"><b>Limits:</b> {d.constraints.join(" ")}</li>}
        </ul>
      </Section>

      <Section n={2} title="The two paths side by side">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-[#16161a]">
                <th className="py-2 pr-3 font-normal text-[#4a4a52]" />
                <th className="py-2 pr-3">A · {sim.branches.A.label}</th>
                <th className="py-2">B · {sim.branches.B.label}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, f]) => (
                <tr key={label} className="border-b border-[#d6d2c9] align-top">
                  <td className="py-2 pr-3 text-[#4a4a52]">{label}</td>
                  <td className="py-2 pr-3">{f("A")}</td>
                  <td className="py-2">{f("B")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={3} title="Can they change their mind later?">
        <ul className="flex flex-col gap-1.5 text-[15px]">{doors.map((r) => <li key={r.from}>— {doorSentence(r, sim)}</li>)}</ul>
      </Section>

      <Section n={4} title="Questions to talk through">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-relaxed">{questions.slice(0, 8).map((q) => <li key={q}>{q}</li>)}</ol>
      </Section>

      {(sim.comparison?.what_would_change_my_mind.length || verify.length) ? (
        <Section n={5} title="Check these before deciding">
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {sim.comparison?.what_would_change_my_mind.map((w) => <li key={w}>☐ {w}</li>)}
            {verify.map((e) => <li key={e.id}>☐ {e.text.replace(/\s*\(estimate\)\.?$/, "")} <span className="text-[#6b6c74]">(a rough guess in the simulation)</span></li>)}
          </ul>
        </Section>
      ) : null}

      <Section n={6} title="Next steps">
        <ul className="flex flex-col gap-3 text-[15px]">
          <li>☐ Talk to: <Blank /></li>
          <li>☐ Find out: <Blank /></li>
          <li>☐ Check in again on: <Blank /> (Elsewhere can compare real life with both paths)</li>
        </ul>
        <div className="mt-4 flex flex-col gap-5">
          <span className="font-mono text-[11px] tracking-[0.08em] text-[#4a4a52]">NOTES</span>
          {[0, 1, 2, 3].map((i) => <div key={i} className="border-b border-[#bdb8ad]" />)}
        </div>
      </Section>

      <footer className="border-t border-[#d6d2c9] pt-3 text-[12px] leading-relaxed text-[#4a4a52]">
        Made with Elsewhere (v{sim.version}). Numbers are ranges from stated assumptions and a simple money model; “1,000 futures” uses rough yearly odds of layoffs, bills and raises. This is not financial, legal, medical or immigration advice. For local help: a school or career counselor, a nonprofit financial counselor, or in the US, dial 211.
      </footer>
    </article>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 break-inside-avoid">
      <h4 className="flex items-baseline gap-3 font-display text-[21px] font-semibold"><span className="font-mono text-[12px] text-[#6b6c74]">0{n}</span>{title}</h4>
      {children}
    </section>
  );
}

function Blank() {
  return <span className="inline-block w-56 border-b border-[#16161a] align-bottom" />;
}
