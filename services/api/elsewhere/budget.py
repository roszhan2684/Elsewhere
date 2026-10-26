"""Hard spending cap for Meta Model API.

Meta's "spend limit" is only an email alert and the card is charged automatically, so the cap
lives here. Before every live call we reserve the call's worst-case cost (input estimate +
max_output_tokens at full price). If that could push total spend past BUDGET_USD, the call is
refused. After the call we record the real cost from the returned token counts, times a safety
factor, so the ledger always over-counts.

Prices: dev.meta.ai/docs/pricing-rate-limits (read 2026-10-26). USD per 1M tokens.
"""

from __future__ import annotations

import asyncio
import logging

log = logging.getLogger("elsewhere.budget")

# model: (input, cached_input, output) per 1M tokens
TOKEN_PRICES: dict[str, tuple[float, float, float]] = {
    "muse-wonder-1.0": (4.00, 0.20, 20.00),
    "muse-spark-1.3": (1.25, 0.15, 4.25),
    "muse-spark-1.2": (1.25, 0.15, 4.25),
    "muse-spark-1.1": (1.25, 0.15, 4.25),
    "muse-spark-1.3-contributor": (0.10, 0.002, 0.20),
    "muse-spark-1.2-contributor": (0.10, 0.002, 0.20),
}
IMAGE_PRICE = 0.01  # per generated image
TRANSCRIBE_PER_HOUR = 0.18
SEARCH_PRICE = 2.50 / 1000  # per web_search query
CHARS_PER_TOKEN = 3.0  # deliberately low (real text is ~4), so input estimates run high


class BudgetExceeded(RuntimeError):
    pass


def _prices(model: str) -> tuple[float, float, float]:
    if model not in TOKEN_PRICES:
        # Unknown model: assume the most expensive one rather than guess low.
        return TOKEN_PRICES["muse-wonder-1.0"]
    return TOKEN_PRICES[model]


def token_cost(model: str, input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    p_in, p_cached, p_out = _prices(model)
    uncached = max(0, input_tokens - cached_tokens)
    return (uncached * p_in + cached_tokens * p_cached + output_tokens * p_out) / 1_000_000


def worst_case(model: str, input_chars: int, max_output_tokens: int, searches: int = 0) -> float:
    p_in, _, p_out = _prices(model)
    return (input_chars / CHARS_PER_TOKEN * p_in + max_output_tokens * p_out) / 1_000_000 + searches * SEARCH_PRICE


class Budget:
    def __init__(self, limit_usd: float, safety: float = 1.15):
        self.limit = float(limit_usd)
        self.safety = float(safety)
        self.spent = 0.0
        self.reserved = 0.0
        self._lock = asyncio.Lock()

    def set_spent(self, spent: float) -> None:
        self.spent = float(spent)

    @property
    def remaining(self) -> float:
        return max(0.0, self.limit - self.spent - self.reserved)

    async def reserve(self, amount: float, what: str) -> float:
        amount = amount * self.safety
        async with self._lock:
            if self.spent + self.reserved + amount > self.limit:
                log.warning("budget: refused %s (needs up to $%.4f, remaining $%.4f)", what, amount, self.remaining)
                raise BudgetExceeded(
                    f"Live AI budget reached (${self.spent:.2f} of ${self.limit:.2f} used). Live model calls are paused."
                )
            self.reserved += amount
            return amount

    async def settle(self, reserved: float, actual: float) -> float:
        """Release the reservation and record the real cost (with the safety factor). Returns the recorded cost."""
        recorded = actual * self.safety
        async with self._lock:
            self.reserved = max(0.0, self.reserved - reserved)
            self.spent += recorded
        return recorded

    def snapshot(self) -> dict:
        return {
            "limit_usd": round(self.limit, 4),
            "spent_usd": round(self.spent, 4),
            "reserved_usd": round(self.reserved, 4),
            "remaining_usd": round(self.remaining, 4),
            "safety_factor": self.safety,
        }
