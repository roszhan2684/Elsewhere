# Elsewhere — pre-hackathon docs

Planning docs written 2026-10-21, before the hackathon. The official rules (published Oct 26) require new work only, a public repo, and a 3-minute video, so these docs are planning only and all product code was written during the event.

| Doc | What's in it |
|---|---|
| [meta-api-notes.md](meta-api-notes.md) | Model IDs, prices, limits, gotchas, Day-1 smoke tests, and where the API changes the original plan |
| [worldstate-schema.md](worldstate-schema.md) | The WorldState contract, flat logs, shock dependency map, invariants, specialist output schema |
| [design-direction.md](design-direction.md) | Tokens, the Rive fork spec, ideas 1–4, inspiration list. Links to the design board. |
| [demo-script.md](demo-script.md) | 3-minute video beat sheet, live judge path, fallbacks, submission text |

## Before kickoff

- [ ] **Apply by Oct 25, 11:59 PM ET** (applications may close early at 20,000 spots)
- [ ] Get a `MODEL_API_KEY` at dev.meta.ai and confirm billing or credits
- [ ] Read the Official Rules as soon as they're posted. Check:
  - code written before the event
  - model attribution
  - repo visibility
  - video length
- [ ] Build `fork.riv` in Rive from the spec in design-direction.md (design asset — safe under any rules)
- [ ] Pick final fonts; export the favicon from the fork mark

## Day 1 (Oct 26), once the rules allow code

1. Monorepo scaffold as in the plan (`apps/web`, `apps/ios`, `services/api`, `packages/contracts`, …)
2. Run the smoke tests in meta-api-notes.md
3. Turn worldstate-schema.md into Pydantic models + a strict-schema helper
4. Deploy a landing shell with the fork motif
