"use client";

import clsx from "clsx";
import { useState } from "react";
import type { EvidenceItem, EvidenceKind, Simulation, WorldEvent } from "@/lib/types";
import { TIMEPOINTS, TP_LABEL, claimAt } from "@/lib/types";
import { Chip, KIND_HELP } from "./Chip";

const FIELD_LABEL: Record<string, string> = {
  "career.role": "role", "career.scope": "scope", "career.skills": "skills", "career.optionality": "options",
  "career.employment_status": "work status", "career.network": "network", "finance.salary": "pay",
  "finance.savings": "savings", "finance.runway_months": "runway", "finance.equity_value": "equity",
  "finance.housing_cost": "housing", "location.city": "city", "location.commute": "commute",
  "location.support_network": "people nearby", "lifestyle.work_hours": "hours", "lifestyle.stress": "stress",
  "lifestyle.flexibility": "flexibility", "lifestyle.social_support": "support", "risk.job_security": "job security",
  "risk.reversibility": "reversibility", "risk.downside": "downside",
};

export function origin(e: EvidenceItem): string {
  if (e.source === "user") return e.agent === "shock" ? "You — a shock you applied" : e.agent === "assumptions" ? "You — an assumption you changed" : "You, during intake";
  if (e.agent === "reference-library") return `Elsewhere's fact library · source checked ${e.citation?.retrieved_at ?? ""}`.trim();
  if (e.source === "web") return `Web search via ${e.model_id ?? "Muse Spark"}`;
  if (e.source === "engine") return "Calculated by Elsewhere's finance model (code, not a model)";
  const agent = e.agent === "evidence-resolver" ? "Evidence resolver" : e.agent === "consistency" ? "Consistency checker" : `${e.agent[0].toUpperCase()}${e.agent.slice(1)} agent`;
  return `Model inference · ${agent}${e.model_id ? ` (${e.model_id})` : ""}`;
}

export function EvidencePanel({ sim, selected, onSelect }: { sim: Simulation; selected: string | null; onSelect: (ref: string | null) => void }) {
  const evidence = new Map(sim.evidence.map((e) => [e.id, e]));
  const events = new Map(sim.events.map((e) => [e.id, e]));
  const ev = selected ? evidence.get(selected) : undefined;
  const event = selected ? events.get(selected) : undefined;

  return (
    <aside aria-label="Evidence" className="flex flex-col gap-5 rounded-2xl border border-line bg-raised p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <span className="label-mono">Evidence</span>
        {selected && (
          <button type="button" onClick={() => onSelect(null)} className="text-[13px] text-muted hover:text-paper">
            Clear
          </button>
        )}
      </div>
      {ev ? <EvidenceDetail ev={ev} sim={sim} /> : event ? <EventDetail e={event} sim={sim} onSelect={onSelect} /> : (
        <p className="text-[14px] leading-relaxed text-soft">
          Click any tag — on a value, an event, or inside a future self’s answer — to see where it came from.
        </p>
      )}
      <div className="h-px bg-line" />
      <TrustSections sim={sim} selected={selected} onSelect={onSelect} />
    </aside>
  );
}

function EvidenceDetail({ ev, sim }: { ev: EvidenceItem; sim: Simulation }) {
  const usedIn: string[] = [];
  for (const b of ["A", "B"] as const) {
    const bw = sim.branches[b];
    if (!bw) continue;
    for (const tp of TIMEPOINTS) {
      const s = bw.snapshots.find((x) => x.timepoint === tp)!;
      for (const f of Object.keys(FIELD_LABEL)) {
        if (claimAt(s, f).evidence_id === ev.id) usedIn.push(`${b} · ${TP_LABEL[tp]} · ${FIELD_LABEL[f]}`);
      }
    }
  }
  const uniq = [...new Set(usedIn)];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Chip kind={ev.kind} />
        <span className="font-mono text-[11px] text-muted">{ev.id}</span>
      </div>
      <p className="font-display text-[20px] leading-snug">“{ev.text}”</p>
      <Field label="Where it came from">{origin(ev)}</Field>
      {ev.citation && (
        <Field label="Source">
          <a href={ev.citation.url} target="_blank" rel="noreferrer" className="break-words text-path-a underline underline-offset-4">
            {ev.citation.title}
          </a>
        </Field>
      )}
      <Field label="Confidence">{ev.confidence[0].toUpperCase() + ev.confidence.slice(1)}</Field>
      {uniq.length > 0 && (
        <Field label="Used for">
          <span className="text-[13px] leading-relaxed text-soft">{uniq.slice(0, 6).join(" · ")}{uniq.length > 6 ? ` · +${uniq.length - 6} more` : ""}</span>
        </Field>
      )}
      <p className="text-[13px] text-muted">{KIND_HELP[ev.kind]}</p>
    </div>
  );
}

function EventDetail({ e, sim, onSelect }: { e: WorldEvent; sim: Simulation; onSelect: (r: string) => void }) {
  const shock = sim.shocks.find((s) => e.caused_by.includes(s.id));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={clsx("rounded-[4px] px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em]", e.kind === "shock" ? "bg-shock text-ink" : "border border-line-2 text-soft")}>
          {e.kind === "shock" ? "Shock event" : e.kind === "user_edit" ? "Your edit" : "Turning point"}
        </span>
        <span className="font-mono text-[11px] text-muted">{e.id} · month {e.month}</span>
      </div>
      <p className="font-display text-[20px] leading-snug">{e.title}</p>
      {e.detail && <p className="text-[14px] leading-relaxed text-soft">{e.detail}</p>}
      {shock && <Field label="Caused by">{`Shock: ${shock.label}`}</Field>}
      {e.evidence_id && (
        <button type="button" onClick={() => onSelect(e.evidence_id!)} className="self-start text-[13px] text-path-a underline underline-offset-4">
          See the reasoning behind it
        </button>
      )}
      <p className="text-[13px] text-muted">Only Path {e.branch}’s future self can mention this event.</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-mono">{label}</span>
      <span className="text-[14px] leading-relaxed">{children}</span>
    </div>
  );
}

function TrustSections({ sim, selected, onSelect }: { sim: Simulation; selected: string | null; onSelect: (r: string) => void }) {
  const [open, setOpen] = useState<EvidenceKind | null>(null);
  const sections: { kind: EvidenceKind; title: string }[] = [
    { kind: "FACT", title: "What we know" },
    { kind: "ASSUMPTION", title: "What you assumed" },
    { kind: "INFERENCE", title: "What Elsewhere inferred" },
  ];
  return (
    <div className="flex flex-col gap-2">
      {sections.map(({ kind, title }) => {
        const items = sim.evidence.filter((e) => e.kind === kind);
        const isOpen = open === kind;
        return (
          <div key={kind} className="rounded-xl border border-line">
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : kind)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
              <span className="flex items-center gap-3">
                <Chip kind={kind} small />
                <span className="text-[15px]">{title}</span>
              </span>
              <span className="font-mono text-[12px] text-muted">{items.length}</span>
            </button>
            {isOpen && (
              <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto border-t border-line px-2 py-2">
                {items.length === 0 && <li className="px-2 py-1.5 text-[13px] text-muted">{kind === "FACT" ? "No web-grounded facts in this run." : "None."}</li>}
                {items.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => onSelect(e.id)}
                      className={clsx("w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-snug text-paper-2 hover:bg-raised-2", selected === e.id && "bg-raised-2")}>
                      <span className="mr-2 font-mono text-[10px] text-muted">{e.id}</span>
                      {e.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
