"""A small library of checked public facts, each with its source.

These are real figures from official or primary sources (BLS, NCSBN, HUD, KFF, IRS, RBI, UAE
labour law), checked by hand on the date in `checked`. They are added to a simulation as FACTs
when a path matches their keywords, at no model cost. The offline mock uses them too, so a run
without a key still has facts; everything the library doesn't cover stays an INFERENCE.

To add a fact: use a primary source, quote the number exactly, and set `checked` to today.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .contracts import Citation, DecisionSpec, PathSpec

CHECKED = "2026-10-27"


@dataclass(frozen=True)
class RefFact:
    key: str
    text: str
    url: str
    title: str
    any_of: tuple[str, ...]  # matches when any keyword appears in the path's text
    and_any_of: tuple[str, ...] = ()  # optional second group; one of these must appear too
    checked: str = CHECKED

    def citation(self) -> Citation:
        return Citation(url=self.url, title=self.title, retrieved_at=self.checked)


@dataclass(frozen=True)
class RentFact:
    cities: tuple[str, ...]
    text: str  # must contain the monthly dollar figure(s), which the finance step reads
    url: str
    title: str
    checked: str = CHECKED

    def citation(self) -> Citation:
        return Citation(url=self.url, title=self.title, retrieved_at=self.checked)


UAE = ("dubai", "abu dhabi", "sharjah", "ajman", "uae", "united arab emirates", "emirates")
KERALA = ("kerala", "kochi", "cochin", "ernakulam", "thiruvananthapuram", "trivandrum", "kozhikode", "calicut", "thrissur", "kollam")

FACTS: list[RefFact] = [
    # ---- nursing
    RefFact(
        "bls_cna_pay",
        "Nursing assistants and orderlies earned a median $41,870 a year in 2025; jobs are projected to grow 3% from 2025 to 2035 (BLS).",
        "https://www.bls.gov/ooh/healthcare/nursing-assistants.htm",
        "BLS Occupational Outlook Handbook: Nursing Assistants and Orderlies",
        ("nursing assistant", "cna", "orderly", "nurse aide", "nurse's aide"),
    ),
    RefFact(
        "bls_rn_pay",
        "Registered nurses earned a median $97,550 a year in 2025; jobs are projected to grow 6% from 2025 to 2035, faster than average (BLS).",
        "https://www.bls.gov/ooh/healthcare/registered-nurses.htm",
        "BLS Occupational Outlook Handbook: Registered Nurses",
        ("registered nurse", "nursing degree", "nursing school", "adn", "bsn", "rn"),
    ),
    RefFact(
        "ncsbn_nclex_2024",
        "In 2024, 90.6% of first-time U.S.-educated associate-degree candidates passed the NCLEX-RN (76,655 of 84,580); repeat U.S.-educated test takers passed at 50.9% (NCSBN).",
        "https://www.ncsbn.org/public-files/2024_NCLEXExamStats_Final.pdf",
        "NCSBN 2024 NCLEX Examination Statistics, Table 1 and Table 8",
        ("registered nurse", "nursing degree", "nursing school", "nclex", "adn", "rn"),
    ),
    # ---- driving and warehouse work
    RefFact(
        "bls_driver_pay",
        "Taxi drivers, shuttle drivers and chauffeurs, the group that includes ride-hailing, earned a median $37,960 a year in 2025. Ride-hailing drivers typically work as independent contractors, use their own cars, and pay for fuel and maintenance (BLS).",
        "https://www.bls.gov/ooh/transportation-and-material-moving/taxi-drivers-and-chauffeurs.htm",
        "BLS Occupational Outlook Handbook: Taxi Drivers, Shuttle Drivers, and Chauffeurs",
        ("uber", "lyft", "rideshare", "ride-share", "ride share", "ride-hailing", "taxi", "chauffeur"),
    ),
    RefFact(
        "irs_se_tax",
        "Self-employed people pay a 15.3% self-employment tax on net earnings (12.4% Social Security plus 2.9% Medicare), on top of income tax (IRS Publication 334).",
        "https://www.irs.gov/publications/p334",
        "IRS Publication 334, Tax Guide for Small Business",
        ("uber", "lyft", "rideshare", "ride-share", "ride share", "doordash", "gig", "freelance", "self-employed", "independent contractor", "1099"),
    ),
    RefFact(
        "irs_mileage_2025",
        "The IRS standard mileage rate for business driving was 70 cents a mile in 2025, a rough guide to what each mile costs a driver in gas, wear and depreciation (IRS).",
        "https://www.irs.gov/newsroom/irs-increases-the-standard-mileage-rate-for-business-use-in-2025-key-rate-increases-3-cents-to-70-cents-per-mile",
        "IRS: standard mileage rate for business use in 2025",
        ("uber", "lyft", "rideshare", "ride-share", "ride share", "doordash", "delivery driver", "taxi"),
    ),
    RefFact(
        "bls_warehouse_pay",
        "Hand laborers and material movers earned a median $38,220 a year in 2025 (stockers and order fillers: $37,330). BLS notes these jobs have some of the highest injury and illness rates of all occupations.",
        "https://www.bls.gov/ooh/transportation-and-material-moving/hand-laborers-and-material-movers.htm",
        "BLS Occupational Outlook Handbook: Hand Laborers and Material Movers",
        ("warehouse", "stocker", "order filler", "material mover", "forklift", "fulfillment center"),
    ),
    RefFact(
        "kff_premium_2024",
        "Employer health coverage for one person cost $8,951 a year on average in 2024; employers paid most of it and workers paid $1,368 on average (KFF Employer Health Benefits Survey).",
        "https://www.kff.org/health-costs/report/2024-employer-health-benefits-survey/",
        "KFF 2024 Employer Health Benefits Survey",
        ("health insurance", "health benefits", "health coverage"),
    ),
    # ---- Gulf migration and Kerala
    RefFact(
        "uae_recruitment_fees",
        "UAE labour law (Federal Decree-Law No. 33 of 2021) bars employers from charging workers recruitment or hiring costs, directly or indirectly; MOHRE says the employer must pay them.",
        "https://www.mondaq.com/employee-rights-labour-relations/1783954/recruitment-obligations-under-uae-labour-law",
        "Recruitment obligations under UAE labour law (Mondaq), citing Decree-Law 33 of 2021",
        UAE,
    ),
    RefFact(
        "uae_wps_2026",
        "UAE private employers must pay wages through the Wage Protection System. Under MOHRE Resolution 340 of 2026 (from 1 June 2026), any payment after the due date counts as delayed and the company is put under electronic monitoring.",
        "https://www.clydeco.com/en/insights/2026/06/uae-introduces-stricter-wage-protection",
        "Clyde & Co: UAE introduces stricter wage protection system enforcement framework (June 2026)",
        UAE,
    ),
    RefFact(
        "uae_no_income_tax",
        "The UAE does not tax individuals' salaries, and the Ministry of Finance has said it has no plans to introduce personal income tax.",
        "https://gulfnews.com/business/economy/uae-affirms-there-are-no-plans-to-introduce-income-tax-on-individuals-1.1705996309815",
        "Gulf News: UAE affirms there are no plans to introduce income tax on individuals",
        UAE,
    ),
    RefFact(
        "rbi_kerala_wage",
        "Kerala pays the highest rural construction wages in India: men averaged ₹893.6 a day in 2023-24 (RBI Handbook of Statistics on Indian States, Table 116).",
        "https://website.rbi.org.in/web/rbi/-/publications/table-116-state-wise-average-daily-wage-rates-in-rural-india-men-construction-workers-",
        "RBI Handbook of Statistics on Indian States, Table 116",
        KERALA,
        ("construction", "electrician", "mason", "plumber", "carpenter", "labour", "labor", "worker"),
    ),
]

RENTS: list[RentFact] = [
    RentFact(
        ("atlanta",),
        "HUD's FY2026 Fair Market Rent for a one-bedroom in the Atlanta-Sandy Springs-Roswell metro is $1,660 a month.",
        "https://www.huduser.gov/portal/datasets/fmr/fmr2026/FY2026_FMR_Schedule.pdf",
        "HUD FY2026 Fair Market Rent schedule",
    ),
    RentFact(
        ("houston",),
        "HUD sets Houston-area Fair Market Rents by ZIP code; FY2026 one-bedroom values include $1,100 (77067), $1,160 (77034) and $1,390 (77043) a month.",
        "https://pasadenatx.gov/DocumentCenter/View/10575/FY-2026-FAIR-MARKET-RENTS-PDF",
        "FY2026 Fair Market Rents, Houston metro Small Area FMRs (Pasadena TX Housing Authority)",
    ),
    RentFact(
        ("san francisco",),
        "HUD's FY2026 Fair Market Rent for a one-bedroom in the San Francisco metro (Marin, San Francisco, San Mateo) is $2,977 a month.",
        "https://www.huduser.gov/portal/datasets/fmr/fmr2026/FY2026_FMR_Schedule.pdf",
        "HUD FY2026 Fair Market Rent schedule",
    ),
]


def _has(text: str, words: tuple[str, ...]) -> bool:
    return any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", text) for w in words)


def _path_text(p: PathSpec) -> str:
    return " ".join(x for x in (p.label, p.city, p.role, p.notes) if x).lower()


def facts_for(spec: DecisionSpec) -> dict[str, list[RefFact]]:
    """Facts that apply to each path. A fact that fits both goes under 'S' (shared)."""
    a, b = _path_text(spec.path_a), _path_text(spec.path_b)
    # Shared words (fears, goals, constraints) can match too, e.g. "health insurance" in a worry.
    shared = " ".join([spec.question, *spec.goals, *spec.fears, *spec.constraints]).lower()
    out: dict[str, list[RefFact]] = {"A": [], "B": [], "S": []}
    for f in FACTS:
        def fits(t: str) -> bool:
            return _has(t, f.any_of) and (not f.and_any_of or _has(t, f.and_any_of))
        in_a, in_b = fits(a), fits(b)
        if in_a and in_b:
            out["S"].append(f)
        elif in_a:
            out["A"].append(f)
        elif in_b:
            out["B"].append(f)
        elif fits(shared):
            out["S"].append(f)
    return out


def rent_answer(question: str) -> RentFact | None:
    """A checked rent figure for a housing question that names a known city, else None."""
    q = question.lower()
    if not re.search(r"rent|housing|apartment", q):
        return None
    return next((r for r in RENTS if _has(q, r.cities)), None)
