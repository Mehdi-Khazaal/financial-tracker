# Fintrack Upgrade Log

This file is the resumption point. A fresh session must be able to continue from
it alone: read **Status**, then the latest phase entry, then **Next step**.

## Status

- Branch: `fable/upgrade` (created from `main` @ `1843c6d` on 2026-09-17). Never push to `main`.
- Current phase: **Phase 3 complete → Public-launch track (§5 of the brief) next, then Phase 4.**
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
npm run lint && npm run typecheck && npm run test:ci && npm run build && npm run check:bundle
npx audit-ci --config audit-ci.jsonc
CI=1 npx playwright test          # spins up backend :8000 (SQLite) + `vite preview` :3000 on dist/
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

### Next step (done — see Phase 2)

---

## Phase 2 — Frontend foundation: CRA → Vite (2026-09-17) ✅

### What changed
- **Toolchain**: `react-scripts` 5 → **Vite 8.3** (rolldown) + `@vitejs/plugin-react` 6; Jest → **Vitest 5** (jsdom 30); TypeScript 4.9 → **5.9.3**; ESLint flat config (`eslint.config.js`: `@eslint/js`, `typescript-eslint`, `react-hooks` classic rules, `react-refresh`); `@types/node` 24. Removed `http-proxy-middleware`, `@types/jest`, `cross-env`, `web-vitals`, `yaml`, `sharp`, `serve`, `@testing-library/user-event` (all unused or CRA-only). `@playwright/test` 1.48 → 1.63. `package.json` is `"type": "module"`; Tailwind/PostCSS configs are ESM.
- **Entry**: `frontend/index.html` at the root (`%PUBLIC_URL%` gone, `<script type="module" src="/src/index.tsx">`); `public/` is copied verbatim so `sw.js`, `manifest.json`, icons and `robots.txt` keep their paths.
- **Proxy**: `vite.proxy.ts` carries the exact `setupProxy.js` rules (strip `/api`, add the trailing slash on the eight FastAPI collection routes) and is used by both `server.proxy` and `preview.proxy`; its test moved with it (`vite.proxy.test.ts`).
- **Env vars**: `REACT_APP_VAPID_PUBLIC_KEY` → `VITE_VAPID_PUBLIC_KEY` (the only one in use); optional `VITE_DEV_API_TARGET`. Documented in `frontend/.env.example` and `frontend/README.md` (which replaces the CRA boilerplate).
- **Tests ported, none deleted**: 44 Jest suites → Vitest by a mechanical script (`jest.*` → `vi.*`, `jest.requireActual` → `await vi.importActual`, `jest.Mock` → `Mock`) plus hand fixes: `vi.hoisted` for factory-referenced tables in `Settings.test.tsx`, a real object instead of a `Proxy` for the API mock (Vitest builds the namespace from own keys), `{ default }` for component mocks, a `globalThis.jest.advanceTimersByTime` shim in `setupTests.ts` so Testing Library's `waitFor` drives Vitest fake timers, and `mockReset`/`clearMocks` in config to mirror CRA's `resetMocks: true`. **982 tests pass (973 ported + 9 new).**
- **Two real bugs surfaced by jsdom 30's form validation** (it now enforces `required`/`min` on submit like a browser): `EditAccountModal` had `min="0"` on the balance input although the checkbox decides the sign; `AddAssetModal` marked the ticker `required` although name-or-ticker is the rule. Both components fixed; the tests that had only passed because old jsdom skipped validation now pass for the right reason. `TransferModal.test` had a race (asserted before accounts loaded); fixed to wait for the list.
- **SW update flow** (`src/lib/serviceWorker.ts`, `src/components/UpdatePrompt.tsx`): `updatefound` → `installed` with an existing controller (or a waiting worker on load) dispatches `fintrack:sw-update`; the prompt is a Ledger-style toast ("A new version of Fintrack is ready · Reload"). Periodic `registration.update()` every 30 min and on tab focus. `vite:preloadError` reloads once (session-flag guarded) when a lazy chunk 404s after a deploy. `sw.js` cache bumped to `fintrack-v5` so old CRA assets are purged. Unit tests for both.
- **Build output** `dist/`; `vercel.json` sets `framework: vite`, `outputDirectory: dist`, adds the SPA fallback rewrite (after the `/api/*` rules, excluding assets/sw/manifest), `Cache-Control: immutable` for `/assets/*` and `no-cache` for `/sw.js`.
- **Bundle budget** `frontend/scripts/check-bundle.mjs` (`npm run check:bundle`): initial JS ≤ 150 kB gz, total JS ≤ 520 kB, largest chunk ≤ 140 kB, CSS ≤ 32 kB. Enforced in CI.
- **CI** (`.github/workflows/ci.yml`): Node 24, pip/npm caching, `lint` + `typecheck` + `test:ci` + `build` + `check:bundle` + `audit-ci`; Alembic `upgrade head → downgrade base → upgrade head` on SQLite in the backend job; e2e now runs on **pull requests too**, reuses the uploaded `dist/` and tests `vite preview` (the real bundle) instead of a dev server; concurrency cancels superseded runs.

### Before / after

| Metric | CRA (Phase 0) | Vite (Phase 2) |
|---|---|---|
| Production build | 1 m 36 s | **2.3 s** |
| Unit tests | 973 in 41 s (Jest) | 982 in ~25 s (Vitest) |
| Type-check | 21 s | ~18 s |
| Initial JS (gzip, what `/login` downloads) | 140.0 kB | **131.3 kB** |
| Total JS (gzip) | ≈ 430 kB | 372 kB |
| Largest chunk (gzip) | 116 kB (Recharts) | 132 kB (`AnalyticsTab` incl. Recharts) |
| CSS (gzip) | 15.8 kB | 14.5 kB |
| Lighthouse mobile `/login` (Perf / A11y / BP) | 91 / 88 / 100 | 91 / 88 / 96 |
| FCP · LCP · TBT · CLS · SI | 2.7 s · 2.9 s · 20 ms · 0 · 2.7 s | 2.4 s · 3.0 s · 30 ms · 0 · 2.4 s |
| Playwright smoke | 12 pass (dev server) | 12 pass (`vite preview`) |

Lighthouse Best Practices dropped 4 points only because `vite preview` (unlike the `serve` run) proxies `/api/auth/me` to a backend that was not running, which logs a console error; on Vercel the headers and backend are present. Accessibility 88 is the pre-existing login-form labelling (AUDIT U1, Phase 5).

### Decisions and reasoning
1. **TypeScript 5.9, not 7.** `typescript@latest` is 7.0.2 (the native compiler). The brief says 5.x; `typescript-eslint` 8.70 and Vite's plugin are validated against 5.x; adopting 7 is a one-line bump later once the ecosystem catches up.
2. **Vite 8 / Vitest 5 (latest)** as the brief asks. One rolldown-specific lesson: the `manualChunks` compat layer pulled shared helpers into the vendor chunks and made the entry *preload* Recharts and markdown (initial JS 272 kB). Removing manual chunks restored the natural lazy graph (131 kB). The budget script exists so this cannot regress silently.
3. **e2e against `vite preview`** rather than the dev server: it tests the deployed artefact, starts in a second, and lets CI reuse the build artefact.
4. **`react-hooks` 7's compiler-era rules are off** (`set-state-in-effect`, `refs`, …): they flag ~40 existing call sites. Turning them on is a Phase 5 code-quality decision, not a tooling side effect. `no-unused-vars` is a warning, as under CRA.
5. **Kept the hand-written `sw.js`** instead of `vite-plugin-pwa`/Workbox: it is small, understood, and the brief says keep it working exactly as before. The update prompt is layered on top of it.
6. **SPA fallback rewrite added** to `vercel.json`: the CRA preset did this implicitly; the Vite preset does not.

### Skipped / deferred
- No Vercel preview push yet — the branch is pushed at the end of Phase 3 together with the backend changes, so the first preview exercises both. (Manual step remains: rename the Vercel env var to `VITE_VAPID_PUBLIC_KEY`.)
- `@testing-library/user-event` was unused and removed rather than upgraded.
- The two remaining lint warnings are pre-existing unused variables in `merchantIdentity.test.ts`.

### Next step (done — see Phase 3)

---

## Phase 3 — Backend architecture & reliability (2026-09-17) ✅

Commits: `331b99b` ops groundwork · `17843ce` Plaid split · `86a68fc` assistant split · `a46c2b3` pending actions in DB · `2af415d` Alembic at boot + observability · detection cache (this commit).

### What changed
- **Two packages, zero behaviour change.** `routers/plaid_router.py` (1,540 lines) → `routers/plaid_router/` (`__init__` facade 130 lines + `models`, `schemas`, `sync`, `items`, `diagnostics`, `webhook`); `routers/assistant.py` (1,994 lines) → `routers/assistant/` (`__init__` facade + `helpers`, `tools`, `routing`, `schemas`, `prompt`, `pending`, `usage`, `conversations`, `chat`). Every function body was moved verbatim by a script; the route tables were diffed before/after (13 and 8 routes, identical paths and methods); pyflakes reports no undefined names; the full suite passed unchanged at each step. The facade pattern (`facade.<name>` late binding) keeps the 38 existing `monkeypatch.setattr(plaid_router, "_plaid_post", …)` sites working and is documented in each package docstring.
- **Health**: `GET /healthz` (process only) and `GET /readyz` (`SELECT 1`, 503 when the DB is down). `render.yaml` points the health check at `/healthz`.
- **Runtime alignment**: `backend/.python-version` = 3.13; `nixpacks.toml` (Railway leftover) deleted; `render.yaml` blueprint declares runtime, build/start commands, health check and every env var name (values `sync: false`).
- **Neon-friendly engine** (`models.database.engine_options`): `pool_size 5`, `max_overflow 5`, `pool_recycle 300 s`, `pool_timeout 10 s`, `pool_pre_ping`, libpq `connect_timeout 10`, `statement_timeout 15 s`, TCP keepalives; all `DB_*` env-overridable; SQLite untouched.
- **Alembic is now authoritative** (`utils/migrations.py`, run at import in `main.py`): fresh DB → `upgrade head` builds it; stamped DB → `upgrade head`; **unstamped DB with tables (production today) → untouched, a WARNING names the one-time `alembic stamp <head>` command, and the legacy boot-time repairs keep running**. A migration error is logged and falls back to the legacy path rather than failing boot. `RUN_MIGRATIONS_ON_BOOT=false` disables it. Alembic is driven without `alembic.ini` in-process so its logging config cannot replace ours (and `env.py` no longer silences existing loggers for the CLI either).
- **Migration chain repaired**: the three assistant tables had only ever been created by `create_all`; revision `20260917_000016` adds them (guarded, no-op where they exist) so a Postgres database can be built from the chain alone. Pending actions moved to revision `000017`. Verified `upgrade head → downgrade 000015 → upgrade → downgrade base → upgrade` on a scratch local Postgres (25 tables at head) and on SQLite; the boot switch has 5 unit tests.
- **Pending assistant actions persist** (`assistant_pending_actions`, AUDIT R2): token stored as SHA-256, consumed exactly once via a `consumed_at IS NULL` guarded update; 400 for unknown/expired/used, 404 for another user's; pruned by the hourly cron. 6 tests including exactly-once through `/execute`.
- **Observability, all env-gated**: `LOG_FORMAT=json` switches to one JSON object per line with `kv()` pairs lifted to fields; `RequestIdMiddleware` honours a sane `X-Request-ID` or mints one, echoes it, attaches it to every log line via a contextvar, and writes one `http_request` access line per request (health probes at DEBUG); `SENTRY_DSN` enables `sentry-sdk[fastapi]` with PII off and tracing off by default. Frontend: `VITE_SENTRY_DSN` lazily loads `@sentry/browser` (a separate 142 kB gzip chunk that is never fetched without a DSN). 8 tests.
- **Cron resilience**: snapshot refresh commits per user, isolates one user's failure, and stops at a 20 s budget (`CRON_TIME_BUDGET_SECONDS`) reporting `remaining` so Render's 30 s limit cannot kill it mid-user. Prune job also clears pending actions.
- **Detection cache** (AUDIT P3): `recurring_detection.detect_cached` reuses the per-user result while a fingerprint over transactions/bills/dismissals/accounts is unchanged (5 min TTL, bounded to 500 users). Used by `/recurring/overview` and `confirm`. 5 tests, including invalidation on a new transaction and on a dismissal.
- **Query budgets** (`tests/test_query_counts.py`): ceilings for the ten hot read paths on a 300-transaction ledger, so an N+1 fails CI.

### Query counts (300 transactions, 3 accounts, 5 bills, 2 goals; auth lookup included)

| Endpoint | Before | After |
|---|---|---|
| `/accounts/` | 4 | 4 |
| `/transactions/?limit=500` | 3 | 3 |
| `/categories/` | 3 | 3 |
| `/savings-goals/` | 5 | 5 |
| `/history/net-worth?months=12` | 6 | 6 |
| `/history/accounts?months=6` | 4 | 4 |
| `/recurring/` | 6 | 6 |
| `/recurring/overview` cold | 16 | 20 (+4 fingerprint aggregates) |
| `/recurring/overview` warm | 16 + full detection pass in Python | ≤ 15, no detection pass |
| `/loans/`, `/assets/` | 2, 4 | 2, 4 |

No N+1 was found on the hot read paths: every list endpoint is one query plus the ETag aggregate. The remaining cost on `/recurring/overview` is inherent (reconcile + month figures + detection), and detection is now cached. No new indexes were added — the composite `(user_id, transaction_date)` index from `000012` already serves every hot query's filter and sort; a new index would have been speculative without Postgres `EXPLAIN` data, which Phase 6 can gather from a preview environment.

### Decisions and reasoning
1. **Facade + late binding over a "clean" import graph.** A textbook split would have broken every monkeypatch target in the suite and forced rewriting 40+ tests — the very tests that prove the split changed nothing. The facade costs one indirection per call and buys an unchanged test suite.
2. **Migrations at boot, not in a build step.** Render Free has no pre-deploy hook; running at import keeps one code path for Render, local and CI. The unstamped-database branch is what makes this safe to deploy today: production behaves exactly as before until you run `alembic stamp` once (see the final checklist).
3. **The legacy `_prepare_database` list stays**, frozen, as the fallback. Deleting it is a Phase 7 follow-up after production is stamped.
4. **`sentry-sdk` and `@sentry/browser` are the two new dependencies**: official SDKs, actively maintained; the frontend one is 142 kB gzip but lazy and DSN-gated, so users of a build without a DSN download nothing extra. The bundle budget's per-chunk limit was raised 140 → 150 kB with that rationale in the script.
5. **Snapshot refresh keeps doing the work in the cron request** (with a time budget) rather than fanning out through the job queue, because the queue depends on `/cron/run-jobs` being scheduled externally and I cannot verify that it is. Fan-out is a one-line change later.
6. **Logger names changed** for code that moved (`routers.plaid_router.sync` etc.). Log *messages* and fields are byte-identical; nothing parses logger names.

### Checks
- Backend: **725 passed** (~28 s). `pip-audit`: clean after adding `sentry-sdk`.
- Frontend: lint clean (2 pre-existing warnings), 985 Vitest tests, build 1.2 s, bundle within budget (initial 131.8 kB, total 515 kB, largest 142 kB), Playwright 12/12 against `vite preview` with the new backend boot path (fresh SQLite is initialised by Alembic).

### A bug the e2e suite caught before production did
The first Playwright run after wiring migrations at boot failed to start the backend: `ImportError: cannot import name 'command' from 'alembic'`. With `backend/` as the working directory (exactly how Render and uvicorn run it), the `backend/alembic/` *folder* shadowed the installed `alembic` package. It never mattered before because nothing imported Alembic at runtime. The folder is now `backend/migrations/` (`alembic.ini` `script_location` updated; the CLI is unchanged), the boot switch imports Alembic lazily and reports `unavailable` — falling back to the legacy path — if the package is missing, and the boot path is smoke-tested with the system interpreter from `backend/`.

### Skipped / deferred
- Job-queue fan-out for snapshots (see decision 5).
- Deleting the legacy boot repairs (after production is stamped).
- Postgres `EXPLAIN`-driven index work (Phase 6, needs a preview DB).

### Next step
**Public-launch track (§5)**: tenant-isolation proof extended to jobs, cron, push and assistant tools; onboarding flow; data export (JSON + CSV) and self-serve deletion (with Plaid `/item/remove` and push cleanup); draft Privacy/Terms pages; per-user assistant caps + admin usage view; landing page at `/` for logged-out visitors; `PRODUCT.md` update. Then Phase 4 features in order.
