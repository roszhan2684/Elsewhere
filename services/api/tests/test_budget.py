"""The hard budget must refuse calls BEFORE they reach Meta, and must over-count, never under-count."""

import asyncio
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from elsewhere.budget import Budget, BudgetExceeded, token_cost, worst_case
from elsewhere.config import Settings
from elsewhere.llm import LLM


class Out(BaseModel):
    answer: str


class FakeResponses:
    def __init__(self):
        self.calls = 0

    async def create(self, **kw):
        self.calls += 1
        await asyncio.sleep(0.02)  # real calls overlap; reservations must hold while they're in flight
        assert kw["max_output_tokens"] > 0, "every live call must cap its output"
        return SimpleNamespace(
            id="r1", output=[], output_text='{"answer": "ok"}',
            usage=SimpleNamespace(input_tokens=2000, output_tokens=500, input_tokens_details=SimpleNamespace(cached_tokens=1000)),
        )


def live_llm(budget_usd: float) -> tuple[LLM, FakeResponses]:
    llm = LLM(Settings(model_mode="mock"), budget=Budget(budget_usd, 1.15))
    fake = FakeResponses()
    llm.live = True
    llm.client = SimpleNamespace(responses=fake)  # type: ignore[assignment]
    return llm, fake


def test_live_needs_explicit_opt_in():
    assert not Settings(model_mode="auto", model_api_key="k", budget_usd=50).live
    assert not Settings(model_mode="live", model_api_key="", budget_usd=50).live
    assert not Settings(model_mode="live", model_api_key="k", budget_usd=0).live
    assert Settings(model_mode="live", model_api_key="k", budget_usd=50).live


def test_cost_math():
    # 1000 uncached in, 1000 cached in, 500 out on Spark
    assert token_cost("muse-spark-1.3", 2000, 1000, 500) == pytest.approx((1000 * 1.25 + 1000 * 0.15 + 500 * 4.25) / 1e6)
    # unknown models are priced as the most expensive one
    assert worst_case("mystery", 3000, 1000) == worst_case("muse-wonder-1.0", 3000, 1000)


async def test_records_real_cost_with_margin():
    llm, fake = live_llm(1.0)
    out = await llm.structured(agent="t", model="muse-spark-1.3", instructions="x", input="y", schema=Out, mock=lambda: Out(answer="m"))
    assert out.answer == "ok" and fake.calls == 1
    assert llm.budget.spent == pytest.approx(token_cost("muse-spark-1.3", 2000, 1000, 500) * 1.15)
    assert llm.budget.reserved == 0


async def test_refuses_before_calling_meta():
    llm, fake = live_llm(0.01)  # one cent
    with pytest.raises(BudgetExceeded):
        # worst case for a Wonder call with 16K output tokens is ~$0.37, far above one cent
        await llm.structured(agent="t", model="muse-wonder-1.0", instructions="x", input="y", schema=Out,
                             mock=lambda: Out(answer="m"), max_output_tokens=16000)
    assert fake.calls == 0, "a refused call must never reach Meta"


async def test_parallel_calls_cannot_overshoot():
    llm, fake = live_llm(0.05)
    each = worst_case("muse-spark-1.3", 10, 6000) * 1.15  # ~ $0.03 reserved per call
    results = await asyncio.gather(*(llm.structured(agent=f"t{i}", model="muse-spark-1.3", instructions="x", input="y", schema=Out,
                                                    mock=lambda: Out(answer="m")) for i in range(5)), return_exceptions=True)
    refused = sum(isinstance(r, BudgetExceeded) for r in results)
    assert refused >= 3 and fake.calls == 5 - refused
    assert llm.budget.spent <= 0.05 and each > 0


def test_ceiling_beats_env():
    from elsewhere.budget import HARD_CEILING_USD
    assert Budget(500).limit == HARD_CEILING_USD == 10.0


async def test_reaching_ceiling_locks_live_for_good():
    from elsewhere import budget
    llm, fake = live_llm(500)  # env asks for $500; the ceiling still holds it to $10
    llm.budget.set_spent(9.99)
    with pytest.raises(BudgetExceeded):
        await llm.structured(agent="t", model="muse-wonder-1.0", instructions="x", input="y", schema=Out, mock=lambda: Out(answer="m"))
    assert fake.calls == 0 and budget.live_locked()
    assert not Settings(model_mode="live", model_api_key="k", budget_usd=5).live
    llm.budget.set_spent(0)  # even with money "left", the lock refuses
    with pytest.raises(BudgetExceeded):
        await llm.structured(agent="t", model="muse-spark-1.3", instructions="x", input="y", schema=Out, mock=lambda: Out(answer="m"))
    assert fake.calls == 0


async def test_sees_spend_from_other_processes():
    from elsewhere import budget
    llm, fake = live_llm(5)

    async def ledger() -> float:
        return 4.999  # another process already spent this

    budget.register_ledger(ledger)
    with pytest.raises(BudgetExceeded):
        await llm.structured(agent="t", model="muse-spark-1.3", instructions="x", input="y", schema=Out, mock=lambda: Out(answer="m"))
    assert fake.calls == 0


async def test_deleting_a_simulation_keeps_its_spend(tmp_path):
    from elsewhere.llm import CallRecord
    from elsewhere.store import Store
    store = Store(f"sqlite+aiosqlite:///{tmp_path}/ledger.db")
    await store.init()
    await store.log_call(CallRecord("sim1", "t", "muse-spark-1.3", "meta", "low", 10, cost_usd=1.25))
    await store.delete("sim1")
    assert await store.total_cost() == pytest.approx(1.25)
