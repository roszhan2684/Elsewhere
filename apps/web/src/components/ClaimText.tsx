"use client";

import type { EvidenceItem, WorldEvent } from "@/lib/types";
import { Chip } from "./Chip";

const REF = /\s*\[(ev_[UABS]_\d{3}|E-[AB]-\d{3})\]/g;

/** Renders future-self text with its citation markers turned into clickable evidence chips. */
export function ClaimText({
  text,
  evidence,
  events,
  selected,
  onSelect,
}: {
  text: string;
  evidence: Map<string, EvidenceItem>;
  events: Map<string, WorldEvent>;
  selected?: string | null;
  onSelect: (ref: string) => void;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(REF)) {
    const ref = m[1];
    const before = text.slice(last, m.index);
    const kind = ref.startsWith("E-") ? "INFERENCE" : evidence.get(ref)?.kind ?? "INFERENCE";
    const isEvent = ref.startsWith("E-");
    parts.push(
      <span key={`t${i}`} className={selected === ref ? "rounded-sm bg-path-a/15" : undefined}>
        {before}
      </span>,
    );
    parts.push(
      <span key={`c${i}`} className="mx-1 inline-block align-[2px]">
        <Chip kind={kind} small label={isEvent ? `EVENT ${events.get(ref)?.month != null ? "M" + events.get(ref)!.month : ""}`.trim() : kind}
          selected={selected === ref} onClick={() => onSelect(ref)} />
      </span>,
    );
    last = m.index! + m[0].length;
    i++;
  }
  parts.push(<span key="end">{text.slice(last)}</span>);
  return <>{parts}</>;
}
