# Meta Model API — build notes for Elsewhere

Read from dev.meta.ai/docs on **2026-10-21**. Re-check before kickoff; anything marked **TEST DAY 1** was unclear in the docs.

## Basics

| | |
|---|---|
| Base URL | `https://api.meta.ai/v1` |
| Auth | `Authorization: Bearer $MODEL_API_KEY` (server-side only — never ship it to web or iOS) |
| SDKs | OpenAI SDK and Anthropic SDK both work by changing `base_url` + key. Use the **OpenAI Python SDK** in FastAPI. |
| Main endpoint | `POST /v1/responses` (Responses API) |
| Also available | `/v1/chat/completions`, Messages API (Anthropic-style) |

**Use the Responses API everywhere.** Search grounding is *not* available on Chat Completions.

```python
from openai import OpenAI
client = OpenAI(base_url="https://api.meta.ai/v1", api_key=os.environ["MODEL_API_KEY"])
r = client.responses.create(model="muse-spark-1.3", input="...", reasoning={"effort": "low"})
print(r.output_text)
```

## Models we use

| Model ID | Elsewhere role | Price (per 1M tokens: in / cached in / out) |
|---|---|---|
| `muse-wonder-1.0` (preview) | Orchestrator: plan, delegate, reconcile; Shock Planner | $4.00 / $0.20 / $20.00 |
| `muse-spark-1.3` | Specialist agents, evidence resolver, consistency check, persona runtime | $1.25 / $0.15 / $4.25 |
| `muse-image-1.0` | Future Postcards | $0.01 per image |
| `muse-voice-transcribe-1.0` | Voice intake | $0.18 per audio hour |
| `web_search` tool | Grounding facts | $2.50 per 1,000 searches (plus tokens) |

- Context window: 1,048,576 tokens on Wonder and Spark.
- Wonder and Spark take identical requests, so switching is a one-line model ID change.
- Spark 1.3 audio understanding is "not fully supported"; we don't need it because voice goes through Transcribe.
- **Do not use `-contributor` models for user decisions.** They're about 10× cheaper, but Meta may train on the content. Personal life decisions shouldn't go there. They're fine only for generating synthetic seed data, and even then only if you're comfortable with that.

**Rate limits** (per team): Wonder and Spark get 3,000 RPM and 4M TPM; Image gets 150 RPM. That's plenty for a demo.

## Things that change the PDF plan

1. **The API has no "sub-agent" switch.** The docs say Wonder is good at delegating, but no request parameter does it for you. Build delegation as a tool loop:
   - Give Wonder function tools `run_specialist(domain, branch, task)` and `ground_fact(question)`.
   - Allow `parallel_tool_calls: true`. Our server runs each call on Spark at the same time (`asyncio.gather`) and returns the JSON results as `function_call_output`.
   - Wonder then reconciles and returns the final WorldState patch.
   - This keeps "Wonder delegates to Spark" true and visible in the loading screen.
2. **Muse Voice is speech-to-text only.** Meta has no text-to-speech, so future selves can't speak in Meta voices. Keep them text-only; that keeps the "Meta-native" story clean.
3. **Voice input must be WAV:** mono, 16-bit PCM, 16 kHz or 24 kHz, up to 10 minutes and 32 MB. Browsers record webm/opus by default, so:
   - Web: capture PCM with an AudioWorklet and encode the WAV in the browser (small helper), *or* convert with ffmpeg on the server.
   - iOS: `AVAudioRecorder` can write linear-PCM WAV at 16 kHz mono directly.
4. **Search may be skipped.** The model decides whether to search. Ask narrow, single-fact questions ("Current median 1-bedroom rent in San Francisco"). Check that a `web_search_call` item exists. If it doesn't, store the claim as INFERENCE, not FACT.

## Structured output

- Responses API: `text={"format": {"type": "json_schema", "name": "...", "schema": {...}, "strict": true}}`
- Chat Completions uses `response_format` instead. Don't mix them up.
- **Strict-mode rules** (otherwise HTTP 400):
  - The root must be an object.
  - No `oneOf` or `allOf`; `anyOf` is allowed below the root.
  - Every object needs `additionalProperties: false`.
  - Every property must be listed in `required`. For optional fields, use `anyOf: [{...}, {"type": "null"}]`.
- Limits: 10 levels of nesting, 5,000 properties, no recursive schemas. **The event log and evidence ledger must be flat arrays that link by ID, not nested trees.**
- Pydantic v2: by default it leaves optional fields out of `required`. Add a small `to_strict_schema()` helper that marks every field required and turns `Optional[X]` into `anyOf [X, null]`. Unit-test it on Day 1.
- **TEST DAY 1:** can one Responses call combine `tools` and `text.format`? The docs don't say. If not, run the tool loop first and then make one final formatting call.

## Streaming

`stream=True` on the Responses API emits events including `response.output_text.delta`, `response.function_call_arguments.delta`, `response.output_item.done` and `response.completed` / `response.failed`.

- Raw reasoning is never streamed, which matches our "show progress, not chain-of-thought" rule.
- Our FastAPI SSE stream should send *our own* events (`agent_started`, `agent_done`, `worldstate_ready`, `shock_diff`, `persona_delta`), not pass Meta's events through.

## Reasoning effort

The Responses API accepts `minimal | low | medium | high | xhigh`. The models page also mentions `max`. `none` returns HTTP 400.

Starting values, to tune by latency:

| Call | Model | Effort |
|---|---|---|
| Orchestrator plan / reconcile | Wonder | `high` |
| Shock Planner | Wonder | `medium` |
| Specialists | Spark | `medium` |
| Consistency check | Spark | `low` |
| Persona chat | Spark | `low` (target: first token under 5s) |

## Prompt caching

- Automatic prefix caching; there is nothing to turn on.
- Put the stable parts first: system prompt, schema, user profile, then the variable part.
- Set `prompt_cache_key` per role, for example `"elsewhere-specialist-v1"`. Never use per-user keys.
- On the Responses API, `prompt_cache_retention: "24h"` is a hint, not a guarantee.
- Check `usage.input_tokens_details.cached_tokens` and log it in the `model_calls` table.

## Images (Future Postcards)

- `client.images.generate(model="muse-image-1.0", prompt=..., size="1536x1024")`. `size` sets the aspect ratio only.
- Output defaults to b64 webp. Store it and serve it from our bucket.
- `reasoning_strength: "low"` is faster. Precompute postcards for the seeded demos.
- A `content_policy_violation` returns HTTP 400. Show a fallback card instead of an error.

## Rough cost per run (estimate — confirm on Day 1)

| Run | Cost |
|---|---|
| Full simulation (Wonder: about 30K in / 6K out; Spark: about 12 calls × 6K in / 2K out; 3 searches) | ≈ $0.45 |
| Shock recompute | ≈ $0.25 |
| Persona reply | under $0.01 |

A hundred judge sessions is well under $100. Still add a per-IP rate limit on `/demo` live calls.

## Day 1 smoke tests (run in this order)

1. Hello world on `muse-spark-1.3` and `muse-wonder-1.0`, logging latency.
2. Strict JSON schema with nullable fields.
3. Wonder with 2 function tools and parallel calls.
4. Tools + `text.format` in one call (see TEST DAY 1 above).
5. `web_search` call, then read the `url_citation` annotations.
6. A 30-second WAV through `/v1/asr/transcribe` with `keywords`.
7. One `muse-image-1.0` postcard.
8. Streaming a persona reply and measuring time to first token.
