# WorldState — written spec

This is the contract every screen reads from. It's written as a doc now; turn it into Pydantic models on Day 1 (`packages/contracts`). The shapes below are TypeScript-style for readability.

## Core idea

Each branch (A or B) is a list of **snapshots**, one per timepoint, plus three flat logs shared across snapshots:
- **evidence** — where each claim came from
- **events** — what happened in this branch
- **diffs** — what each shock changed

Nothing is nested more than 4 levels deep, so the schema stays within Meta's strict-mode limits (10 levels, no recursion).

```ts
type Branch = "A" | "B";
type Timepoint = "m0" | "m6" | "m24" | "m60";      // now, 6 months, 2 years, 5 years
type Confidence = "high" | "medium" | "low";
type EvidenceKind = "FACT" | "ASSUMPTION" | "INFERENCE";

// A number we never state as exact
interface Range { low: number; high: number; unit: "usd" | "usd_per_year" | "months" | "hours_per_week" | "score_1_5"; }

// Every material value points to its evidence
interface Claim<T> {
  value: T | null;          // null = unknown (never invent)
  range: Range | null;      // numbers use ranges
  evidence_id: string;      // → EvidenceItem.id
  status: "known" | "unknown" | "needs_user";
}
```

## WorldState (one snapshot)

```ts
interface WorldState {
  simulation_id: string;
  branch: Branch;
  version: number;                 // bumps on every shock or edit
  parent_version: number | null;
  timepoint: Timepoint;

  identity: {                      // user-provided only, never inferred
    age_band: Claim<string>;
    profession: Claim<string>;
    goals: Claim<string>[];
  };
  decision: {                      // immutable root, same in A and B
    path_a: string; path_b: string; chosen: Branch; decided_on: string;
  };
  career: {
    role: Claim<string>;
    employment_status: Claim<"employed" | "searching" | "founder" | "studying">;
    scope: Claim<string>;
    skills_gained: Claim<string>[];
    network: Claim<string>;
    optionality: Claim<Confidence>;
  };
  finance: {
    salary: Claim<number>;          // usd_per_year
    equity_value: Claim<number>;
    housing_cost: Claim<number>;
    savings: Claim<number>;         // cumulative at this timepoint
    runway_months: Claim<number>;
  };
  location: {
    city: Claim<string>;
    commute: Claim<string>;
    relocation_cost: Claim<number>;
    near_support_network: Claim<boolean>;
  };
  lifestyle: {                     // always INFERENCE
    work_hours: Claim<number>;
    stress: Claim<Confidence>;
    flexibility: Claim<Confidence>;
    social_support: Claim<Confidence>;
  };
  risk: {
    job_loss: Claim<Confidence>;
    reversibility: Claim<Confidence>;
    downside: Claim<string>;
  };
  values_fit: {                    // user weights 1–5, scored per branch
    learning: Claim<number>; stability: Claim<number>; ownership: Claim<number>;
    location: Claim<number>; autonomy: Claim<number>;
  };
  event_ids: string[];             // events that happened up to this timepoint
}
```

## Flat logs

```ts
interface EvidenceItem {
  id: string;                      // "ev_0042"
  kind: EvidenceKind;
  source: "user" | "web" | "model";
  agent: "intake" | "career" | "finance" | "lifestyle" | "risk" | "values" | "evidence" | "orchestrator" | "shock";
  model_id: string | null;         // "muse-spark-1.3"
  text: string;                    // the claim in plain words
  citation: { url: string; title: string; retrieved_at: string } | null;   // required when kind = FACT
  confidence: Confidence;
  created_at: string;
}

interface WorldEvent {
  id: string;                      // "E-A-014" — branch letter is part of the id
  branch: Branch;
  month: number;
  kind: "turning_point" | "shock" | "user_edit";
  title: string;                   // "Company closes"
  caused_by: string[];             // other event ids or shock id
  evidence_id: string;
}

interface FieldChange {
  field: string;                   // "finance.savings@m24"
  before: string; after: string;   // serialized Claim summaries
  because: string[];               // chain: shock id → event ids → upstream fields
}

interface ShockDiff {
  shock_id: string;
  label: string;                   // "Startup fails at month 14"
  applies_to: Branch[];            // B can be untouched — show "unchanged" with why
  changes: FieldChange[];
  from_version: number; to_version: number;
}

interface PersonaMessage {
  id: string; branch: Branch | "both"; role: "user" | "future_a" | "future_b";
  text: string;
  claims: { start: number; end: number; evidence_id: string }[];   // drives inline chips
  guard_rewrites: number;          // branch-guard edits before sending
}
```

## How a shock knows what to change

A fixed dependency map in code. The model doesn't decide what depends on what.

```
career.employment_status → finance.salary, finance.runway_months, lifestyle.stress
finance.salary           → finance.savings
finance.housing_cost     → finance.savings
finance.equity_value     → finance.savings (only on liquidity)
location.city            → finance.housing_cost, location.near_support_network
```

The Shock Planner (Wonder) picks the **entry fields** and new events. Code walks the map to find every downstream field. Spark agents recompute only those fields. Finance numbers are then recomputed **deterministically in code** from salary, housing, gap months and time. That same code powers the "What decides this?" chart (idea 4).

## Invariants (checked before a branch can render)

| # | Rule | Checked by |
|---|---|---|
| 1 | A persona message may only cite events whose id starts with its own branch letter | code (regex on ids) + branch guard |
| 2 | `savings` at each timepoint ≈ previous + (salary − costs) × months, within tolerance | code |
| 3 | Events are in month order and every `caused_by` exists earlier | code |
| 4 | Every FACT has a citation; every web claim without a `web_search_call` becomes INFERENCE | code |
| 5 | Every FieldChange has a non-empty `because` that starts at the shock | code |
| 6 | Unknown values stay `null` + `needs_user`, never filled in | code + consistency agent |
| 7 | Identity fields only come from `source: "user"` | code |
| 8 | Narrative coherence (does the story make sense?) | Spark consistency agent |

Code checks are cheap and deterministic, so they run on every write. The model check (8) runs once per simulation and once per shock.

## Specialist agent output (strict JSON)

From the plan, adjusted for strict mode (all fields required, `null` allowed):

```ts
interface SpecialistOutput {
  domain: "career" | "finance" | "lifestyle" | "risk" | "values";
  branch: Branch;
  summary: string;
  field_patches: { field: string; value: string | null; range: Range | null; evidence_index: number }[];
  evidence: { kind: EvidenceKind; text: string; confidence: Confidence }[];
  events: { month: number; title: string; caused_by: string[] }[];
  risks: string[];
  opportunities: string[];
  confidence: Confidence;
  unresolved_questions: string[];
}
```

`value` is always a string in the patch. Code parses it against the target field's type, which keeps the schema small and avoids `anyOf` explosions.

## Database tables (from the plan, mapped)

`simulation_runs` · `world_state_versions` (JSONB snapshot per branch × timepoint × version) · `evidence_items` · `timeline_events` · `shocks` · `shock_diffs` · `persona_messages` · `generated_assets` · `model_calls` (model, effort, latency, tokens, cached_tokens).
