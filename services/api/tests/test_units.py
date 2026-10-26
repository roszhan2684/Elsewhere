import json
from pathlib import Path

from elsewhere.agents.persona import spans, violates
from elsewhere.agents.schemas import FinanceOutput, ShockPlan, SpecialistOutput
from elsewhere.contracts import DecisionSpec, FinanceInputs, PaySegment
from elsewhere.engine import deps, finance
from elsewhere.strict_schema import strict_schema

GOLDEN = Path(__file__).resolve().parents[3] / "packages" / "evals" / "finance_golden.json"


def _objects(node):
    if isinstance(node, dict):
        if node.get("type") == "object":
            yield node
        for v in node.values():
            yield from _objects(v)
    elif isinstance(node, list):
        for v in node:
            yield from _objects(v)


def test_strict_schemas_follow_meta_rules():
    for model in (DecisionSpec, SpecialistOutput, FinanceOutput, ShockPlan):
        s = strict_schema(model)
        dumped = json.dumps(s)
        assert "$ref" not in dumped and "oneOf" not in dumped and "allOf" not in dumped
        for obj in _objects(s):
            assert obj["additionalProperties"] is False
            assert set(obj["required"]) == set(obj["properties"])


def test_finance_golden():
    cases = json.loads(GOLDEN.read_text())
    for case in cases:
        fi = FinanceInputs.model_validate(case["inputs"])
        for tp, exp in case["expect"].items():
            p = finance.timeline(fi)[tp]
            assert abs(p.savings_low - exp["savings_low"]) < 1, (case["name"], tp)
            assert abs(p.savings_high - exp["savings_high"]) < 1, (case["name"], tp)


def test_pay_gap_reduces_savings():
    base = FinanceInputs(start_savings=40000, annual_pay=145000, effective_tax_rate=0.33, annual_housing_low=36000,
                         annual_housing_high=48000, annual_other_costs=30000)
    shocked = base.model_copy(update={"pay_segments": [
        PaySegment(start_month=0, end_month=14, annual_pay=145000, label="base pay"),
        PaySegment(start_month=14, end_month=17, annual_pay=0, label="job search"),
        PaySegment(start_month=17, end_month=None, annual_pay=152000, label="next role"),
    ]})
    assert finance.savings_at(shocked, 24, True) < finance.savings_at(base, 24, True)
    assert finance.savings_at(shocked, 6, True) == finance.savings_at(base, 6, True)


def test_dependency_walk():
    d = deps.downstream(["career.employment_status"])
    assert {"finance.salary", "finance.savings", "lifestyle.stress", "risk.job_security"} <= d
    assert "location.city" not in d
    path = deps.upstream_path("finance.savings", {"finance.salary", "finance.savings"}, {"career.employment_status"})
    assert path[0] == "career.employment_status" and path[-1] == "finance.savings"


def test_branch_guard():
    allowed = {"ev_A_001", "E-A-002", "ev_U_001"}
    assert not violates("I lead a team now [ev_A_001].", allowed, [])
    assert violates("Since the shutdown [E-B-003] things changed.", allowed, [])
    assert violates("After the company shut down I moved on.", allowed, ["company shut down"])
    sp = spans("I lead a team [ev_A_001]. Savings are thin [E-A-002].")
    assert [s.ref for s in sp] == ["ev_A_001", "E-A-002"]
