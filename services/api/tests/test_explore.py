"""Third door, Fork With Friends, check-ins, and the offline mock for underserved-decision scenarios."""

import asyncio

import httpx
import pytest

from elsewhere import mock_brain
from elsewhere.main import app, store
from elsewhere.mock_brain import CANONICAL

GULF = ("Should I take a construction electrician job in Dubai paying $10,800 a year with housing provided (the recruitment agent wants a $1,500 fee), "
        "or stay in Kochi, Kerala as an electrician earning $4,200 a year near my parents? I want to send money home and build savings. "
        "I have $900 saved and spend about $250 a month. I'm worried about the fee and being far from family.")
NURSING = ("Should I keep working as a certified nursing assistant in Houston at $36,000 a year, or go to community college for a two-year nursing degree "
           "to become a registered nurse? Tuition is about $11,000 a year, paid with student loans, and I'd work part-time at about $14,000 a year while studying. "
           "I'm the first in my family to go to college. I have $3,000 saved and spend about $2,100 a month. I'm scared of the debt.")
GIG = ("Should I lease a car to drive full-time for Uber and Lyft in Atlanta, earning about $40,000 a year after the car lease, gas and insurance, "
       "or keep my warehouse job in Atlanta at $37,000 a year with health insurance? I want control over my hours and to be home when my daughter gets out of school, "
       "but I need steady money. I have $2,500 saved and spend about $2,200 a month. I'm worried about getting deactivated or the car breaking down.")


@pytest.fixture(scope="module")
async def client():
    await store.init()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:
        yield c


async def wait_ready(sim_id: str, timeout: float = 30) -> None:
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        for row in await store.events_after(sim_id, 0):
            if row.type == "simulation_ready":
                return
            if row.type.endswith("_failed"):
                raise AssertionError(row.data)
        await asyncio.sleep(0.2)
    raise TimeoutError


async def ready_sim(client, text: str) -> str:
    r = await client.post("/v1/decisions", json={"text": text})
    sim_id = r.json()["id"]
    await client.post(f"/v1/decisions/{sim_id}/simulate")
    await wait_ready(sim_id)
    return sim_id


def test_mock_intake_reads_underserved_decisions():
    g = mock_brain.intake(GULF)
    assert g.path_a.city == "Dubai" and g.path_a.annual_pay_usd == 10800
    assert g.path_b.city == "Kochi" and g.path_b.annual_pay_usd == 4200
    assert mock_brain._kind(g.path_a) == "migrant" and mock_brain._kind(g.path_b) == "hourly"
    assert [c.amount for c in mock_brain._planned_costs(g, g.path_a)] == [1500]
    assert g.current.savings_usd == 900 and g.current.monthly_expenses_usd == 250
    assert g.priorities.location == 4

    n = mock_brain.intake(NURSING)
    assert n.path_a.annual_pay_usd == 36000 and mock_brain._kind(n.path_a) == "care"
    assert n.path_b.org_type == "school" and mock_brain._kind(n.path_b) == "nursing_school"
    assert n.path_b.annual_pay_usd == 14000  # part-time pay, not tuition
    assert [c.amount for c in mock_brain._planned_costs(n, n.path_b)] == [11000, 11000]

    k = mock_brain.intake(GIG)
    assert mock_brain._kind(k.path_a) == "gig" and k.path_a.annual_pay_usd == 40000
    assert mock_brain._kind(k.path_b) == "hourly" and k.path_b.annual_pay_usd == 37000
    assert k.priorities.autonomy == 4 and k.fears


def test_canonical_intake_unchanged():
    c = mock_brain.intake(CANONICAL)
    assert c.path_a.annual_pay_usd == 145000 and c.path_b.annual_pay_usd == 180000
    assert c.path_a.org_type == "startup"


def test_roulette_labels_scope_to_one_path():
    spec = mock_brain.intake(GIG)
    plan = mock_brain.shock_plan(spec, "Car breaks down (Path A)", "A big repair.", 10)
    by = {b.branch: b for b in plan.branches}
    assert by["A"].applies and by["A"].one_time_cost
    assert not by["B"].applies
    both = mock_brain.shock_plan(spec, "Medical emergency", "A hospital bill.", 10)
    assert all(b.applies for b in both.branches)


async def test_third_door_flow(client):
    sim_id = await ready_sim(client, GIG)
    r = await client.post(f"/v1/simulations/{sim_id}/third-door")
    assert r.status_code == 200, r.text
    door = r.json()
    assert door["mode"] == "mock" and door["label"] and door["first_step"]
    assert (await client.get(f"/v1/simulations/{sim_id}")).json()["third_door"]["label"] == door["label"]
    r = await client.post(f"/v1/simulations/{sim_id}/third-door/simulate", json={"against": "B"})
    assert r.status_code == 202
    child = r.json()["simulation_id"]
    await wait_ready(child)
    sim = (await client.get(f"/v1/simulations/{child}")).json()
    assert sim["derived_from"] == sim_id
    assert sim["decision"]["path_b"]["label"] == door["path"]["label"]


async def test_share_and_votes(client):
    sim_id = await ready_sim(client, CANONICAL)
    r = await client.post(f"/v1/simulations/{sim_id}/share")
    share = r.json()["share_id"]
    assert (await client.post(f"/v1/simulations/{sim_id}/share")).json()["share_id"] == share  # one link per simulation
    view = (await client.get(f"/v1/shares/{share}")).json()
    assert set(view["branches"]) == {"A", "B"}
    assert "current" not in str(view.keys()) and "evidence" not in view  # no stated savings, no evidence ledger
    t = (await client.post(f"/v1/shares/{share}/votes", json={"choice": "A", "token": "friend-one-123", "name": "Sam", "reason": "You light up talking about it"})).json()
    assert t["A"] == 1 and t["mine"] == "A"
    t = (await client.post(f"/v1/shares/{share}/votes", json={"choice": "B", "token": "friend-one-123"})).json()
    assert t["A"] == 0 and t["B"] == 1  # changing your vote doesn't double count
    await client.post(f"/v1/shares/{share}/votes", json={"choice": "A", "token": "friend-two-456"})
    owner = (await client.get(f"/v1/simulations/{sim_id}/share")).json()
    assert owner["total"] == 2
    assert (await client.get("/v1/shares/nope")).status_code == 404


async def test_checkins(client):
    sim_id = await ready_sim(client, CANONICAL)
    r = await client.post(f"/v1/simulations/{sim_id}/checkins", json={"month": 6, "took": "A", "savings_usd": 31000, "stress": 4, "note": "Busy"})
    assert r.status_code == 200
    rows = (await client.get(f"/v1/simulations/{sim_id}/checkins")).json()
    assert rows[0]["month"] == 6 and rows[0]["took"] == "A"
    assert (await client.post(f"/v1/simulations/{sim_id}/checkins", json={"month": 6, "took": "C"})).status_code == 422
