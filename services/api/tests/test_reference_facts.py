import json

from elsewhere import reference_facts as refs
from elsewhere.config import REPO_ROOT
from elsewhere.contracts import DecisionSpec


def spec(slug: str) -> DecisionSpec:
    return DecisionSpec(**json.loads((REPO_ROOT / "demo" / f"{slug}.json").read_text())["simulation"]["decision"])


def keys(s: DecisionSpec) -> dict[str, set[str]]:
    return {k: {f.key for f in v} for k, v in refs.facts_for(s).items()}


def test_facts_land_on_the_right_path():
    k = keys(spec("cna-vs-nursing-school"))
    assert "bls_cna_pay" in k["A"] | k["S"]
    assert {"bls_rn_pay", "ncsbn_nclex_2024"} <= k["B"]
    k = keys(spec("gulf-job-vs-stay-kerala"))
    assert {"uae_recruitment_fees", "uae_no_income_tax"} <= k["A"]
    assert "rbi_kerala_wage" in k["B"]


def test_no_false_matches_on_unrelated_decisions():
    for slug in ("startup-sf-vs-seattle", "grad-school-vs-job", "own-product-vs-stay"):
        assert keys(spec(slug)) == {"A": set(), "B": set(), "S": set()}


def test_rent_answer_needs_a_housing_question_and_a_known_city():
    assert refs.rent_answer("Typical annual rent for a one-bedroom apartment in Atlanta") is not None
    assert refs.rent_answer("Median salary for nurses in Atlanta") is None
    assert refs.rent_answer("Typical rent in Boise") is None


def test_every_fact_is_cited():
    for f in [*refs.FACTS, *refs.RENTS]:
        assert f.url.startswith("https://") and f.title and f.checked
