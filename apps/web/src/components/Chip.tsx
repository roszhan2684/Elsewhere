import clsx from "clsx";
import type { EvidenceKind } from "@/lib/types";

/** FACT solid · ASSUMPTION outlined · INFERENCE dashed — told apart by shape, not color. */
export function Chip({
  kind,
  onClick,
  selected,
  small,
  label,
  light,
}: {
  kind: EvidenceKind;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
  label?: string;
  light?: boolean;
}) {
  const cls = clsx(
    "inline-flex items-center font-mono uppercase tracking-[0.08em] rounded-[4px] leading-none whitespace-nowrap align-middle",
    small ? "text-[9px] px-[5px] py-[4px]" : "text-[10px] px-[6px] py-[5px]",
    light
      ? kind === "FACT"
        ? "bg-[#16161a] text-newsprint"
        : kind === "ASSUMPTION"
          ? "border border-[#16161a] text-[#16161a]"
          : "border border-dashed border-[#4a4a52] text-[#34343a]"
      : kind === "FACT"
        ? "bg-paper text-ink"
        : kind === "ASSUMPTION"
          ? "border border-paper text-paper"
          : "border border-dashed border-muted text-[#c9c6be]",
    selected && "ring-2 ring-path-a ring-offset-1 ring-offset-ink",
    onClick && "cursor-pointer hover:brightness-125 transition",
  );
  const text = label ?? kind;
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label={`Show evidence: ${kind.toLowerCase()}`}>
        {text}
      </button>
    );
  }
  return <span className={cls}>{text}</span>;
}

export const KIND_HELP: Record<EvidenceKind, string> = {
  FACT: "From a cited source: a live web search or Elsewhere's library of checked public figures.",
  ASSUMPTION: "You said it, or you chose it. You can change it.",
  INFERENCE: "Reasoned by the models or calculated by Elsewhere.",
};
