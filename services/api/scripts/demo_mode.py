"""Hard stop: switch Elsewhere to demo mode for good. No Meta API calls after this.

    python -m scripts.demo_mode

Creates services/api/LIVE_LOCKED (every process refuses live calls while it exists, including
ones already running), sets services/api/.env to MODEL_MODE=mock and BUDGET_USD=0, and prints
the final spend. Restart the API server afterwards so /health reports mock.
"""

import asyncio
import re

from elsewhere.budget import LIVE_LOCK, lock_live
from elsewhere.config import API_ROOT, get_settings
from elsewhere.store import Store


async def main() -> None:
    lock_live("demo mode: testing done and demos regenerated")
    env = API_ROOT / ".env"
    text = env.read_text() if env.exists() else ""
    for key, value in (("MODEL_MODE", "mock"), ("BUDGET_USD", "0")):
        if re.search(rf"^{key}=", text, flags=re.M):
            text = re.sub(rf"^{key}=.*$", f"{key}={value}", text, flags=re.M)
        else:
            text += f"\n{key}={value}\n"
    env.write_text(text)
    store = Store(get_settings().database_url)
    await store.init()
    spent = await store.total_cost()
    print(f"Demo mode on. Lock: {LIVE_LOCK}")
    print(f"Recorded Meta spend, all time: ${spent:.2f} (includes a 15% safety margin; real spend is about ${spent / 1.15:.2f})")


if __name__ == "__main__":
    asyncio.run(main())
