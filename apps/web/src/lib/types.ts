// Mirrors services/api/elsewhere/contracts.py. Keep in sync (checked by `pnpm check:contracts`).

export type Branch = "A" | "B";
export type Timepoint = "m0" | "m6" | "m24" | "m60";
export const TIMEPOINTS: Timepoint[] = ["m0", "m6", "m24", "m60"];
export const TP_MONTHS: Record<Timepoint, number> = { m0: 0, m6: 6, m24: 24, m60: 60 };
export const TP_LABEL: Record<Timepoint, string> = { m0: "Now", m6: "6 months", m24: "2 years", m60: "5 years" };
export type Confidence = "high" | "medium" | "low";
export type EvidenceKind = "FACT" | "ASSUMPTION" | "INFERENCE";
export type Unit = "usd" | "usd_per_year" | "months" | "hours_per_week" | "score_1_5" | "none";

export interface PathSpec {
  label: string;
  city: string | null;
  role: string | null;
  org_type: "startup" | "established_company" | "school" | "self_employed" | "other";
  annual_pay_usd: number | null;
  equity: string | null;
  notes: string;
}

export interface DecisionSpec {
  title: string;
  question: string;
  path_a: PathSpec;
  path_b: PathSpec;
  priorities: Record<"learning" | "stability" | "ownership" | "location" | "autonomy", number>;
  goals: string[];
  fears: string[];
  constraints: string[];
  current: {
    city: string | null;
    profession: string | null;
    age_band: string | null;
    savings_usd: number | null;
    monthly_expenses_usd: number | null;
  };
  clarifying_questions: { id: string; text: string; why: string }[];
}

export interface Range {
  low: number;
  high: number;
  unit: Unit;
}

export interface Claim {
  text: string | null;
  range: Range | null;
  evidence_id: string | null;
  status: "known" | "unknown" | "needs_user";
}

export type Domain = "career" | "finance" | "location" | "lifestyle" | "risk" | "values_fit";

export interface Snapshot {
  timepoint: Timepoint;
  headline: string;
  career: Record<"role" | "employment_status" | "scope" | "skills" | "network" | "optionality", Claim>;
  finance: Record<"salary" | "equity_value" | "housing_cost" | "savings" | "runway_months", Claim>;
  location: Record<"city" | "commute" | "support_network", Claim>;
  lifestyle: Record<"work_hours" | "stress" | "flexibility" | "social_support", Claim>;
  risk: Record<"job_security" | "reversibility" | "downside", Claim>;
  values_fit: Record<"learning" | "stability" | "ownership" | "location" | "autonomy", Claim>;
  event_ids: string[];
}

export interface PaySegment {
  start_month: number;
  end_month: number | null;
  annual_pay: number;
  label: string;
}

export interface FinanceInputs {
  start_savings: number;
  annual_pay: number;
  effective_tax_rate: number;
  annual_housing_low: number;
  annual_housing_high: number;
  annual_other_costs: number;
  raise_pct_per_year: number;
  equity_note: string | null;
  pay_segments: PaySegment[];
  one_time_costs: { month: number; amount: number; label: string }[];
}

export interface BranchWorld {
  branch: Branch;
  label: string;
  summary: string;
  top_tradeoffs: string[];
  confidence: Confidence;
  persona: { name: string; voice: string; temperament: string };
  finance_inputs: FinanceInputs;
  snapshots: Snapshot[];
}

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  source: "user" | "web" | "model" | "engine";
  agent: string;
  model_id: string | null;
  text: string;
  citation: { url: string; title: string; retrieved_at: string } | null;
  confidence: Confidence;
  created_at: string;
}

export interface WorldEvent {
  id: string;
  branch: Branch;
  month: number;
  kind: "turning_point" | "shock" | "user_edit";
  title: string;
  detail: string;
  caused_by: string[];
  evidence_id: string | null;
  version: number;
}

export interface FieldChange {
  branch: Branch;
  timepoint: Timepoint;
  field: string;
  before: string;
  after: string;
  because: string[];
}

export interface FrontPage {
  branch: Branch;
  headline: string;
  deck: string;
  changed_because: string;
  unchanged: boolean;
}

export interface ShockRecord {
  id: string;
  label: string;
  description: string;
  month: number;
  applies_to: Branch[];
  not_applied_because: Record<string, string>;
  changes: FieldChange[];
  front_pages: FrontPage[];
  verdict: { more_robust: "A" | "B" | "tie"; why: string; dominant_assumption: string; confidence: Confidence } | null;
  from_version: number;
  to_version: number;
  created_at: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  repaired: number;
  detail: string;
}

export interface ThirdDoor {
  is_real_alternative: boolean;
  label: string;
  path: PathSpec;
  why_not_binary: string;
  borrows_from_a: string;
  borrows_from_b: string;
  gives_up: string;
  first_step: string;
  risks: string[];
  mode: "live" | "mock";
  created_at: string;
}

export interface Simulation {
  id: string;
  slug: string | null;
  mode: "live" | "mock";
  status: "draft" | "running" | "ready" | "failed";
  version: number;
  decision: DecisionSpec;
  branches: Record<Branch, BranchWorld>;
  evidence: EvidenceItem[];
  events: WorldEvent[];
  shocks: ShockRecord[];
  suggested_shocks: { label: string; description: string; month: number }[];
  checks: CheckResult[];
  comparison: { summary: string; dominant_assumptions: string[]; what_would_change_my_mind: string[] } | null;
  third_door?: ThirdDoor | null;
  derived_from?: string | null;
  created_at: string;
}

export interface Tally {
  A: number;
  B: number;
  total: number;
  mine: Branch | null;
  reasons: { choice: Branch; name: string; reason: string; created_at: string }[];
}

export interface PublicShare {
  share_id: string;
  mode: "live" | "mock";
  title: string;
  question: string;
  priorities: DecisionSpec["priorities"];
  goals: string[];
  third_door: string | null;
  branches: Record<Branch, { branch: Branch; label: string; summary: string; top_tradeoffs: string[]; confidence: Confidence; city: string | null; snapshots: Snapshot[] }>;
  votes: Tally;
}

export interface Checkin {
  id: string;
  month: number;
  took: Branch | "neither";
  savings_usd: number | null;
  annual_pay_usd: number | null;
  stress: number | null;
  hours_per_week: number | null;
  note: string;
  created_at?: string;
}

export interface ClaimSpan {
  start: number;
  end: number;
  ref: string;
}

export interface PersonaMessage {
  id: string;
  role: "user" | "future_a" | "future_b";
  text: string;
  claims: ClaimSpan[];
  guard_rewrites: number;
  timepoint: Timepoint;
  created_at: string;
}

export interface DemoBundle {
  slug: string;
  blurb: string;
  simulation: Simulation;
  precomputed_shock: { request: { label: string; description: string; month: number }; simulation: Simulation };
  messages: PersonaMessage[];
  postcards: Record<Branch, string>;
}

export interface AgentEvent {
  agent: string;
  branch: string;
  model: string;
  summary?: string;
}

export function snap(bw: BranchWorld, tp: Timepoint): Snapshot {
  return bw.snapshots.find((s) => s.timepoint === tp)!;
}

export function claimAt(s: Snapshot, path: string): Claim {
  const [d, f] = path.split(".") as [Domain, string];
  return (s[d] as Record<string, Claim>)[f];
}
