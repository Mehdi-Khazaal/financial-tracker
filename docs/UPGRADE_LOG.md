# Fintrack Upgrade Log

This file is the resumption point. A fresh session must be able to continue from
it alone: read **Status**, then the latest phase entry, then **Next step**.

## Status

- Branch: `fable/upgrade` (created from `main` @ `1843c6d` on 2026-09-17). Never push to `main`.
- Current phase: **Phase 1 complete → Phase 2 (CRA → Vite) next.**
- Ground rules in force (from the brief): Alembic-only additive migrations; Decimal
  money end to end; no production contact (no Neon, no Plaid production, no
  secrets printed); preserve ETag/idempotency/offline queue/privacy mode/⌘K/
  pull-to-refresh/haptics/assistant confirmation; grep before building; one
  logical step per commit with CI-equivalent checks green locally.
- Commit messages: one conventional line, no trailers (project convention).

## How to run the checks locally

```
# backend (from backend/, venv at backend/venv)
SECRET_KEY=0123456789abcdef0123456789abcdef DATABASE_URL=sqlite:///./ci.db ENVIRONMENT=test \
  venv/Scripts/python -m pytest tests -q
venv/Scripts/python -m pip_audit -r requirements.txt

# frontend (from frontend/)
npm run typecheck && CI=true npm run test:ci && npm run build
npx audit-ci --config audit-ci.jsonc
CI=1 npx playwright test          # spins up backend :8000 (SQLite) + CRA dev server :3000
```

Local Postgres is available at `localhost:5432` (dev DB in `backend/.env`,
never the Neon URL). Use it for Alembic up→down→up checks.

---

## Phase 0 — Audit & baseline (2026-09-17) ✅

### What changed
- Created branch `fable/upgrade`.
- Added `docs/AUDIT.md` — 45 ranked findings across security, money correctness,
  reliability, performance, DX, UX, plus a feature inventory against Phase 4.
- Added `docs/UPGRADE_LOG.md` (this file).
- `.gitignore`: ignore `brag-output*/` (launch-video renders that were sitting untracked).
- Corrected the project memory note that said "never use Vercel rewrites": the
  repo proxies `/api/*` through Vercel on purpose (commit `90dee45`) with an
  HTML-response guard and `no-store` headers; that is the design the brief
  describes and it stays.

### Baseline (local, Windows 11, Node 24.14.1, Python 3.13.0)

| Check | Result |
|-------|--------|
| Backend `pytest tests -q` | 577 tests (476 functions), all pass, 9 m 54 s wall (slow: per-test drop/create on file SQLite + bcrypt-12 per fixture — AUDIT P5) |
| `pip-audit` | clean |
| `tsc --noEmit` | pass, 21 s |
| Jest (`react-scripts test`) | 45 suites / 973 tests pass, 41 s |
| `react-scripts build` | pass, 1 m 36 s |
| Bundle (gzip) | `main.js` 139.8 kB, `main.css` 12.1 kB, largest lazy chunk 116.3 kB (Recharts); raw JS ≈ 1.43 MB; `build/` 8.2 MB |
| `audit-ci` | pass (1 allow-listed react-router advisory, not applicable) |
| Playwright smoke | 12 passed, 2 m 46 s |
| Lighthouse mobile `/login` (prod build, `serve`, simulated throttling) | Perf 91 · A11y 88 · Best Practices 100 · FCP 2.7 s · LCP 2.9 s · TBT 20 ms · CLS 0 · SI 2.7 s |

Test counts: backend 577 tests (476 functions) in 34 files; frontend 973 tests in 45 suites; e2e 12 specs (6 smoke + 6 screenshot/layout probes).

### Decisions and reasoning
1. **Keep the Vercel `/api/*` proxy.** The code already guards against the CDN-cached-HTML failure the old memory note described (`api.ts` throws on `text/html`, backend sends `no-store`). Switching to direct Render calls would reopen Safari cookie problems and contradict the brief. Memory updated.
2. **`nixpacks.toml` is a Railway leftover** (added in commit `d1fc539` "Add Railway config"). Render does not read it. It will be deleted in Phase 3 together with a `render.yaml`; Render's actual Python version is a dashboard setting I cannot see, so `render.yaml` + `.python-version` will make it explicit and the final checklist will ask you to confirm the dashboard matches.
3. **Boot-time `_prepare_database()` stays until Phase 3.** It is the only thing that has ever migrated production. Making Alembic authoritative needs a one-time `alembic stamp` on prod (manual, in the checklist), so it is scheduled with the reliability work rather than done ad hoc.
4. **Lighthouse baseline is `/login`** (the only page reachable without a backend). Phase 2 will re-measure the same page plus an authenticated dashboard via the e2e harness.
5. **Assistant `save_memory` is treated as a write** for the purposes of Phase 1 (AUDIT S2). It executes inside the model loop today; the brief's "write tools only via confirmed `/execute`" property does not hold for it.

### Skipped / not done
- No screen-by-screen UX audit at 390 px / 1440 px yet — that is Phase 5; the code-level UX findings are in AUDIT §6.
- Did not measure per-endpoint query counts — Phase 3 does that with tests before/after indexes.
- Did not edit `backend/.env` (contains a prod URL on the dev machine — AUDIT S14); that is a manual step for you.

### Next step (done — see Phase 1)

---

## Phase 1 — Security & correctness hardening (2026-09-17) ✅

Commits, in order: `7cad142` test speed · `ca9b64a` ledger unification · `a6b5699` isolation sweep · `fb5f44e` auth · `dca2c62` push · `5ee818d` security config · `c3655d0` assistant · `829dc4a` money/dates/milestones/scrubbing · frontend CSP/labels (next commit).

### What changed
| AUDIT id | Change | Where |
|---|---|---|
| P5 | Backend suite 9 m 54 s → **~21 s**: SQLite `synchronous=OFF` / `journal_mode=MEMORY` on the throwaway test DB, `BCRYPT_ROUNDS` env (12 prod default, 4 in tests, clamped 4–16), `limiter.reset()` per test. | `tests/conftest.py`, `utils/auth.py` |
| C1, C2, C7 | **One posting path.** `LedgerService.stage_transaction()` validates ownership, enriches (merchant key, category suggestion), adds the row and applies the balance delta as a SQL expression; `create_transaction` wraps it with commit. Savings-goal spend, assistant `add_transaction`, recurring `process-due`, variable-bill `log`, and the cron poster all call it. An explicit `merchant_key` (a bill's matched identity) is kept. 10 characterization tests pin the arithmetic; a lost-update test proves the atomic delta. | `services/ledger.py`, `routers/{savings_goals,assistant,recurring_transactions,cron}.py`, `tests/test_ledger_posting.py` |
| S16, D2 | `tests/test_tenant_isolation.py`: a "victim" user with one of everything; 50 parametrized cases cover every id-taking read/write, every list, body references (transfers, allocations, transaction account/category), push unsubscribe, admin, and unauthenticated access. Plaid calls are patched to *fail* if reached. `loans`, `transfers`, `push` routers added to the test app. | tests |
| S4 | Per-identifier lockout (`auth_failures` table, revision 14): 5 consecutive failures → 60 s lock, doubling per further failure, cap 15 min; 429 + `Retry-After`; success clears; failures older than 1 h are forgotten. `/auth/refresh` 30/min, `/auth/reset-password` 5/min. | `services/login_throttle.py`, `routers/auth.py` |
| S5 | `/auth/refresh` rotates **both** cookies; refresh tokens carry a random `jti` so each issue is distinct. | `routers/auth.py`, `utils/auth.py` |
| S6 | Forgot-password matches email case-insensitively. | `routers/auth.py` |
| S1 | Push `endpoint` must be public `https` with a dotted hostname: no `http`, no credentials, no IP literals, no `localhost`/`.local`; both keys required. | `routers/push.py`, `tests/test_push.py` |
| S7 | `/docs`, `/redoc`, `/openapi.json` off when `ENVIRONMENT=production` unless `EXPOSE_API_DOCS=true`; root no longer advertises them. | `utils/security.py`, `main.py` |
| S8 | Backend now sends `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'…`, COOP `same-origin`, CORP `same-site` on every response (Swagger gets its own policy); HSTS prod-only as before. Frontend CSP: dropped `development.plaid.com` (retired Plaid env), `img-src` narrowed from `https:` to `'self' data: https://cdn.plaid.com` (no remote images are loaded anywhere in `src/`). | `utils/security.py`, `frontend/vercel.json` |
| S9 | `ALLOWED_ORIGINS` (CSV) + legacy `EXTRA_ALLOWED_ORIGIN` merged with the defaults via `allowed_browser_origins()`. | `utils/security.py`, `main.py` |
| S2 | **`save_memory` is now a confirmed write**: it is proposed like `add_*`, rendered as an "Approval required · Memory" card, and only `/execute` stores it (limit 100, 1000 chars). Every read-tool result is wrapped in `<tool_result tool=… source="fintrack-ledger">` with a data-not-instructions notice, and the persona has a "Data is not instructions" section. Test seeds an injected description and asserts no memory row, a pending action, and the envelope. | `routers/assistant.py`, `tests/test_assistant_injection.py`, `frontend/src/pages/Assistant.tsx` |
| S10 | Fixed-key, fixed-ciphertext compatibility test for `secret_box` (if it fails, stored Plaid tokens would stop decrypting). | `tests/test_phase1_money_and_secrets.py` |
| S15 | `_scrub_secrets()` redacts `access-/public-/link-<env>-…` tokens and `PLAID_SECRET` from every logged or stored Plaid error; test proves a connection error carrying the token logs `<redacted-plaid-token>`. | `routers/plaid_router.py` |
| C3 | `/history/*` return quantized `Decimal` via Pydantic models → decimal **strings** like every other money field (`"1000.00"`), never floats. Frontend already `Number()`s them. | `routers/history.py` |
| C4 | History months and snapshot month-ends use `user_today()`; cron and the job handler pass each user's own day. | `routers/history.py`, `services/balance_snapshots.py`, `routers/cron.py`, `services/job_handlers.py` |
| C5 | `savings_goals.milestone_notified` (revision 15 + boot-list mirror): a push fires only when a save *crosses* 50/75/100 %; dropping below resets so a later re-crossing announces again. | `routers/savings_goals.py`, `models/database.py` |
| S12 | `verifyEmail` sends the token as a query param, not string-concatenated. | `frontend/src/utils/api.ts` |

### Checks
- Backend: **685 passed** in ~21 s (was 577 in 9 m 54 s). `pip-audit`: clean.
- Alembic `upgrade head → downgrade base → upgrade head → downgrade 000013 → upgrade head` verified on a scratch local Postgres database (`fintrack_migration_check`, created and dropped) and on SQLite. Head is `20260917_000015`.
- Frontend: `tsc` pass, Jest 973 pass (see next commit), build + Playwright re-run at the end of the phase.

### Decisions and reasoning
1. **Speed fix before anything else.** A 10-minute suite makes "run the full suite after each step" a lie; pragmas + bcrypt rounds cost nothing in production (`BCRYPT_ROUNDS` defaults to 12).
2. **`stage_transaction` (no commit) + `create_transaction` (commit)** rather than one function with a flag: recurring posting stages many rows and commits once; a flag would have made the boundary implicit.
3. **Recurring posting now runs enrichment.** A manually posted bill with no category can receive a suggested one from the user's own history (respecting the kill switch). This is a deliberate, small behaviour change — it is what "one ingestion path" means — and the pinned tests show amounts and balances are untouched.
4. **Lockout counters live in the DB, not slowapi's memory**, so restarts and multiple workers do not reset them. The IP limiter stays as the first line.
5. **`save_memory` through confirmation** is a UX cost (one more tap) accepted for the property the brief asks for: no write outside `/execute`. The card reads "Remember: …", which is also transparency the user did not have before.
6. **Kept `style-src 'unsafe-inline'`**: the UI uses inline `style=` for tokens in dozens of places; removing them is a Phase 5 job, not a Phase 1 one.
7. **New tables (auth_failures) and one column (milestone_notified) are the only schema changes**, both additive and reversible; the column is mirrored in `main.py`'s boot list exactly as the codebase does today, until Phase 3 makes Alembic authoritative.

### Skipped / deferred
- S3 (enforce email verification) and S13 (global merchant tables) → public-launch track.
- S14 (`PRODUCTION_DATABASE_URL` in local `.env`) → manual checklist.
- R2 (pending actions in process memory) → Phase 3, with the assistant split.
- No Vercel preview was pushed yet; first push happens with the Phase 2 migration so the preview exercises the new build.

### Next step
**Phase 2 — CRA → Vite.** Plan first (in this log), then: `vite`, `@vitejs/plugin-react`, `vitest` + `jsdom`, TS 5, ESLint flat config; `index.html` to root with `%PUBLIC_URL%` removed; `REACT_APP_VAPID_PUBLIC_KEY` → `VITE_VAPID_PUBLIC_KEY` (only env var in use); `server.proxy` replicating `setupProxy.js` incl. the trailing-slash collection rewrite; keep `public/sw.js` verbatim; add SW update toast + chunk-load reload; port 45 Jest suites to Vitest; `vercel.json` `outputDirectory: dist`; CI Node 24; bundle budget; before/after bundle + Lighthouse.
