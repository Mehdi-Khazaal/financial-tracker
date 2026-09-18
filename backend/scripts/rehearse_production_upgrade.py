"""Rehearse the production upgrade on a scratch Postgres database. Never on production.

Production was built by `main`'s boot-time repairs and has never been stamped.
This script reproduces that database and runs the documented procedure against
it, so the one risky operational step is exercised before it is done for real:

    git worktree add ../fintrack-main main
    python scripts/rehearse_production_upgrade.py \\
        --main ../fintrack-main/backend \\
        --scratch-url postgresql://postgres:postgres@localhost:5432/fintrack_rehearsal

Steps: (1) `main` boots and builds its schema; (2) a few rows are written the
old way; (3) this branch boots on the unstamped database and must refuse
traffic (`/healthz` 503) rather than serve failing requests; (4) `alembic stamp
<PRODUCTION_BASELINE>`; (5) this branch boots again, upgrades to head, and must
be healthy with no missing columns; (6) the rows are still there.

The scratch database is dropped and re-created; the script refuses any URL
whose host is not localhost.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

BRANCH = Path(__file__).resolve().parents[1]

PROBE = r'''
import main
from fastapi.testclient import TestClient
from utils.migrations import SCHEMA_STATE
print("outcome=%s missing=%d healthz=%d" % (main._migration_outcome, len(SCHEMA_STATE["missing"]), TestClient(main.app).get("/healthz").status_code))
'''

SEED = r'''
import os, psycopg2
c = psycopg2.connect(os.environ["DATABASE_URL"]); c.autocommit = True; k = c.cursor()
k.execute("INSERT INTO users (email, username, hashed_password, is_verified, is_admin, session_version) VALUES ('r@x.co','r','x',true,false,0) RETURNING id"); uid = k.fetchone()[0]
k.execute("INSERT INTO accounts (user_id, name, type, balance) VALUES (%s,'Checking','checking',100) RETURNING id", (uid,)); aid = k.fetchone()[0]
k.execute("INSERT INTO transactions (user_id, account_id, amount, description, transaction_date) VALUES (%s,%s,-12.34,'Coffee','2026-09-01')", (uid, aid))
'''

CHECK = r'''
import os, psycopg2
k = psycopg2.connect(os.environ["DATABASE_URL"]).cursor()
k.execute("SELECT count(*), sum(amount) FROM transactions"); n, total = k.fetchone()
print("rows=%d sum=%s" % (n, total))
'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--main", required=True, help="path to a checkout of main's backend/")
    parser.add_argument("--scratch-url", required=True, help="postgresql://…/<scratch db> on localhost")
    args = parser.parse_args()

    host = re.search(r"@([^/:]+)", args.scratch_url)
    if not host or host.group(1) not in {"localhost", "127.0.0.1"}:
        print("refusing: the scratch database must be on localhost")
        return 2

    import psycopg2

    name = args.scratch_url.rsplit("/", 1)[1].split("?")[0]
    admin = psycopg2.connect(args.scratch_url.rsplit("/", 1)[0] + "/postgres")
    admin.autocommit = True
    admin.cursor().execute(f'DROP DATABASE IF EXISTS "{name}"')
    admin.cursor().execute(f'CREATE DATABASE "{name}"')

    from utils.migrations import PRODUCTION_BASELINE

    env = {k: v for k, v in os.environ.items() if k not in {"DATABASE_URL", "PRODUCTION_DATABASE_URL"}}
    env.update(DATABASE_URL=args.scratch_url, SECRET_KEY="rehearsal-secret-key-0123456789abcdef", ENVIRONMENT="test")

    def run(label: str, command: list[str], cwd: Path) -> str:
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)
        last = (result.stdout.strip().splitlines() or [""])[-1]
        print(f"{'ok ' if result.returncode == 0 else 'FAIL'} {label}: {last}")
        if result.returncode != 0:
            print(result.stderr[-2000:])
            raise SystemExit(1)
        return last

    run("main builds its schema", [sys.executable, "-c", "import main"], Path(args.main))
    run("rows written the old way", [sys.executable, "-c", SEED], Path(args.main))
    before = run("branch on the unstamped database", [sys.executable, "-c", PROBE], BRANCH)
    run(f"alembic stamp {PRODUCTION_BASELINE}", [sys.executable, "-m", "alembic", "stamp", PRODUCTION_BASELINE], BRANCH)
    after = run("branch boots again", [sys.executable, "-c", PROBE], BRANCH)
    rows = run("data survived", [sys.executable, "-c", CHECK], BRANCH)
    admin.cursor().execute(f'DROP DATABASE "{name}"')

    passed = "healthz=503" in before and "missing=0 healthz=200" in after and rows.startswith("rows=1 ")
    print("REHEARSAL PASSED" if passed else "REHEARSAL FAILED")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.path.insert(0, str(BRANCH))
    os.chdir(BRANCH)
    sys.exit(main())
