# Fintrack — Phase 0 Audit

Date: 2026-09-17. Branch: `fable/upgrade` (from `main` @ `1843c6d`).
Scope: full read of `backend/` and `frontend/`, CI, deploy config, product/design law.
Every finding has a severity, a location, and a proposed fix. Findings marked
**→ Phase N** are scheduled there; the rest are fixed opportunistically or listed
as accepted risk. Severity: **Critical** (exploitable / money wrong now),
**High** (real bug or security gap, needs fixing before wider use), **Medium**
(should fix during this upgrade), **Low** (note / polish).

Nothing here was verified against production: no prod DB, Plaid production, or
Render/Vercel dashboards were touched. Where a claim depends on a dashboard
setting it says so.

---

## 1. Security

| # | Sev | Finding | Location | Proposed fix |
|---|-----|---------|----------|--------------|
| S1 | **High** | **Web-push subscribe accepts any endpoint URL.** The server later POSTs to it via `pywebpush`, so an authenticated user can make the server issue requests to arbitrary hosts (SSRF-shaped; also lets a hostile endpoint collect notification payloads). | `backend/routers/push.py:22` | Validate `endpoint`: must be `https://`, no userinfo, hostname not an IP / private range, length-capped; store only after validation. Test. **→ Phase 1** |
| S2 | **High** | **Assistant memory can be poisoned by prompt injection.** `save_memory` is a write that runs *immediately* inside the tool loop, not through `/execute`. Tool results embed raw transaction descriptions / merchant names (bank-controlled text). A crafted description can plant a durable memory that shapes every later answer. The `add_*` write tools are correctly gated behind confirmation. | `backend/routers/assistant.py:912` (`_t_save_memory`), tool-result assembly ~L1782 | (a) Wrap every tool result in an explicit untrusted-data envelope; (b) make `save_memory` a *pending action* like `add_*`; (c) add a test that seeds an injected description and asserts no memory row and no executed write. **→ Phase 1** |
| S3 | **Medium** | **Email verification is never enforced.** `is_verified` is set but nothing checks it; an unverified signup has full access. Fine for a single owner, wrong for public launch. | `backend/routers/auth.py:52-88`, `utils/auth.py:get_current_user` | `require_verified` dependency, env-gated `REQUIRE_EMAIL_VERIFICATION`, applied to data routers. **→ Public-launch track** |
| S4 | **Medium** | **Brute-force posture is IP-only.** Login is `5/minute` per IP; `/auth/refresh` and `/auth/reset-password` have no limit; no per-account lockout or backoff. | `backend/routers/auth.py:93,126,186` | DB-backed per-identifier failure counter with exponential backoff (slowapi state is per-process memory); rate-limit refresh and reset-password. **→ Phase 1** |
| S5 | **Medium** | **Refresh token is not rotated on use** (30-day static bearer in a cookie). Revocation only via `session_version`. | `backend/routers/auth.py:126-152` | Rotate the refresh cookie on every `/auth/refresh`; keep the `sv` check. **→ Phase 1** |
| S6 | **Medium** | **Forgot-password email match is case-sensitive** while signup lowercases emails, so `Me@Example.com` silently never gets a reset mail. | `backend/routers/auth.py:176` | `func.lower(User.email) == email.lower()`. Test. **→ Phase 1** |
| S7 | **Medium** | **Swagger UI and OpenAPI are public in production** (`/docs`, `/openapi.json`, `/redoc`); the root route advertises it. | `backend/main.py:130,191` | Disable when `ENVIRONMENT=production` unless `EXPOSE_API_DOCS=true`. **→ Phase 1** |
| S8 | **Medium** | **CSP is looser than needed**: `connect-src` lists `https://development.plaid.com` (Plaid retired the Development environment in 2024; nothing uses it), `img-src https:` is a wildcard, `style-src 'unsafe-inline'` is required by inline `style=` props today. The backend sends no CSP at all. | `frontend/vercel.json:84`, `backend/main.py` `NoCacheMiddleware` | Drop `development.plaid.com`; scope `img-src`; add backend `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and COOP; keep `'unsafe-inline'` for styles (documented) unless Phase 5 removes inline styles. **→ Phase 1** |
| S9 | **Medium** | **Cookie `Secure` only in production; `SameSite=Lax`.** Correct for the same-origin proxy. The origin allow-list is hard-coded in `main.py`, so preview deploys and a custom domain need code changes; `BrowserOriginMiddleware` is the CSRF guard and has no test with a foreign `Origin` + cookie. | `backend/utils/auth.py:31`, `backend/main.py:134-146`, `utils/security.py` | `ALLOWED_ORIGINS` env (CSV) merged with defaults; CSRF test. **→ Phase 1** |
| S10 | **Medium** | **Plaid token encryption key falls back to `SECRET_KEY`.** Rotating `SECRET_KEY` without `PLAID_TOKEN_ENCRYPTION_KEY` set would make every stored access token undecryptable. No test pins ciphertext compatibility across code changes. | `backend/utils/secret_box.py:12` | Test with a fixed key and fixed ciphertext; document the rotation rule. **→ Phase 1** |
| S11 | **Low** | `verify_email` token is reusable for 24 h (no `session_version` bump). Idempotent, harmless. | `backend/routers/auth.py:209-226` | Leave. |
| S12 | **Low** | `verifyEmail` puts the token in the URL unencoded. | `frontend/src/utils/api.ts:287` | Use `params`. **→ Phase 1** |
| S13 | **Low** | `MerchantAlias` / `MerchantCanonical` are **global tables** (no `user_id`). Raw bank strings such as `ZELLE TO J SMITH` are shared across tenants at the alias level. Never read for suggestions (`refresh_canonical_defaults` is descriptive only) and not exposed via any API. | `backend/models/database.py` `MerchantAlias`, `services/merchants.py:183` | Accept; the tenant-isolation suite must assert no API path returns another user's alias. **→ Public-launch track** |
| S14 | **Low** | `backend/.env` on the dev machine carries `PRODUCTION_DATABASE_URL`. Nothing in the repo reads it, but any tool that loads `.env` wholesale would. | local only | Manual step: remove it from `.env`. Not edited by this upgrade. |
| S15 | **Info** | Webhook verification is correct: ES256 JWT, `kid` pinned to Plaid's JWK, 5-minute `iat` window, body SHA-256 compared with `compare_digest`, 1 MB cap. Sandbox/production selection is purely `PLAID_ENV`. Access tokens are Fernet-encrypted at rest and never appear in responses or logs (`_safe_error` stores type + generic message only). | `backend/routers/plaid_router.py:1411-1523` | Add a log-scrubbing test in Phase 1 to keep it that way. |
| S16 | **Info** | IDOR sweep: every router scopes by `current_user.id` (accounts, transactions via `LedgerService`, transfers, categories, assets, goals, loans, recurring, history, plaid items, assistant conversations/memories, preferences). The gap is in **tests**: `test_security_boundaries.py` covers recurring, cron, assistant and stocks only. | `backend/tests/test_security_boundaries.py` | Extend to every router with a two-user fixture. **→ Phase 1** |

## 2. Correctness (money)

| # | Sev | Finding | Location | Proposed fix |
|---|-----|---------|----------|--------------|
| C1 | **High** | **Balance writes are non-atomic read-modify-write** (`Decimal(str(account.balance)) + …`) in four places, while `LedgerService` uses the SQL expression `Account.balance + delta`. A Plaid sync overwriting the balance, or two concurrent requests, loses one update. | `backend/routers/recurring_transactions.py:395,455`, `routers/cron.py:114`, `routers/savings_goals.py:207` | Route all through `LedgerService._adjust_balance` or a shared `apply_balance_delta`. Pin current arithmetic with tests first. **→ Phase 1** |
| C2 | **High** | **Three write paths bypass `LedgerService`** (savings `spend`, assistant `execute add_transaction`, recurring posting in router + cron). They skip enrichment, so those rows get no `merchant_key`/`category_source` and recurring matching, merchant history and analytics degrade. | `backend/routers/savings_goals.py:199`, `routers/assistant.py:1920`, `routers/recurring_transactions.py:384`, `routers/cron.py:105` | One `post_transaction` helper on `LedgerService` used by every site; characterization tests first. **→ Phase 1** |
| C3 | **Medium** | **Money leaves the API as floats** in `/history/*` (`round(float(...), 2)`) and in every assistant tool payload (`_jsonable` → `float`). Rule 6 says Decimal/cents end to end. | `backend/routers/history.py:43,118,119`, `routers/assistant.py:113-118` | Quantized `Decimal` (Pydantic serialises as string; the frontend already does `Number()`); strings for the assistant. **→ Phase 1** |
| C4 | **Medium** | **Server-local `date.today()`** in month-boundary logic, contradicting `utils/dates.py`. Net-worth history months and snapshot month-ends shift for users east/west of UTC. | `backend/routers/history.py:21`, `services/balance_snapshots.py:58`, `routers/cron.py:55,173` | `user_today(current_user)` in history; snapshots per user zone; cron keeps UTC for *selection* (already over-selects by a day). **→ Phase 1** |
| C5 | **Medium** | **Savings-goal milestone push fires on every allocation save at ≥ 50 %** — no "already notified" marker, so editing allocations re-sends "Goal reached!". | `backend/routers/savings_goals.py:150-163` | Persist `milestone_notified` on the goal (additive migration); notify only on crossing. **→ Phase 1** |
| C6 | **Medium** | `Account.balance` has **no opening balance / baseline date**, so balances cannot be reconstructed after imported rows are deleted (documented, pinned by `test_plaid_reset.py`). | `backend/models/database.py` `Account` docstring | Out of scope to fix fully; Budgets/CSV import must not depend on reconstruction. Keep the pin. |
| C7 | **Low** | `execute add_transaction` category lookup ignores `type` and accepts legacy null-owner rows. | `backend/routers/assistant.py:1911-1917` | Reuse the ledger's owned-category check (with C2). **→ Phase 1** |
| C8 | **Low** | `MODEL_PRICING` still holds the Sonnet 5 promo rate the comment says ended 2026-08-31, so `estimated_cost_usd` under-reports. | `backend/routers/assistant.py:72-77` | Verify against the Claude docs and update. **→ Phase 4.8** |

## 3. Reliability

| # | Sev | Finding | Location | Proposed fix |
|---|-----|---------|----------|--------------|
| R1 | **High** | **Two sources of truth for schema.** `_prepare_database()` runs `create_all` plus ~60 raw `ALTER TABLE … IF NOT EXISTS` at import on every boot, mirrored by hand in Alembic revisions. Nothing runs `alembic upgrade`; prod has (probably) no `alembic_version` row. Every new column must be written twice, and the `IF NOT EXISTS` dialect is Postgres-only (SQLite quietly skips it). | `backend/main.py:24-127`, `backend/alembic/versions/*` | Phase 3: startup runs `alembic upgrade head` (env-gated, default on), the boot list is frozen as legacy, prod is stamped once (`alembic stamp 20260916_000013`) as a **manual step**. New work adds *only* Alembic revisions. **→ Phase 3** |
| R2 | **High** | **Assistant pending actions live in process memory.** A Render restart, cold start, or a second worker makes a confirmed action fail with "Pending action is invalid or expired". | `backend/routers/assistant.py:99` | `assistant_pending_actions` table with TTL (additive migration), consumed atomically. **→ Phase 3** |
| R3 | **Medium** | No `/healthz` / `/readyz`; a Render health check would hit `/`, which does not touch the DB. | `backend/main.py:191` | Add both; `readyz` does `SELECT 1` with a short timeout. **→ Phase 3** |
| R4 | **Medium** | Engine has `pool_pre_ping` only: no `pool_size`, `max_overflow`, `pool_recycle`, or `statement_timeout` for Neon's pooler. | `backend/models/database.py:15` | `pool_size=5, max_overflow=5, pool_recycle=300`, `statement_timeout` via `connect_args` (Postgres only). **→ Phase 3** |
| R5 | **Medium** | **Service worker has no update flow.** `skipWaiting()` + `clients.claim()` activate immediately; a deploy mid-session makes lazily-loaded chunks 404 (old `index.html` references old hashes). No "new version available" prompt. | `frontend/public/sw.js:4-14`, `frontend/src/index.tsx:15-22` | Detect `updatefound`, show a toast, reload on accept; catch chunk-load errors and reload once. **→ Phase 2** |
| R6 | **Medium** | `refresh-balance-snapshots` iterates every user in one request and will exceed Render's request timeout as users grow; `process-recurring` commits once at the end of the posting loop. | `backend/routers/cron.py`, `services/jobs.py` | Fan out per user through the job queue; commit per user. **→ Phase 3** |
| R7 | **Medium** | Python version drift: CI 3.13, `nixpacks.toml` says `python310` (Railway leftover, commit `d1fc539`), no `.python-version`; Render's runtime is a dashboard setting (unverifiable here). | `backend/nixpacks.toml`, `.github/workflows/ci.yml:24` | `.python-version` = 3.13, `render.yaml` with `PYTHON_VERSION`, delete `nixpacks.toml`. **→ Phase 3** |
| R8 | **Low** | Rate-limiter state is per-process memory; resets on restart. | `backend/utils/limiter.py` | DB-backed per-account limits cover the auth cases (S4). |
| R9 | **Low** | `exchange_token` creates local accounts *after* committing the Item; a crash in between leaves an Item with no accounts until the background sync adopts them (which it does). | `backend/routers/plaid_router.py:822-856` | None. |

## 4. Performance

| # | Sev | Finding | Location | Proposed fix |
|---|-----|---------|----------|--------------|
| P1 | **Medium** | **Analytics/Overview pull every transaction to the browser** (`fetchAllTransactions`, up to 50 × 1000) and aggregate client-side. Fine for one user; wrong shape for search, budgets and multi-user. | `frontend/src/utils/api.ts:346`, `features/analytics/*` | Keep the client math (tests pin it); new surfaces (search, budgets) get server endpoints. |
| P2 | **Medium** | `GET /transactions?search=` is `ILIKE '%x%'` on `description` only, unindexed; merchant name / notes not searched. | `backend/routers/transactions.py:53` | `pg_trgm` GIN index (migration, no-op on SQLite) and a `/transactions/search` that matches merchant, notes, amount. **→ Phase 4.4** |
| P3 | **Medium** | `recurring_overview` re-runs full detection (800 days of rows) on every page load; `confirm_suggestion` runs it again. | `backend/routers/recurring_transactions.py:139-276`, `services/recurring_detection.py:516` | Cache detection per user keyed on the transactions ETag for a few minutes. **→ Phase 3** |
| P4 | **Low** | Bundle: `main` 140 kB gz + 116 kB Recharts chunk; ≈ 1.43 MB raw JS total. Already route-split. | `frontend/build/static/js/*` | Vite manual chunks + a bundle budget in CI. **→ Phase 2** |
| P5 | **Low** | Backend test suite is slow (577 tests ≈ 10 min locally): every test drops/creates all tables on a file-backed SQLite and every `user` fixture runs bcrypt at 12 rounds. | `backend/tests/conftest.py:73-78`, `utils/auth.py:43` | In-memory SQLite with `StaticPool`, `BCRYPT_ROUNDS` env override (4 in tests), schema once per session. **→ Phase 1 (DX)** |
| P6 | **Low** | `refresh_canonical_defaults` issues one query per canonical merchant. | `backend/services/merchants.py:214` | Single grouped query. **→ Phase 3** |

## 5. Developer experience

| # | Sev | Finding | Location | Proposed fix |
|---|-----|---------|----------|--------------|
| D1 | **High** | CRA (`react-scripts` 5, deprecated), TypeScript 4.9, `@types/node` 16, `user-event` 13; 1 m 36 s production build. | `frontend/package.json` | Vite + TS 5 + Vitest + ESLint flat config. **→ Phase 2** |
| D2 | **Medium** | The test app in `conftest.py` **omits the `loans`, `transfers` and `push` routers**: zero API tests for transfers (a money path) and loans. | `backend/tests/conftest.py:48-62` | Include them; add tests. **→ Phase 1** |
| D3 | **Medium** | CI runs e2e only on `push`, has no bundle budget, no Alembic up/down check, no lint step. | `.github/workflows/ci.yml` | **→ Phase 6** |
| D4 | **Medium** | No `.env.example` on either side; env var names are scattered across code and memory notes. | repo | `backend/.env.example`, `frontend/.env.example`, `docs/DEPLOY.md`. **→ Phase 3 / 7** |
| D5 | **Low** | Repo hygiene: 2 MB `512 icon.png` tracked at root; `brag-output*/` junk (now ignored); stray `*.log` / `e2e_test.db` files (ignored). | repo root | Move or drop the icon in Phase 7. |
| D6 | **Low** | `frontend/README.md` is CRA boilerplate; no root README / ARCHITECTURE / DEPLOY. | docs | **→ Phase 7** |
| D7 | **Low** | Memory/docs drift: the project memory says "never use Vercel rewrites", but the repo *does* proxy `/api/*` through Vercel (commit `90dee45`) with an HTML-response guard in `api.ts` and `no-store` on every API response. The proxy is the current, working design and is what the brief describes. | `frontend/vercel.json`, `frontend/src/utils/api.ts:239-246` | Keep the proxy; memory note corrected in Phase 0. |
| D8 | **Low** | Jest→Vitest surface: 17 files use `jest.*` (118 `jest.fn`, 26 `jest.mock`, 8 mocks of `react-router-dom`, fake timers in 3 files). | `frontend/src/**/*.test.*` | Mechanical port with `vi`. **→ Phase 2** |

## 6. UX / accessibility (from code; the screen audit is Phase 5)

| # | Sev | Finding | Location | Proposed fix |
|---|-----|---------|----------|--------------|
| U1 | **Medium** | Login/Signup inputs are not label-associated (the e2e fixture works around it by placeholder). Lighthouse a11y 0.88 on `/login`. | `frontend/src/pages/Login.tsx`, `Signup.tsx`, `e2e/fixtures.ts:1203` | `htmlFor`/`id` pairs; fixture uses `getByLabel`. **→ Phase 5** |
| U2 | **Low** | `DESIGN.md` tokens drift from `index.css`: `--muted` `#6B7280` vs `#9CA3AF`, `--dim` `#4B5563` vs `#858B96`, `--font-sans` puts the system stack before Geist, radii 8/10/14 vs 10/14/18. The CSS is what ships. | `DESIGN.md`, `frontend/src/index.css:76-120` | Update `DESIGN.md` to the shipped tokens (no visual change). **→ Phase 5** |
| U3 | **Low** | No chunk-load-failure recovery and no global offline indicator beyond queued-mutation UI. | frontend | **→ Phase 2 (with R5)** |
| U4 | **Info** | Existing good, preserve: `:focus-visible` ring, `prefers-reduced-motion` handling, 44 px `--hit-min`, `aria-live` route fallback, privacy mode, ⌘K palette, pull-to-refresh, haptics, safe-area insets, ETag caching, idempotency keys, offline mutation queue, pending-action confirmation. | `frontend/src/index.css`, `components/*` | — |

## 7. Feature inventory vs. Phase 4 (grep results)

| Feature | Exists today? | Notes |
|---------|---------------|-------|
| Budgets | **No** | No model, route, or UI. |
| Auto-categorization rules | **Partial** | Inference exists (`services/transaction_enrichment.py`: merchant-history vote + Plaid PFC map, per-user kill switch). No *user-defined* rules, no preview, no retroactive apply. Build rules as the first tier above inference. |
| Bill alerts | **Partial** | Recurring due / missed / price-rise pushes exist (`services/recurring_bills.collect_alerts`, sent by `/cron/process-recurring`); no user toggles, no "N days before" setting, no low-balance alert. |
| Search & filters | **Partial** | `GET /transactions` supports account/category/type/date/search/amount; the Transactions page filters client-side; ⌘K has navigation/quick actions only. |
| CSV export | **Partial** | `utils/export.ts` (CSV + print) used by Transactions. No import. |
| Split transactions | **No** | No `split` anywhere in models, schemas, or UI. |
| Two-factor auth | **No** | `AccountSection.tsx` explicitly lists "no 2FA and no account deletion". |
| Assistant | Yes | Sonnet 5 / Haiku tiering, 17 read tools, memory, confirmed writes; needs budget / rules / alert tools. |
| Onboarding, landing, legal, export, delete account | **No** | `PRODUCT.md` is single-owner. |

## 8. Baseline measurements

Local Windows 11, Node 24.14.1, Python 3.13.0, 2026-09-17. See `docs/UPGRADE_LOG.md` for the same table with commentary.

| Check | Result |
|-------|--------|
| Backend `pytest tests -q` | 577 tests pass (476 functions, parametrized; SQLite), 9 m 54 s wall time |
| `pip-audit -r requirements.txt` | no known vulnerabilities |
| Frontend `tsc --noEmit` | pass, 21 s |
| Frontend Jest | 45 suites / 973 tests pass, 41 s (act() warnings in Settings tests) |
| Frontend `react-scripts build` | pass, 1 m 36 s; `build/` 8.2 MB on disk |
| Bundle (gzip) | `main` 139.8 kB JS + 12.1 kB CSS; largest lazy chunk 116.3 kB (Recharts); ≈ 1.43 MB raw JS total |
| `audit-ci` (prod deps, high+) | pass; one allow-listed advisory (react-router RSC CSRF, not reachable from a BrowserRouter SPA) |
| Playwright smoke (`npm run e2e`) | 12 passed, 2 m 46 s |
| Lighthouse mobile, `/login`, prod build via `serve` | Performance 91, Accessibility 88, Best Practices 100; FCP 2.7 s, LCP 2.9 s, TBT 20 ms, CLS 0, Speed Index 2.7 s |
