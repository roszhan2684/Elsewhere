// What kind of life a path is. Drives the base rates in 1,000 Futures, Life Roulette and the
// door-closing meter. Plain keyword rules over what the user said, so it's predictable.

import type { PathSpec } from "./types";

export type PathKind = "startup" | "stable" | "school" | "own" | "gig" | "migrant" | "hourly" | "care";

export function pathKind(p: PathSpec): PathKind {
  const t = `${p.label} ${p.role ?? ""} ${p.notes}`.toLowerCase();
  if (p.org_type === "school") return "school";
  if (p.org_type === "startup") return "startup";
  if (/dubai|gulf|saudi|qatar|kuwait|oman|bahrain|abroad|overseas|recruit/.test(t)) return "migrant";
  if (/uber|lyft|rideshare|ride-share|doordash|delivery driver|instacart|\bgig\b/.test(t)) return "gig";
  if (/nursing assistant|\bcna\b|caregiv|home health/.test(t)) return "care";
  if (/warehouse|retail|electrician|construction|factory|hourly|shift work|cashier/.test(t)) return "hourly";
  if (p.org_type === "self_employed") return "own";
  return "stable";
}

export const KIND_LABEL: Record<PathKind, string> = {
  startup: "startup job",
  stable: "stable job",
  school: "studying",
  own: "own business",
  gig: "gig work",
  migrant: "work abroad",
  hourly: "hourly job",
  care: "care work",
};
