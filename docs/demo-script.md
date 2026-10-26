# Demo script

## 3-minute judging video (official rule: 3 minutes, show what was built during the hackathon)

Judging weights: Impact 30% · Use of Meta tooling 25% · Demo 25% · Technical depth 20%. Show the product first and the architecture last. Record at 1440×900 with Screen Studio.

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:15 | Landing. Scroll: the line splits into two future selves. | "Big decisions are hard because we can't see what they set in motion. I've been stuck on exactly this one." |
| 0:15–0:35 | /new → mic → say the startup-vs-Seattle decision → transcript → "Here's what I heard" (≤3 questions). | "Muse Voice transcribes it, and a Spark intake agent asks only what changes the simulation most." |
| 0:35–0:55 | Loading: Wonder plans, 10 Spark agents + web grounding tick to DONE, both branches grow. | "Muse Wonder plans two worlds and delegates to ten Muse Spark specialists in parallel, with function tools." |
| 0:55–1:20 | Workspace. Scrub Now → 6 months → 2 years → 5 years. Click a FACT chip → citation. | "Each world is structured state, not an essay. Every value is labeled: fact, assumption, or inference." |
| 1:20–1:50 | Debate: "What do you regret?" A answers, B pushes back, A replies. Show the branch-guard note if it fires. | "Both future selves answer, but each only knows its own world. A sentence-level guard blocks anything from the other branch." |
| 1:50–2:20 | Stress test: "Startup fails at month 14". Red pulse, agents recompute, front pages: A rewritten, B "unchanged". Verdict. | "Wonder plans where the shock enters; code walks the dependency graph; Spark recomputes only what changed, after month 14." |
| 2:20–2:35 | What decides this? Drag job-search length; the bars re-sort instantly. | "The money math is deterministic code, so you can see which assumption decides the outcome." |
| 2:35–2:50 | Postcards (Muse Image), then Under the hood: checks + model-call table. | "Muse Image paints each life. Under the hood: every check, every Meta model call, cached tokens included." |
| 2:50–3:00 | Logo + live URL + "Built during the Meta Global AI Developer Hackathon". | "Don't predict the future. Explore it." |

**Recording rules**
- Record against live models (MODEL_API_KEY set), never the offline mock.
- Keep loading visible (speed up 2× if needed): judges should see the agents work.

## Live judge path (`/demo`, no login)

1. `/demo` opens straight into the fork for **Startup SF vs Stable Seattle**. Everything is precomputed and paints in under 2 seconds.
2. A banner offers two live actions, each labeled "runs live on Meta models":
   - **Ask both futures a question** (live Spark persona calls, streamed)
   - **Apply a shock** (live Wonder shock plan + Spark recompute)
3. The scenario menu has two more seeded decisions:

| Scenario | Shock |
|---|---|
| Startup SF vs Stable Seattle | Startup fails after 14 months |
| Graduate school vs full-time role | Scholarship appears after 6 months |
| Start a product vs stay employed | First 1,000 users arrive faster than expected |

**Fallbacks**
- If a live call fails or takes more than 20 seconds, show the precomputed version of that same shock or answer, with a small note: "Showing a saved run — live models are busy."
- Never show a raw error to a judge.

## 20-second clip for X (Most Viral bonus prize: post on X, submit the link) (after the main video is locked)

Fork split → debate exchange (2 lines) → shock pulse + headline rewrite → tagline. No architecture, no narration over 25 words.

## Submission text (from the plan, ready to paste)

> Elsewhere is a counterfactual decision simulator that creates two persistent future worlds from one life choice. Muse Wonder orchestrates long-horizon simulation and delegates to Muse Spark specialist agents for career, finances, lifestyle, values and risk. You can meet both future selves, stress-test them with unexpected events, and inspect which claims are grounded facts, your assumptions, or AI inference. Muse Voice enables natural decision intake, and Muse Image turns each branch into a Future Postcard. Elsewhere does not predict the future — it makes uncertainty explorable.
