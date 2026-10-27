"""One place that talks to Meta Model API (or the offline mock).

Every agent calls through `LLM`, so every call is:
  - refused up front if its worst-case cost could break the hard budget (budget.py)
  - capped with max_output_tokens, so its worst case is known before it runs
  - timed and logged to `model_calls` with tokens, cached tokens and recorded cost
"""

from __future__ import annotations

import asyncio
import base64
import contextvars
import json
import logging
import struct
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, TypeVar

import httpx
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from .budget import IMAGE_PRICE, SEARCH_PRICE, TRANSCRIBE_PER_HOUR, Budget, BudgetExceeded, token_cost, worst_case
from .config import Settings, get_settings
from .strict_schema import text_format

log = logging.getLogger("elsewhere.llm")

T = TypeVar("T", bound=BaseModel)

# Which simulation the current call belongs to (for call logging).
current_sim: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_sim", default=None)

# Server-side conversation state (previous_response_id) is billed as input but we can't see it;
# reserve this much extra input for such calls. Real cost is settled from usage afterwards.
PREVIOUS_CONTEXT_CHARS = 240_000

__all__ = ["LLM", "LLMError", "BudgetExceeded", "GroundingResult", "CallRecord", "current_sim"]


@dataclass
class CallRecord:
    simulation_id: str | None
    agent: str
    model: str
    provider: str  # "meta" | "mock"
    effort: str | None
    latency_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    ok: bool = True
    error: str | None = None
    searched: bool = False
    cost_usd: float = 0.0


@dataclass
class GroundingResult:
    text: str
    citations: list[dict[str, str]] = field(default_factory=list)
    searched: bool = False


CallSink = Callable[[CallRecord], Awaitable[None]]


class LLMError(RuntimeError):
    pass


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def _chars(*parts: Any) -> int:
    n = 0
    for p in parts:
        if p is None:
            continue
        n += len(p) if isinstance(p, str) else len(json.dumps(p, default=str))
    return n



MAX_SOURCES = 3


def _get(o: Any, key: str) -> Any:
    return o.get(key) if isinstance(o, dict) else getattr(o, key, None)


def parse_grounding(output: list[Any]) -> tuple[str, list[dict[str, str]], int]:
    """Read a web-search response: the final answer, its sources, and how many searches ran.

    Meta returns sources on the `web_search_call` items (`results`: title + url), and usually no
    `url_citation` annotations. Inline citations still win when present. Messages in the
    "commentary" phase ("I'll search the web for ...") are progress chatter, not the answer.
    """
    searches = 0
    results: list[dict[str, str]] = []
    cited: list[dict[str, str]] = []
    answer: list[str] = []
    chatter: list[str] = []
    for o in output:
        kind = _get(o, "type")
        if kind == "web_search_call":
            searches += 1
            for r in _get(o, "results") or []:
                url = _get(r, "url")
                if url:
                    results.append({"url": url, "title": _get(r, "title") or url})
        elif kind == "message":
            parts = [p for p in (_get(o, "content") or []) if _get(p, "type") == "output_text"]
            (chatter if _get(o, "phase") == "commentary" else answer).extend((_get(p, "text") or "") for p in parts)
            for p in parts:
                for ann in _get(p, "annotations") or []:
                    if _get(ann, "type") == "url_citation" and _get(ann, "url"):
                        cited.append({"url": _get(ann, "url"), "title": _get(ann, "title") or _get(ann, "url")})
    text = " ".join(t.strip() for t in (answer or chatter) if t.strip()).replace("**", "")  # no markdown in evidence
    if not cited and results:
        # Put sources the answer names first (e.g. "according to Apartment List" -> apartmentlist.com).
        squashed = "".join(ch for ch in text.lower() if ch.isalnum())
        def named(c: dict[str, str]) -> bool:
            host = c["url"].split("//")[-1].split("/")[0].lower().removeprefix("www.")
            return host.split(".")[0] in squashed
        cited = sorted(results, key=lambda c: not named(c))
    seen: set[str] = set()
    citations = []
    for c in cited:
        key = c["url"].lower()
        if key not in seen:
            seen.add(key)
            citations.append(c)
    return text, citations[:MAX_SOURCES], searches


class LLM:
    def __init__(self, settings: Settings | None = None, sink: CallSink | None = None, budget: Budget | None = None):
        self.s = settings or get_settings()
        self.live = self.s.live
        self.sink = sink
        self.budget = budget or Budget(self.s.budget_usd, self.s.budget_safety_factor)
        self.client: AsyncOpenAI | None = None
        if self.live:
            self.client = AsyncOpenAI(
                base_url=self.s.model_base_url,
                api_key=self.s.model_api_key,
                timeout=httpx.Timeout(180, connect=10),
                max_retries=0,  # retries would be unbudgeted spend; we retry explicitly instead
            )

    @property
    def mode(self) -> str:
        return "live" if self.live else "mock"

    async def _log(self, rec: CallRecord) -> None:
        if self.sink:
            try:
                await self.sink(rec)
            except Exception:  # logging must never break a simulation
                log.exception("call sink failed")

    @staticmethod
    def _usage(resp: Any) -> tuple[int, int, int]:
        u = getattr(resp, "usage", None)
        if not u:
            return 0, 0, 0
        details = getattr(u, "input_tokens_details", None)
        cached = getattr(details, "cached_tokens", 0) if details else 0
        return getattr(u, "input_tokens", 0) or 0, getattr(u, "output_tokens", 0) or 0, cached or 0

    async def _settle(self, reserved: float, model: str, it: int, ot: int, ct: int, extra: float = 0.0,
                      failed: bool = False) -> float:
        if failed:
            # We can't know whether a failed request was billed: record the whole reservation.
            return await self.budget.settle(reserved, reserved / self.budget.safety)
        return await self.budget.settle(reserved, token_cost(model, it, ct, ot) + extra)

    # ------------------------------------------------------------ structured

    async def structured(
        self,
        *,
        agent: str,
        model: str,
        instructions: str,
        input: str | list[dict[str, Any]],
        schema: type[T],
        effort: str = "medium",
        cache_key: str | None = None,
        mock: Callable[[], T],
        previous_response_id: str | None = None,
        max_output_tokens: int = 6000,
    ) -> T:
        t0 = time.perf_counter()
        if not self.live:
            await asyncio.sleep(0.15)
            out = mock()
            await self._log(CallRecord(current_sim.get(), agent, model, "mock", effort, _ms(t0)))
            return out

        assert self.client
        fmt = text_format(schema)
        last_err: str | None = None
        for attempt in range(2):
            msg_input = input
            if last_err:
                fix = f"\n\nYour previous output failed validation: {last_err[:800]}. Return valid JSON for the schema."
                msg_input = (input + fix) if isinstance(input, str) else [*input, {"role": "user", "content": fix}]
            est_chars = _chars(instructions, msg_input, fmt) + (PREVIOUS_CONTEXT_CHARS if previous_response_id else 0)
            reserved = await self.budget.reserve(worst_case(model, est_chars, max_output_tokens), agent)
            t1 = time.perf_counter()
            try:
                kwargs: dict[str, Any] = dict(
                    model=model, instructions=instructions, input=msg_input, text=fmt,
                    reasoning={"effort": effort}, max_output_tokens=max_output_tokens,
                )
                if cache_key:
                    kwargs["prompt_cache_key"] = cache_key
                if previous_response_id:
                    kwargs["previous_response_id"] = previous_response_id
                resp = await self.client.responses.create(**kwargs)
            except Exception as e:  # network, 4xx, 5xx
                cost = await self._settle(reserved, model, 0, 0, 0, failed=True)
                await self._log(CallRecord(current_sim.get(), agent, model, "meta", effort, _ms(t1), ok=False, error=str(e)[:500], cost_usd=cost))
                raise LLMError(f"{agent}: {e}") from e
            it, ot, ct = self._usage(resp)
            cost = await self._settle(reserved, model, it, ot, ct)
            try:
                parsed = schema.model_validate_json(resp.output_text)
            except ValidationError as e:
                last_err = str(e)
                await self._log(CallRecord(current_sim.get(), agent, model, "meta", effort, _ms(t1), it, ot, ct, ok=False, error="schema validation", cost_usd=cost))
                log.warning("%s: schema validation failed (attempt %s)", agent, attempt + 1)
                continue
            await self._log(CallRecord(current_sim.get(), agent, model, "meta", effort, _ms(t1), it, ot, ct, cost_usd=cost))
            return parsed
        raise LLMError(f"{agent}: output never matched schema")

    # ------------------------------------------------------------ tool loop

    async def tool_loop(
        self,
        *,
        agent: str,
        model: str,
        instructions: str,
        input: str,
        tools: list[dict[str, Any]],
        run_tool: Callable[[str, dict[str, Any]], Awaitable[Any]],
        effort: str = "high",
        max_rounds: int = 3,
        max_output_tokens: int = 12000,
        mock_calls: Callable[[], list[tuple[str, dict[str, Any]]]],
    ) -> str | None:
        """Let the model call our function tools (in parallel) until it stops.

        Returns the last response id so a follow-up structured call can continue
        the same conversation (previous_response_id). Mock mode runs the scripted
        tool calls in one parallel round.
        """
        if not self.live:
            t0 = time.perf_counter()
            calls = mock_calls()
            await self._log(CallRecord(current_sim.get(), agent, model, "mock", effort, _ms(t0) + 120))
            await asyncio.gather(*(run_tool(n, a) for n, a in calls))
            return None

        assert self.client
        prev_id: str | None = None
        next_input: Any = input
        context_chars = _chars(instructions, tools)
        for _ in range(max_rounds):
            context_chars += _chars(next_input)
            reserved = await self.budget.reserve(worst_case(model, context_chars, max_output_tokens), agent)
            t0 = time.perf_counter()
            kwargs: dict[str, Any] = dict(
                model=model, instructions=instructions, input=next_input, tools=tools, parallel_tool_calls=True,
                reasoning={"effort": effort}, max_output_tokens=max_output_tokens,
            )
            if prev_id:
                kwargs["previous_response_id"] = prev_id
            try:
                resp = await self.client.responses.create(**kwargs)
            except Exception as e:
                cost = await self._settle(reserved, model, 0, 0, 0, failed=True)
                await self._log(CallRecord(current_sim.get(), agent, model, "meta", effort, _ms(t0), ok=False, error=str(e)[:500], cost_usd=cost))
                raise LLMError(f"{agent}: {e}") from e
            it, ot, ct = self._usage(resp)
            cost = await self._settle(reserved, model, it, ot, ct)
            await self._log(CallRecord(current_sim.get(), agent, model, "meta", effort, _ms(t0), it, ot, ct, cost_usd=cost))
            context_chars += ot * 4
            prev_id = resp.id
            calls = [o for o in resp.output if getattr(o, "type", None) == "function_call"]
            if not calls:
                break

            async def run_one(c: Any) -> dict[str, Any]:
                try:
                    args = json.loads(c.arguments or "{}")
                    result = await run_tool(c.name, args)
                except BudgetExceeded:
                    raise
                except Exception as e:  # tool failure goes back to the model as data
                    log.exception("tool %s failed", c.name)
                    result = {"error": str(e)[:300]}
                return {"type": "function_call_output", "call_id": c.call_id, "output": json.dumps(result, default=str)}

            next_input = await asyncio.gather(*(run_one(c) for c in calls))
        return prev_id

    # ------------------------------------------------------------ grounding

    async def ground(self, *, agent: str, question: str, mock: Callable[[], GroundingResult], max_searches: int = 3) -> GroundingResult:
        t0 = time.perf_counter()
        model = self.s.specialist_model
        if not self.live:
            await asyncio.sleep(0.1)
            r = mock()
            await self._log(CallRecord(current_sim.get(), agent, model, "mock", "low", _ms(t0), searched=r.searched))
            return r
        assert self.client
        instructions = (
            "Answer the single factual question using web search. Reply in at most two sentences. "
            "Give a number or a short range when the question asks for one, with its unit and the year it refers to."
        )
        # Search results are fed back in as input, so reserve generously for them.
        reserved = await self.budget.reserve(worst_case(model, _chars(instructions, question) + 60_000, 2000, searches=max_searches), agent)
        try:
            resp = await self.client.responses.create(
                model=model, instructions=instructions, input=question,
                tools=[{"type": "web_search", "search_context_size": "low"}],
                include=["web_search_call.results"], reasoning={"effort": "low"},
                max_output_tokens=2000, max_tool_calls=max_searches,
            )
        except Exception as e:
            cost = await self._settle(reserved, model, 0, 0, 0, failed=True)
            await self._log(CallRecord(current_sim.get(), agent, model, "meta", "low", _ms(t0), ok=False, error=str(e)[:500], cost_usd=cost))
            raise LLMError(f"{agent}: {e}") from e
        text, citations, searches = parse_grounding(resp.output)
        it, ot, ct = self._usage(resp)
        cost = await self._settle(reserved, model, it, ot, ct, extra=searches * SEARCH_PRICE)
        await self._log(CallRecord(current_sim.get(), agent, model, "meta", "low", _ms(t0), it, ot, ct, searched=searches > 0, cost_usd=cost))
        return GroundingResult(text=text, citations=citations, searched=searches > 0)

    # ------------------------------------------------------------ streaming text

    async def stream_text(
        self,
        *,
        agent: str,
        model: str,
        instructions: str,
        input: str,
        effort: str = "low",
        cache_key: str | None = None,
        mock: Callable[[], str],
        max_output_tokens: int = 1200,
    ) -> AsyncIterator[str]:
        t0 = time.perf_counter()
        if not self.live:
            text = mock()
            await asyncio.sleep(0.35)
            for i, word in enumerate(text.split(" ")):
                yield word if i == 0 else " " + word
                await asyncio.sleep(0.018)
            await self._log(CallRecord(current_sim.get(), agent, model, "mock", effort, _ms(t0)))
            return
        assert self.client
        reserved = await self.budget.reserve(worst_case(model, _chars(instructions, input), max_output_tokens), agent)
        kwargs: dict[str, Any] = dict(model=model, instructions=instructions, input=input, reasoning={"effort": effort},
                                      stream=True, max_output_tokens=max_output_tokens)
        if cache_key:
            kwargs["prompt_cache_key"] = cache_key
        usage: tuple[int, int, int] | None = None
        try:
            stream = await self.client.responses.create(**kwargs)
            async for ev in stream:
                et = getattr(ev, "type", "")
                if et == "response.output_text.delta":
                    yield ev.delta
                elif et in ("response.completed", "response.incomplete"):
                    usage = self._usage(ev.response)
                elif et == "response.failed":
                    raise LLMError(f"{agent}: response failed")
        except Exception as e:
            cost = await self._settle(reserved, model, 0, 0, 0, failed=True)
            await self._log(CallRecord(current_sim.get(), agent, model, "meta", effort, _ms(t0), ok=False, error=str(e)[:500], cost_usd=cost))
            raise e if isinstance(e, LLMError) else LLMError(f"{agent}: {e}") from e
        if usage is None:  # no usage reported: assume the worst
            cost = await self._settle(reserved, model, 0, 0, 0, failed=True)
            await self._log(CallRecord(current_sim.get(), agent, model, "meta", effort, _ms(t0), cost_usd=cost))
            return
        cost = await self._settle(reserved, model, *(usage[0], usage[1], usage[2]))
        await self._log(CallRecord(current_sim.get(), agent, model, "meta", effort, _ms(t0), *usage, cost_usd=cost))

    # ------------------------------------------------------------ image + voice

    async def image(self, *, prompt: str, size: str = "1536x1024", mock: Callable[[], tuple[bytes, str]]) -> tuple[bytes, str]:
        t0 = time.perf_counter()
        if not self.live:
            data = mock()
            await self._log(CallRecord(current_sim.get(), "postcard", self.s.image_model, "mock", None, _ms(t0)))
            return data
        assert self.client
        reserved = await self.budget.reserve(IMAGE_PRICE, "postcard")
        try:
            resp = await self.client.images.generate(
                model=self.s.image_model, prompt=prompt, size=size, n=1,
                extra_body={"output_format": "webp", "reasoning_strength": "low"},
            )
        except Exception as e:
            cost = await self.budget.settle(reserved, IMAGE_PRICE)  # conservative even though failures aren't billed
            await self._log(CallRecord(current_sim.get(), "postcard", self.s.image_model, "meta", None, _ms(t0), ok=False, error=str(e)[:500], cost_usd=cost))
            raise LLMError(f"postcard: {e}") from e
        cost = await self.budget.settle(reserved, IMAGE_PRICE * max(1, len(resp.data)))
        await self._log(CallRecord(current_sim.get(), "postcard", self.s.image_model, "meta", None, _ms(t0), cost_usd=cost))
        return base64.b64decode(resp.data[0].b64_json), "image/webp"

    @staticmethod
    def wav_seconds(wav: bytes) -> float:
        try:
            rate = struct.unpack_from("<I", wav, 24)[0]
            channels = struct.unpack_from("<H", wav, 22)[0]
            bits = struct.unpack_from("<H", wav, 34)[0]
            return max(0.0, (len(wav) - 44) / (rate * channels * bits / 8))
        except Exception:
            return 600.0  # unknown: assume the 10-minute maximum

    async def transcribe(self, *, wav: bytes, keywords: list[str], mock: Callable[[], str]) -> str:
        t0 = time.perf_counter()
        if not self.live:
            await asyncio.sleep(0.4)
            await self._log(CallRecord(current_sim.get(), "voice_intake", self.s.transcribe_model, "mock", None, _ms(t0)))
            return mock()
        cost_est = (self.wav_seconds(wav) + 1) / 3600 * TRANSCRIBE_PER_HOUR
        reserved = await self.budget.reserve(cost_est, "voice_intake")
        req = {"mode": "PUSH_TO_TALK", "model": self.s.transcribe_model, "audioEncoding": "WAV", "keywords": keywords[:50]}
        try:
            async with httpx.AsyncClient(timeout=120) as http:
                r = await http.post(
                    f"{self.s.model_base_url}/asr/transcribe",
                    headers={"Authorization": f"Bearer {self.s.model_api_key}"},
                    files={"request": (None, json.dumps(req), "application/json"), "audio": ("intake.wav", wav, "audio/wav")},
                )
        except Exception as e:
            cost = await self.budget.settle(reserved, cost_est)
            await self._log(CallRecord(current_sim.get(), "voice_intake", self.s.transcribe_model, "meta", None, _ms(t0), ok=False, error=str(e)[:300], cost_usd=cost))
            raise LLMError(f"transcribe: {e}") from e
        ok = r.status_code < 400
        cost = await self.budget.settle(reserved, cost_est)
        await self._log(CallRecord(current_sim.get(), "voice_intake", self.s.transcribe_model, "meta", None, _ms(t0), ok=ok, error=None if ok else r.text[:500], cost_usd=cost))
        if not ok:
            raise LLMError(f"transcribe: {r.status_code} {r.text[:200]}")
        return r.json().get("transcript", "").strip()
