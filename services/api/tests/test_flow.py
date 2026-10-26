"""End-to-end flow against the real FastAPI app with the offline mock models."""

import asyncio
import json

import httpx
import pytest

from elsewhere.main import app, store
from elsewhere.mock_brain import CANONICAL


@pytest.fixture(scope="session")
async def client():
    await store.init()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:
        yield c


async def wait_for(sim_id: str, event: str, timeout: float = 30) -> dict:
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        for row in await store.events_after(sim_id, 0):
            if row.type == event:
                return row.data
            if row.type.endswith("_failed"):
                raise AssertionError(row.data)
        await asyncio.sleep(0.2)
    raise TimeoutError(event)


async def make_sim(client) -> str:
    r = await client.post("/v1/decisions", json={"text": CANONICAL})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["decision"]["path_a"]["city"] == "San Francisco"
    assert d["decision"]["path_b"]["annual_pay_usd"] == 180000
    sim_id = d["id"]
    r = await client.post(f"/v1/decisions/{sim_id}/simulate")
    assert r.status_code == 202
    await wait_for(sim_id, "simulation_ready")
    return sim_id


async def test_simulate_shock_chat(client):
    sim_id = await make_sim(client)
    sim = (await client.get(f"/v1/simulations/{sim_id}")).json()
    assert sim["status"] == "ready"
    a24 = next(s for s in sim["branches"]["A"]["snapshots"] if s["timepoint"] == "m24")
    assert a24["finance"]["savings"]["range"]["unit"] == "usd"
    assert all(c["passed"] for c in sim["checks"]), sim["checks"]
    # branch isolation: A never cites B
    assert "ev_B_" not in json.dumps(sim["branches"]["A"])
    assert "E-B-" not in json.dumps(sim["branches"]["A"])

    r = await client.post(f"/v1/simulations/{sim_id}/shock", json={"label": "Startup fails at month 14", "description": "The company runs out of money.", "month": 14})
    assert r.status_code == 202
    await wait_for(sim_id, "shock_ready")
    sim2 = (await client.get(f"/v1/simulations/{sim_id}")).json()
    shock = sim2["shocks"][0]
    assert shock["applies_to"] == ["A"]
    assert "B" in shock["not_applied_because"]
    fields = {(c["timepoint"], c["field"]) for c in shock["changes"]}
    assert ("m24", "finance.savings") in fields
    assert ("m6", "finance.savings") not in fields  # before the shock: unchanged
    sav = next(c for c in shock["changes"] if c["field"] == "finance.savings" and c["timepoint"] == "m24")
    assert sav["because"][0] == shock["id"]
    b_before = next(s for s in sim["branches"]["B"]["snapshots"] if s["timepoint"] == "m24")
    b_after = next(s for s in sim2["branches"]["B"]["snapshots"] if s["timepoint"] == "m24")
    assert b_before["finance"] == b_after["finance"]

    versions = (await client.get(f"/v1/simulations/{sim_id}/versions")).json()
    assert [v["version"] for v in versions] == [1, 2]

    async with client.stream("POST", f"/v1/simulations/{sim_id}/chat", json={"branch": "both", "question": "What do you regret?", "timepoint": "m24"}) as r:
        body = "".join([chunk async for chunk in r.aiter_text()])
    assert "event: turn" in body and "event: done" in body
    msgs = (await client.get(f"/v1/simulations/{sim_id}/messages")).json()
    roles = [m["role"] for m in msgs]
    assert roles == ["user", "future_a", "future_b", "future_a"]
    for m in msgs:
        if m["role"] == "future_b":
            assert "ev_A_" not in m["text"] and "E-A-" not in m["text"]

    r = await client.post(f"/v1/simulations/{sim_id}/assumptions", json={"branch": "A", "edits": {"job_search_months": 6}})
    assert r.status_code == 200
    sim3 = r.json()
    s24 = next(s for s in sim3["branches"]["A"]["snapshots"] if s["timepoint"] == "m24")
    a24_after_shock = next(s for s in sim2["branches"]["A"]["snapshots"] if s["timepoint"] == "m24")
    assert s24["finance"]["savings"]["range"]["high"] < a24_after_shock["finance"]["savings"]["range"]["high"]

    r = await client.post(f"/v1/simulations/{sim_id}/postcard", json={"branch": "A"})
    assert r.status_code == 200
    img = await client.get(r.json()["url"])
    assert img.status_code == 200 and img.headers["content-type"].startswith("image/")

    calls = (await client.get(f"/v1/simulations/{sim_id}/calls")).json()
    assert "muse-wonder-1.0" in calls["by_model"] and "muse-spark-1.3" in calls["by_model"]
