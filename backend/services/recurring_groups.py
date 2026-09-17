"""Which group a recurring bill belongs in.

The groups are fixed and product-defined, so every screen, total and alert
agrees on them. The user can move any bill to any group; this module only
chooses the *starting* group, and once a bill has a `group_key` nothing here
overrides it.

Signals are consulted strongest first and the first confident answer wins:

  1. Plaid's detailed personal-finance category — Plaid's own taxonomy, which
     already separates "gas and electricity" from "internet and cable".
  2. Plaid's primary category, for rows Plaid enriched less precisely.
  3. The name of the user's own category ("Utilities", "Insurance").
  4. A short, bounded list of well-known merchant names.
  5. The shape of the charge: a fixed amount paid online reads as a
     subscription; anything else is "other".

Deliberately not a universal merchant database. Step 4 exists for the handful
of services almost everyone pays, and it matches whole words only, so it
under-assigns rather than filing an unrelated business somewhere wrong. A wrong
group is cheap to fix — one move — but it would sit inside a total until then.
"""

from __future__ import annotations

import re
from typing import Final, Optional

# Display order is the order bills are listed in.
GROUPS: Final[list[tuple[str, str]]] = [
    ("housing", "Housing"),
    ("utilities", "Utilities"),
    ("phone_internet", "Phone & internet"),
    ("insurance", "Insurance"),
    ("subscriptions", "Subscriptions"),
    ("loans_cards", "Loans & cards"),
    ("transport", "Transport"),
    ("healthcare", "Healthcare"),
    ("other", "Other"),
    ("income", "Income"),
]
GROUP_KEYS: Final[frozenset[str]] = frozenset(key for key, _ in GROUPS)
GROUP_LABELS: Final[dict[str, str]] = dict(GROUPS)
GROUP_ORDER: Final[dict[str, int]] = {key: index for index, (key, _) in enumerate(GROUPS)}


_PFC_DETAILED: Final[dict[str, str]] = {
    "RENT_AND_UTILITIES_RENT": "housing",
    "LOAN_PAYMENTS_MORTGAGE_PAYMENT": "housing",
    "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY": "utilities",
    "RENT_AND_UTILITIES_WATER": "utilities",
    "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT": "utilities",
    "RENT_AND_UTILITIES_OTHER_UTILITIES": "utilities",
    "RENT_AND_UTILITIES_INTERNET_AND_CABLE": "phone_internet",
    "RENT_AND_UTILITIES_TELEPHONE": "phone_internet",
    "GENERAL_SERVICES_INSURANCE": "insurance",
    "LOAN_PAYMENTS_CAR_PAYMENT": "loans_cards",
    "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT": "loans_cards",
    "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT": "loans_cards",
    "LOAN_PAYMENTS_OTHER_PAYMENT": "loans_cards",
    "ENTERTAINMENT_TV_AND_MOVIES": "subscriptions",
    "ENTERTAINMENT_MUSIC_AND_AUDIO": "subscriptions",
    "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS": "subscriptions",
    "GENERAL_SERVICES_AUTOMOTIVE": "transport",
    "TRANSPORTATION_PUBLIC_TRANSIT": "transport",
    "TRANSPORTATION_PARKING": "transport",
    "TRANSPORTATION_TOLLS": "transport",
    "MEDICAL_DENTAL_CARE": "healthcare",
    "MEDICAL_EYE_CARE": "healthcare",
    "MEDICAL_NURSING_CARE": "healthcare",
    "MEDICAL_PHARMACIES_AND_SUPPLEMENTS": "healthcare",
    "MEDICAL_PRIMARY_CARE": "healthcare",
    "MEDICAL_VETERINARY_SERVICES": "healthcare",
    "MEDICAL_OTHER_MEDICAL": "healthcare",
}

_PFC_PRIMARY: Final[dict[str, str]] = {
    "RENT_AND_UTILITIES": "utilities",
    "LOAN_PAYMENTS": "loans_cards",
    "TRANSPORTATION": "transport",
    "MEDICAL": "healthcare",
    "INCOME": "income",
}

# Whole-word keywords matched against the user's category name.
_CATEGORY_WORDS: Final[list[tuple[str, tuple[str, ...]]]] = [
    ("housing", ("rent", "mortgage", "housing", "hoa")),
    ("utilities", ("utilities", "utility", "electric", "electricity", "water", "energy", "trash")),
    ("phone_internet", ("phone", "mobile", "cell", "internet", "wifi", "cable", "broadband")),
    ("insurance", ("insurance",)),
    ("subscriptions", ("subscription", "subscriptions", "streaming", "software", "membership", "memberships", "gym", "fitness", "apps")),
    ("loans_cards", ("loan", "loans", "debt", "credit")),
    ("transport", ("car", "auto", "transport", "transportation", "transit", "parking", "fuel")),
    ("healthcare", (
        "health", "healthcare", "medical", "dental", "dentist", "doctor", "pharmacy", "orthodontics",
        "orthodontist", "therapy", "vision", "optometry", "prescriptions", "hospital", "clinic",
    )),
    ("income", ("salary", "income", "paycheck", "payroll", "wages")),
]

# Well-known merchants, matched as whole words in the normalized merchant key.
_MERCHANT_WORDS: Final[list[tuple[str, tuple[str, ...]]]] = [
    ("subscriptions", (
        "netflix", "spotify", "hulu", "disney", "hbo", "hbomax", "peacock", "paramount", "youtube",
        "audible", "patreon", "icloud", "dropbox", "adobe", "microsoft", "openai", "chatgpt",
        "anthropic", "github", "notion", "duolingo", "crunchyroll", "nytimes",
    )),
    ("phone_internet", (
        "verizon", "tmobile", "att", "xfinity", "comcast", "spectrum",
        "optimum", "cricket", "fios",
    )),
    ("insurance", (
        "geico", "progressive", "allstate", "statefarm", "insurance", "metlife",
    )),
    ("utilities", ("electric", "electricity", "utilities", "utility", "pge", "coned")),
    ("housing", ("rent", "apartments", "mortgage")),
    ("healthcare", ("invisalign", "orthodontics", "orthodontist", "dental", "dentistry")),
]

_WORD = re.compile(r"[a-z0-9]+")


def _words(text: Optional[str]) -> set[str]:
    return set(_WORD.findall((text or "").lower()))


def label_for(group_key: Optional[str]) -> str:
    return GROUP_LABELS.get(group_key or "other", "Other")


def classify(
    *,
    amount_is_income: bool,
    pfc_detailed: Optional[str] = None,
    pfc_primary: Optional[str] = None,
    category_name: Optional[str] = None,
    merchant_key: Optional[str] = None,
    fixed_amount: bool = False,
    online: bool = False,
) -> str:
    """The starting group for a recurring charge. Always returns a valid key."""
    if amount_is_income:
        return "income"

    if pfc_detailed and pfc_detailed.upper() in _PFC_DETAILED:
        return _PFC_DETAILED[pfc_detailed.upper()]
    if pfc_primary and pfc_primary.upper() in _PFC_PRIMARY:
        group = _PFC_PRIMARY[pfc_primary.upper()]
        if group != "income":
            return group

    category_words = _words(category_name)
    for group, keywords in _CATEGORY_WORDS:
        if group != "income" and category_words.intersection(keywords):
            return group

    merchant_words = _words(merchant_key)
    # "t mobile" / "at t" normalize into separate tokens; join adjacent pairs
    # so the bounded list can still name them as one word.
    tokens = _WORD.findall((merchant_key or "").lower())
    merchant_words.update(a + b for a, b in zip(tokens, tokens[1:]))
    for group, keywords in _MERCHANT_WORDS:
        if merchant_words.intersection(keywords):
            return group

    if fixed_amount and online:
        return "subscriptions"
    return "other"
