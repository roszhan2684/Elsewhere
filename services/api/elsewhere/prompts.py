"""Loads versioned agent instructions from packages/prompts/<version>/."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from .config import REPO_ROOT

PROMPTS_DIR = Path(os.environ.get("PROMPTS_DIR", REPO_ROOT / "packages" / "prompts" / "v1"))
PROMPT_VERSION = PROMPTS_DIR.name

DOMAIN_GUIDANCE = {
    "career": "Role, employment status, scope of responsibility, skills gained, professional network, and optionality (how many good next moves this world opens). Be specific to the role and company type.",
    "finance": "You only write finance.equity_value (paper value, liquidity, and the chance it ends at zero, as text). Code computes salary, savings and runway from the inputs you give: an all-in effective income tax rate for this city, a typical annual housing range for a one-bedroom, other annual living costs, and a typical yearly raise. If a grounded fact covers housing or tax, use it.",
    "lifestyle": "Weekly work hours (unit hours_per_week), stress, flexibility, social support, commute, and support network nearby. These are always inferences; keep confidence modest.",
    "risk": "Job security, reversibility (how easily the user could switch to the other kind of path later), and the main downside in this world.",
    "values": "Score how well this world serves each of the user's priorities on a 1-5 scale (unit score_1_5), with a short reason. Use the user's weights to decide what to emphasise.",
}


@lru_cache
def load(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text().strip()


def system(name: str, **fmt: str) -> str:
    body = load(name)
    if fmt:
        body = body.format(**fmt)
    return f"{load('_shared')}\n\n---\n\n{body}"
