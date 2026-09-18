"""Coverage floors for the code that moves money or guards accounts.

A global percentage hides exactly the files that matter: a well-tested helper
module can carry an untested ledger. So besides the overall floor, every file
listed here has its own. Run after `pytest --cov ... --cov-report=json:<path>`:

    python scripts/check_coverage.py coverage.json

Floors sit a few points under what the suite measured when they were set
(2026-09-18), so a real regression fails CI and ordinary churn does not. Raise
them as coverage improves; lowering one needs a reason in the commit.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

OVERALL_FLOOR = 85.0

# path (relative to backend/, forward slashes) -> minimum percent covered
FLOORS: dict[str, float] = {
    # Ledger, balances, transfers
    "services/ledger.py": 90.0,
    "routers/transactions.py": 90.0,
    "routers/transfers.py": 95.0,
    # Phase 4 money features
    "services/budgets.py": 90.0,
    "services/splits.py": 90.0,
    "services/csv_import.py": 90.0,
    "services/categorization_rules.py": 90.0,
    "services/alerts.py": 90.0,
    "routers/budgets.py": 85.0,
    "routers/rules.py": 85.0,
    "routers/transaction_import.py": 85.0,
    # Recurring and bank sync
    "services/recurring_bills.py": 85.0,
    "services/transaction_enrichment.py": 85.0,
    "routers/plaid_router/sync.py": 80.0,
    # Accounts and secrets
    "utils/totp.py": 95.0,
    "utils/secret_box.py": 95.0,
    "utils/auth.py": 85.0,
    "services/two_factor.py": 90.0,
    "services/login_throttle.py": 90.0,
    "routers/two_factor.py": 85.0,
    "routers/account.py": 85.0,
}


def main(path: str) -> int:
    report = json.loads(Path(path).read_text(encoding="utf-8"))
    measured = {name.replace("\\", "/"): data["summary"]["percent_covered"] for name, data in report["files"].items()}
    failures: list[str] = []
    for name, floor in sorted(FLOORS.items()):
        actual = measured.get(name)
        if actual is None:
            failures.append(f"{name}: not measured (renamed or not imported by the suite?)")
        elif actual + 1e-9 < floor:
            failures.append(f"{name}: {actual:.1f}% < {floor:.0f}%")
        else:
            print(f"ok   {name:40s} {actual:5.1f}%  (floor {floor:.0f}%)")
    overall = report["totals"]["percent_covered"]
    if overall + 1e-9 < OVERALL_FLOOR:
        failures.append(f"overall: {overall:.1f}% < {OVERALL_FLOOR:.0f}%")
    else:
        print(f"ok   {'overall':40s} {overall:5.1f}%  (floor {OVERALL_FLOOR:.0f}%)")
    for failure in failures:
        print(f"FAIL {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "coverage.json"))
