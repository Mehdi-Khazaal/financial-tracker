# Fintrack

A personal-finance app that answers "where does my money stand right now?" in under two seconds. Accounts and bank sync (Plaid), budgets with rollover, categorization rules, split transactions, recurring bills, analytics, alerts, CSV import/export, two-factor sign-in, and an assistant ("Fin") that can read the ledger and propose changes you confirm. Installable as a PWA, dark-only, built for a phone first.

| Layer | Stack |
|---|---|
| Frontend | React 19, TypeScript 5.9, Vite 8, Tailwind 3, Vitest, Playwright + axe · deployed on **Vercel** |
| Backend | FastAPI, SQLAlchemy 2, Alembic, Python 3.13, pytest · deployed on **Render** |
| Data | Postgres on **Neon** (SQLite for tests and local use) |
| Integrations | Plaid, Anthropic (assistant), Resend (email), Web Push (VAPID), Sentry (optional) |

## Repository

```
backend/    FastAPI app: routers/, services/, models/, migrations/ (Alembic), scripts/, tests/
frontend/   React app: src/pages, src/features/<area>/{calculations,components,hooks}, e2e/
docs/       ARCHITECTURE.md, DEPLOY.md, AUDIT.md, UPGRADE_LOG.md
PRODUCT.md  who it is for and the principles behind it
DESIGN.md   the "Ledger" design system (tokens, type, motion, accessibility rules)
```

## Run it locally

Backend (Python 3.13):

```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                               # SQLite by default
uvicorn main:app --reload --port 8000              # migrations run on boot
```

Frontend (Node 24):

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev                                        # http://localhost:3000, /api proxied to :8000
```

## Tests

| Command | What it checks |
|---|---|
| `cd backend && pytest tests -q` | 848 tests: ledger, sync, budgets, splits, rules, import, 2FA, tenant isolation, migrations |
| `python scripts/check_coverage.py coverage.json` | per-file coverage floors on money and account code (after `pytest --cov … --cov-report=json:coverage.json`) |
| `cd frontend && npm run test:coverage` | 1089 Vitest tests plus coverage floors on every calculation module |
| `npm run lint && npm run typecheck` | ESLint (0 problems) and `tsc` |
| `npm run e2e` | Playwright: one spec per feature and a WCAG 2.2 AA scan at 390 px and 1440 px |

CI (`.github/workflows/ci.yml`) runs all of the above, plus the migration chain on Postgres with a model-drift check.

## House rules

- Money is `Decimal` on the server and decimal strings on the wire; the client does split and budget arithmetic in integer cents.
- Schema changes are Alembic revisions only: additive, reversible, and guarded so they run on both a chain-built and a model-built database.
- Every query is scoped to the signed-in user; `tests/test_tenant_isolation*.py` proves it for every router.
- Writes that move money go through `services/ledger.py`.
- The accessibility scan and the coverage floors are gates, not reports.

Deploying: see [`docs/DEPLOY.md`](docs/DEPLOY.md). **The first deploy of this release needs a one-time `alembic stamp 20260916_000013` on production. Stamp exactly this revision, never head.**
