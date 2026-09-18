# Fintrack Upgrade Log

This file is the resumption point. A fresh session must be able to continue from
it alone: read **Status**, then the latest phase entry, then **Next step**.

## Status

- Branch: `fable/upgrade` (created from `main` @ `1843c6d` on 2026-09-17). Never push to `main`.
- Current phase: **All phases complete.** PR #1 (https://github.com/Mehdi-Khazaal/financial-tracker/pull/1) `fable/upgrade` → `main` is open and not merged. See the Final report at the end.
- **Production stamp: `alembic stamp 20260916_000013` (the baseline), never head — see Phase 6.**
- Branch is pushed to `origin/fable/upgrade` (CI + Vercel preview run on every push).
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
- **Alembic is now authoritative** (`utils/migrations.py`, run at import in `main.py`): fresh DB → `upgrade head` builds it; stamped DB → `upgrade head`; **unstamped DB with tables (production today) → untouched, a WARNING names the one-time stamp command, and the legacy boot-time repairs keep running** *(corrected in Phase 6: the command is `alembic stamp 20260916_000013`, not head)*. A migration error is logged and falls back to the legacy path rather than failing boot. `RUN_MIGRATIONS_ON_BOOT=false` disables it. Alembic is driven without `alembic.ini` in-process so its logging config cannot replace ours (and `env.py` no longer silences existing loggers for the CLI either).
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

### Next step (done — see the public-launch track)

---

## Public-launch track (§5 of the brief) (2026-09-17) ✅

Commits: `d091d07` chain fix + isolation proof for jobs · launch controls (backend) · launch surfaces (frontend, this commit).

### What changed
- **Tenant isolation beyond HTTP** (`tests/test_tenant_isolation_jobs.py`): two users with a full ledger each; cron posting touches only the due user's bill and balance; snapshot refresh writes per user; the job dispatcher handles each payload with only its own user's rows; `send_push_to_user` reaches only the addressed user's devices; cron alerts go only to the user they concern; every assistant read tool called as user B never sees user A's markers; the live context and system prompt are per user. Together with `test_tenant_isolation.py` (50 route cases) this is the zero-cross-visibility proof.
- **Migration chain completed and pinned** (revisions `000016` assistant tables, `000018` `users.timezone`; `tests/test_schema_chain.py` fails if the ORM ever gains a table or column the chain lacks). Found because the fresh e2e database could not sign a user up.
- **Signup protection**: `SIGNUPS_ENABLED=false` closes registration (403); `SIGNUP_INVITE_CODE` requires an invite code in the signup body (constant-time compare). `GET /auth/signup-policy` is public so the sign-up page explains itself: closed notice + disabled button, or an invite field.
- **Email verification gate** (`REQUIRE_EMAIL_VERIFICATION=true`, default off): unverified users get `403 {code: email_unverified}` on data routes; `/auth/*`, `/account/delete` and health stay open. `POST /auth/resend-verification` (3/hour). Frontend: the API client dispatches `fintrack:verification-required`; `VerificationGate` renders a full-screen Ledger-style card with resend, "check again", and sign out; it dismisses itself once the session says verified.
- **Assistant cost controls**: `assistant_usage_daily` (revision `000019`) records turns and estimated cost per user per *their* calendar day; `ASSISTANT_DAILY_TURN_CAP` (150) and `ASSISTANT_DAILY_COST_CAP_USD` (3.00) are enforced **before** the model is called (429, 0 disables); every turn is recorded whatever the reply. `GET /admin/usage?days=` gives per-user turns/cost; Settings → Admin shows it as a table with the caps.
- **Account lifecycle** (`routers/account.py`): `GET /account/export` (every table as JSON, money as decimal strings, versioned) and `GET /account/export/transactions.csv` (spreadsheet-safe: formula-leading cells are quoted); `POST /account/delete` needs the password and the literal `DELETE`, removes Items at Plaid first (best effort, counted and reported), clears lockout counters, deletes the user (every table cascades — verified in tests: accounts, transactions, push subscriptions, Plaid items), clears cookies. Rate-limited. Settings → Account has "Your data" (Export JSON / CSV) and a guarded "Delete account" form; on success it signs out and lands on `/`.
- **Legal pages** `/privacy` and `/terms` (public, draft-bannered, Ledger typography, one column at 390 px) linked from the signup form, the landing footer and Settings → Account. Content names the real processors (Plaid, Anthropic, Neon, Render, Vercel, Resend, Sentry, CoinGecko/Yahoo) and the real controls (export, disconnect, delete, forget memory).
- **Landing page** at `/` for a signed-out visitor (`HomeRoute` renders `Landing` or `Dashboard`; no more bounce to `/login`): hero question in DM Serif, an example hero card labelled as an example, four feature blocks (Ledger, Banks, Recurring, Fin), a trust row, footer. No images, no new dependencies; lazy-loaded so the app bundle is untouched.
- **`PRODUCT.md`** now describes the two kinds of user, the multi-user rules, and principle 6 ("Nothing happens without you").

### Checks
- Backend: **748 passed**. Migration chain round-tripped on Postgres up to `000019`.
- Frontend: **999 Vitest tests** (52 files), typecheck and lint clean; build, bundle budget and Playwright run at the end of this commit (see next entry if anything changed).

### Decisions and reasoning
1. **Onboarding's budget step is deferred to Phase 4.1**, because Budgets do not exist yet; the onboarding flow will be built together with it so the step is real rather than a placeholder. The rest of the brief's onboarding (create first account or connect a bank, default categories) already exists at signup and on the empty Overview.
2. **Deletion does not wait for Plaid.** A failed `/item/remove` is logged, counted and shown to the user ("could not be removed at Plaid; it will expire on its own") rather than blocking deletion — a person leaving must be able to leave.
3. **Caps are per user-local day** so the reset happens at their midnight, consistent with every other date rule in the backend.
4. **Verification is opt-in per deployment.** The owner's own account may be unverified today (the flag exists but was never enforced); turning enforcement on is a manual step listed in the final checklist, after verifying the operator's address.
5. **Invite code over CAPTCHA**: one env var, no third party, and exactly right for a private beta.

### Next step (done — see Phase 4.1)
**Phase 4.1 — Budgets**: model + migration (`budgets`: user, category, monthly amount, rollover flag, effective month), `/budgets` CRUD, a `/budgets/progress?month=` read that returns spent/remaining per budget from the ledger, over-budget push (once per budget per month, via the nightly cron), Overview and Analytics progress surfaces, onboarding budget step, assistant read tool. Then rules, alerts, search, CSV import, splits, 2FA, assistant upgrades.

## Phase 4.1 — Budgets (2026-09-17) ✅

Commit: `cbc8070` feat(budgets).

### What changed
- **Model + migration**: `budgets` table (revision `20260917_000020`, additive, reversible; unique per user × category; `amount Numeric(15,2)`, `rollover`, `starts_on`, `is_active`, `notified_month`). `test_schema_chain.py` keeps the chain pinned to the ORM.
- **Service** (`services/budgets.py`): month maths (`parse_month`, `month_end`, `add_months`), one-query spend per category per month (expenses negative, refunds net), `progress_for_month` with rollover that carries **unspent only** (an overspend never reduces next month), `notify_over_budget` (once per budget per month via `notified_month`, push tag `budget-{id}-{month}`, deep-links to Analytics).
- **API** (`routers/budgets.py`): `GET/POST /budgets/`, `PUT/DELETE /budgets/{id}`, `GET /budgets/progress?month=YYYY-MM` (ETag over budgets + transactions). Expense categories only; duplicates are 409; money in and out as decimal strings.
- **Triggers**: over-budget push runs after every Plaid sync (`_notify_budgets` in `plaid_router/sync.py`) and nightly via `POST /cron/check-budgets`.
- **Assistant**: `list_budgets` read tool (also a quick tool), so Fin can answer "how am I doing on groceries?" without a write.
- **Frontend**: `BudgetsCard` on Overview (worst first, ember/amber/red only where a decision changes, pace verdict against the calendar), `BudgetProgressCard` on Analytics (follows the month picker: other months fetch on demand), `BudgetsSheet` (add with expense-category select + rollover, inline amount edit, rollover toggle, confirmed delete), ⌘K "Set a budget" quick action, and the **first-run `SetupChecklist`** on Overview (account → categories → budget; per-user localStorage for the two flags data cannot infer; hides itself when done or dismissed). `/budgets` added to the dev proxy collection list and the Vercel rewrites.
- **Bundle budget**: total gz raised 520 → 600 kB with the reason in the script (lazy Sentry + public pages are counted but rarely fetched); initial JS is 136 kB / 150.

### Checks
- Backend: **760 passed** (11 new in `test_budgets.py`: CRUD, expense-only, duplicate, progress maths incl. rollover and refunds, once-per-month push, isolation, assistant tool).
- Frontend: **1016 Vitest tests** (56 files; new: `budgets.test.ts`, `BudgetsCard.test.tsx`, `BudgetsSheet.test.tsx`, `SetupChecklist.test.tsx`), tsc clean, lint 2 pre-existing warnings, build ok, bundle within budget.
- Playwright: **13/13** (new `7-budgets.spec.ts`: set from the Overview card, see this month's spend in the sheet, remove with confirmation).

### Decisions and reasoning
1. **No "budget period" beyond monthly.** Every date rule in the app is monthly and user-local; a weekly/annual budget would need its own carry rules for little gain in a v1.
2. **Rollover carries unspent only.** Carrying an overspend forward turns one bad month into a red bar for the rest of the year and teaches people to delete the budget. The sheet says so in one line.
3. **Colour changes where decisions change** (90 % amber, over red), not on the credit-card utilisation scale — a third of a budget gone by the tenth is fine.
4. **Onboarding is a checklist, not a wizard**: it sits on Overview, uses live data for two of three steps, and disappears; nothing is gated behind it.
5. **Assistant budget payloads stay floats** like every other assistant tool result (documented deviation from decimal strings; the API itself is strings).

### Next step (done — see Phase 4.2)
**Phase 4.2 — Auto-categorization rules**: `categorization_rules` (user, match field — merchant/description contains or regex —, category, priority, active), applied at Plaid sync and manual create; a preview endpoint that shows which existing transactions a rule would hit; optional retroactive apply (idempotent, only uncategorised or same-source rows); Settings → Rules UI with preview; assistant read tool; tests first for the sync path. Then alerts, search, CSV import, splits, 2FA, assistant upgrades.

## Phase 4.2 — Auto-categorization rules (2026-09-17) ✅

Commit: `103d66f` feat(rules).

### What changed
- **Model + migration**: `categorization_rules` (revision `20260917_000021`; user, category, `field` description|merchant, `match_type` contains|regex, `pattern` ≤200 chars, `priority`, `is_active`, `applied_count`). Round-tripped up → down (to 000019) → up on SQLite and on a scratch database on the local Postgres server.
- **Precedence** (`services/transaction_enrichment.py`): explicit category on the write > **rule** > merchant history > Plaid PFC. A rule is an instruction, so it runs even when the user's automatic-categorization preference is off; it never touches a category the user set on a transaction. Source marker `"rule"`. `MerchantIdentity` now carries the raw description so description rules see the original text.
- **Service** (`services/categorization_rules.py`): validation (bad field/type, empty, too long, invalid regex → 422 with the reason), compile once per session (cache on `session.info`, so sync is one query per user not per row), `first_match` in priority order, `preview` (matched / would change / protected-by-hand counts + a sample, scans the most recent 5000 rows), `apply_to_past` (idempotent: rows already at the category and hand-filed rows are skipped; only `category_id` moves, balances untouched).
- **API** (`routers/rules.py`): `GET/POST /rules/`, `PUT/DELETE /rules/{id}`, `POST /rules/preview` (unsaved draft, read-only), `POST /rules/{id}/apply`. ETag on the list. Category ownership enforced (404 for another user's category).
- **Category delete** now removes that category's budgets and rules explicitly, so the behaviour is the same on a database that does not enforce foreign keys.
- **Export** includes `budgets` and `categorization_rules`.
- **Assistant**: `list_rules` read tool (quick tier too) so Fin can explain why something was filed where it was.
- **Frontend**: Settings → **Rules** section (priority-ordered list in plain words, row menu: Edit / Apply to past / Pause / Remove), `RuleFormSheet` with a **live preview** (debounced, stale responses ignored, server reasons shown against the pattern field), `useRules` hook, `linkToNewRule(pattern, categoryId?)` deep link, and an **"Always file “…” as… →"** entry point on the transaction sheet that opens the rules sheet prefilled. `/rules` added to the dev proxy collection list and Vercel rewrites — and a proxy test now pins every collection route, because a missing entry produced a 307 to the backend's own origin that silently dropped the cookie and body (the rules sheet saved nothing until it was listed).

### Checks
- Backend: **778 passed** (18 new in `test_categorization_rules.py`: matching, regex/merchant, validation, precedence over history and PFC, preference-off, explicit category still wins, manual entry via the ledger, session cache, **Plaid sync path files by rule before PFC**, CRUD/validation, preview counts, idempotent apply that never touches hand-set rows and leaves balances alone, tenant isolation for rules/preview/apply, category delete cascade, assistant tool).
- Frontend: **1021 Vitest tests** (57 files; new `RulesSection.test.tsx` 5 tests, proxy regression test), tsc clean, lint 2 pre-existing warnings, bundle 137 kB initial / 532 kB total.
- Playwright: **14/14** (new `8-rules.spec.ts`: deep link prefills the sheet, preview counts two past rows, save, apply to past from the row menu, both rows now `category_source == "rule"`).

### Decisions and reasoning
1. **Rules bypass the automatic-categorization switch.** That switch governs Fintrack's guesses; a rule is the user's own instruction. Documented in the module docstring and pinned by a test.
2. **Apply-to-past never touches `category_source == "user"`.** A rule cannot know better than the person who filed that row by hand; the preview shows those as "filed by hand, left alone" so the count is never a surprise.
3. **No amount conditions in v1.** Description/merchant covers the real cases (subscriptions, employers, stores); amount ranges are a separate feature with their own UI and were left for later rather than half-built.
4. **Regex is allowed but bounded**: 200-character cap, case-insensitive search, compiled once per session, preview scan capped at 5000 rows. No regex timeout exists in Python's `re`; the bounds are the protection.
5. **The transaction sheet is the primary entry point**, because that is where a misfiled row is discovered; the Settings list is for management.

### Next step (done — see Phase 4.3)
**Phase 4.3 — Bill & low-balance alerts**: per-user alert preferences (`bill_reminders`, `low_balance`, `budget_alerts` toggles + low-balance threshold), nightly cron that pushes "bill due in N days" for tracked recurring bills and "balance below threshold" once per account per day, Settings → Preferences toggles wired to real behaviour (the section's docstring says an inert toggle is a lie — these must be honoured server-side), tests first for the cron paths. Then search & filters in ⌘K, CSV import/export, splits, 2FA, assistant upgrades.

## Phase 4.3 — Bill & low-balance alerts (2026-09-17) ✅

Commit: `6af22f0` feat(alerts).

### What changed
- **Alert preferences** on `user_preferences` (revision `20260917_000022`, additive with server defaults): `bill_reminders_enabled` (default on), `budget_alerts_enabled` (default on), `low_balance_alerts_enabled` (default **off**), `low_balance_threshold` (Numeric, default 100.00). Defaults are exactly what shipped, so the migration changes nothing for anyone. `accounts.low_balance_notified_on` (nullable date) carries the once-per-dip state.
- **Gates honoured server-side**: the nightly `/cron/process-recurring` skips `collect_alerts` for a user with bill reminders off **without marking anything as sent**, so switching them back on resumes at the next cycle; `notify_over_budget` (post-sync and nightly) returns early with budget alerts off and leaves `notified_month` untouched.
- **Low balance** (`services/alerts.py`): checking/savings/cash only; once per dip (set the marker when sent, clear it when a later check finds the balance ≥ threshold), so a balance that stays low is announced once; overdrawn wording when negative; `POST /cron/check-balances` nightly (only opted-in users are even queried) and a post-sync hook `_notify_balances` in `plaid_router/sync.py`, isolated like the budget hook. When the alert is off nothing is marked, so switching it on announces anything currently low on the next check.
- **API**: `GET/PATCH /preferences` carry the four fields; threshold is a decimal string in and out (`ge=0`, non-numeric → 422). Export includes them.
- **Frontend**: Settings → Preferences gained an **Alerts** card (Bill reminders / Budget alerts / Low balance alerts switches, and a "Warn me below" decimal field that appears when low-balance is on, saved on blur or Enter as the typed string). The alert settings ride on the same `/preferences` request as the automation switch (`useAutomationPreference` now exposes `alerts`, `toggleAlert`, `setThreshold`) so the section still makes one read. The section's own rule — no inert toggles — holds: every switch changes what the server sends.

### Checks
- Backend: **787 passed** (8 new in `test_alerts.py`: defaults, decimal threshold + validation, bill reminders skipped-and-unmarked when off then resumed, budget alerts likewise, low-balance once-per-dip / re-arm / overdrawn wording, threshold and account-type filter, off marks nothing, cron covers only opted-in users and needs the secret, sync hook). `test_preferences` key-set test updated for the new fields.
- Frontend: **1025 Vitest tests** (57 files; 3 new Settings tests: switches read saved values with server defaults for absent fields, a switch saves and reports, the threshold saves as the typed string and rejects a non-amount), tsc clean, lint 2 pre-existing warnings, bundle 137 kB initial / 533 kB total.
- Playwright: **14/14**. Migration chain: up → down to 000020 → up on SQLite and on a scratch database on the local Postgres server.

### Decisions and reasoning
1. **Once per dip, not once per day.** A nightly "still low" push trains people to disable the alert. The marker re-arms on recovery, so the next real dip is announced.
2. **Low balance defaults off.** It is new behaviour; a preference that defaults to a change in behaviour would notify everyone on deploy.
3. **Turning an alert off marks nothing.** Otherwise switching it back on would silently skip the current cycle/month/dip.
4. **No reminder-days setting yet.** `REMINDER_DAYS` in `recurring_bills` is the existing window; making it per-user is cheap later and was not asked for.
5. **Credit cards and investments are not watched** for low balance: neither balance means "running out of money".

### Next step (done — see Phase 4.4)
**Phase 4.4 — Search & filters**: a `/transactions/search` (or extended `GET /transactions` params: `q`, `category_id`, `account_id`, `amount_min/max`, `date_from/to`, `uncategorized`) with an index plan, a filter bar on the Transactions page, and ⌘K "Search transactions…" that jumps into the timeline with the query applied. Then CSV import/export, splits, 2FA, assistant upgrades.

## Phase 4.4 — Search & filters (2026-09-17) ✅

Commit: `5c80431` feat(search).

### What changed
- **Server search widened** (`GET /transactions?search=`): matches the description, Plaid's merchant name and the normalised merchant key, case-insensitively, with `%`/`_` in the input treated literally and a 100-character cap. New `uncategorized=true` filter composes with everything else. The assistant's `list_transactions` uses the same clause. `TransactionResponse` now includes `plaid_merchant_name` so the client can match the same fields.
- **Timeline search box** on the Transactions page (list tab), applied as typed over the in-memory ledger; it lives in the same filter set as the panel, so the active-filter badge, "Clear" and exports all treat it as a filter. Logic extracted to `features/transactions/calculations/filters.ts` (`matchesQuery`, `applyTransactionFilters`) with tests; the page's inline filter lambda is gone.
- **⌘K search**: whatever is typed gets a "Search transactions for “…”" entry — first when no command matches (replacing the dead "No results" state), last otherwise so Enter still runs the command being reached for. It deep-links to `/transactions?tab=list&q=…` via `linkToTransactionSearch`; the page consumes `q` on arrival like its other deep-link parameters.

### Checks
- Backend: **792 passed** (5 new in `test_transaction_search.py`: three-field match, literal wildcards + length cap, uncategorized × search, tenant isolation, assistant parity).
- Frontend: **1031 Vitest tests** (59 files; new `filters.test.ts`, `CommandPalette.test.tsx`), tsc clean, lint 2 pre-existing warnings, bundle within budget.
- Playwright: **15/15** (new `9-search.spec.ts`: palette → typed query → timeline shows only the match).

### Decisions and reasoning
1. **Client-side matching for the page, server-side for the API.** The page already holds the whole ledger (paged in since Phase 2's fix), so a round trip per keystroke would only add latency; both sides match the same three fields so results agree.
2. **No trigram index.** `ILIKE '%x%'` cannot use a b-tree; `pg_trgm` would need `CREATE EXTENSION` on Neon, which is a manual production step. At current volumes the per-user date index bounds the scan; noted for the ops checklist rather than done blind.
3. **Search rides on the existing filter state** instead of a parallel mechanism, so nothing on the page has two ideas of "what is shown".

### Next step (done — see Phase 4.5)
**Phase 4.5 — CSV import & filtered export**: `POST /transactions/import/preview` (parse, column mapping suggestions, per-row validation, duplicate detection against existing rows by date+amount+description/merchant key) and `POST /transactions/import` (idempotent via the file hash + row fingerprint; balances moved through the ledger service), a Settings/Transactions import sheet with mapping UI and a preview table, and export that honours the active filters (already exports the current view — verify and extend to the server CSV with the same params). Then splits, 2FA, assistant upgrades.

## Phase 4.5 — CSV import & filtered export (2026-09-17) ✅

Commit: `de2e965` feat(import).

### What changed
- **Import service** (`services/csv_import.py`): sniffs the delimiter, strips a BOM, caps the file at 400 KB (under the idempotency middleware's 512 KB body cap, so an import is always replay-protected) and 5000 rows; suggests a column mapping from header words (date / amount, or debit + credit / description / category); parses amounts in every common shape (`-12.50`, `(12.50)`, `$1,200.00`, `1.234,56`, `12,50`) straight to `Decimal`; parses ISO, month-first, day-first and written dates with an explicit override; records per-row problems instead of failing the file; flags duplicates by (date, amount, merchant key) against the account's existing rows in the file's date range **and** within the file.
- **API** (`routers/transaction_import.py`): `POST /transactions/import/preview` (writes nothing), `POST /transactions/import` (every valid, non-duplicate row staged through `LedgerService.stage_transaction` and committed once — enrichment, rules and atomic balance moves exactly as for typed entries; a category column is honoured only when it names one of the user's categories, never auto-created), `DELETE /transactions/import/{batch_id}` (undo: new `LedgerService.stage_delete` reverses each balance and removes the batch in one commit). Rate-limited. Rows carry `transactions.import_batch_id` (revision `20260917_000023`, nullable + index; round-tripped on SQLite and a local scratch Postgres).
- **Filtered export**: `GET /account/export/transactions.csv` accepts the same filters as the list (`account_id`, `category_id`, `date_from/to`, `search`, `uncategorized`); still formula-safe. The Transactions page's own CSV/PDF export already follows the active filters and search.
- **Frontend**: `ImportSheet` (file → account → mapping selects, date order, "money out is positive" flip, include-duplicates option, preview table with per-row reason, import, result with **Undo this import**), reachable from Transactions → Add → Import CSV, the `?import=1` deep link (`linkToImport`) and ⌘K "Import transactions from CSV".
- **Foreign keys enforced on SQLite** (test harness and the app engine when it runs on SQLite, i.e. the e2e backend). Account deletion relies on `ON DELETE CASCADE`; SQLite ignores that unless asked per connection, so the deletion test only passed when an earlier test had flipped the pragma on the pooled connection. The suite now behaves like Postgres regardless of order; all 803 backend tests pass with enforcement on.

### Checks
- Backend: **803 passed** (11 new in `test_csv_import.py`: amount/date shapes, mapping suggestions, delimiter sniffing and bad files, preview normalisation + duplicate flags + writes nothing, mapping/date-order/flip/debit-credit, import through the ledger with balance check + re-import all duplicates + undo restores the balance exactly, rules and category column on import, Idempotency-Key replay, cross-tenant account rejected, filtered server export).
- Frontend: **1036 Vitest tests** (60 files; `ImportSheet.test.tsx` 5 tests incl. a regression for the result panel surviving the page's account reload), tsc clean, lint 2 pre-existing warnings, bundle within budget.
- Playwright: **16/16** (new `10-import-csv.spec.ts`: file → preview → import → rows and balance via API → undo).

### Found and fixed on the way
- The sheet's reset effect depended on the `accounts` prop, so the page reloading its accounts after an import wiped the result and its Undo button. It now resets on open only; accounts arriving late still preselect the single account.
- Batch undo compounded balance deltas on an unflushed expression; `stage_delete` flushes each step so the stored balance is exact.

### Decisions and reasoning
1. **Text in JSON, not multipart.** The offline queue and the Idempotency-Key middleware both work on JSON bodies; a retried import cannot post twice.
2. **Duplicates skipped by default, never silently**: the preview counts them and the user can include them.
3. **Unknown category names are not created.** An import must not grow the category list behind the user's back; rules and history still apply.

### Next step (done — see Phase 4.6)
**Phase 4.6 — Split transactions**: a `transaction_splits` child table (transaction, category, amount, note) whose amounts must sum exactly to the parent; the parent keeps the account balance effect (splits never move money), analytics/budgets attribute spending per split; API to set/clear splits on a transaction; a split editor in the transaction sheet. Then 2FA and assistant upgrades.

## Phase 4.6 — Split transactions (2026-09-18) ✅

Commit: `24d157f` feat(splits).

### What changed
- **Model + migration**: `transaction_splits` (revision `20260917_000024`: transaction CASCADE, user CASCADE, category SET NULL, `amount Numeric(15,2)`, note; indexes on transaction and user+category). Round-tripped on SQLite and a local scratch Postgres.
- **Rules** (`services/splits.py`): a split never moves money — the parent keeps its amount and its whole balance effect. Lines add up to the parent **exactly** (Decimal, no tolerance), share its sign, are non-zero, have at most two decimals, 2–20 lines, one per category, categories visible to the user. The parent is re-filed under the **largest line's** category (`category_source="user"`), so anything that is not split-aware still files the whole amount somewhere sensible instead of reading it as uncategorised.
- **What drops a split**: an edit that changes the amount, filing the whole transaction under a different category, or the bank revising the charge's amount on sync (`clear_by_id` in the modified path). A note/description edit keeps it. Deleting the transaction removes its lines.
- **API**: `PUT /transactions/{id}/splits` (replace), `DELETE /transactions/{id}/splits` (unsplit); `TransactionResponse.splits` on every read, loaded for the whole list page with one `selectinload` query (the `/transactions` query budget moves 3 → 4, documented in the test).
- **Split-aware readers**: budget spend (`_spent_by_month` reads lines instead of their parents in one `UNION ALL` round trip; the progress ETag now covers `transaction_splits`), the assistant's `spending_by_category` (same) and `list_transactions` (includes the lines), the JSON export (`transaction_splits`). The UNION queries were run once against a scratch database on the local Postgres server and return the same figures as on SQLite.
- **Frontend**: `SplitEditor` inside the transaction sheet (a third mode next to view/edit; "Split"/"Edit split" button): per-line category (filtered to the transaction's direction), amount and note; the first line absorbs whatever the others leave until typed in; the running remainder says "Adds up" / "$x left to assign" / "$x too much"; Save stays disabled until the parts add up to the cent; "Remove split" unsplits. All arithmetic in integer cents parsed from text (`features/transactions/calculations/splits.ts`). The view mode lists the lines; cards read "Split · N". Analytics category comparisons and the category drawer use `expandSplits` so each line counts against its own category; totals, counts and activity lists keep one row per real transaction.

### Checks
- Backend: **813 passed** (10 new in `test_splits.py`: validation cases, API rejection + foreign category, storing/replacing/listing/clearing with the balance untouched, cross-user 404s, budgets per line with ETag change, assistant totals per line, what drops a split, delete cascade, bank revision drops and unchanged re-send keeps, export).
- Frontend: **1050 Vitest tests** (62 files; `splits.test.ts` incl. the 0.1 + 0.2 case, `SplitEditor.test.tsx`, split cases in `analytics.test.ts`), tsc clean, lint 2 pre-existing warnings, bundle 537 kB / 600.
- Playwright: **17/17** (new `11-split.spec.ts`: open a transaction → Split → type one part → the first rebalances → save → API shows the two lines and the balance is unchanged).

### Decisions and reasoning
1. **Largest line becomes the parent's category** rather than a synthetic "Split" category or null: nothing split-unaware ever mis-reads a split as uncategorised, and no new system category has to exist in every user's list.
2. **Drop, don't rescale, when the amount changes.** Rescaling lines proportionally invents numbers the user never entered; dropping keeps the main category and asks them to split again if they care.
3. **One category per line.** Two lines in one category are one line; it keeps drawers and budgets free of duplicate rows.

### Next step (done — see Phase 4.7)
**Phase 4.7 — 2FA**: TOTP (RFC 6238, ±1 step window, secret encrypted with `secret_box`, provisioning URI + QR on the client), ten single-use recovery codes stored hashed, enable/verify/disable flows behind the current password, login step-up (`/auth/login` returns `{two_factor_required, challenge}`; `/auth/login/2fa` completes it; lockout counts failed codes), Settings → Account → Two-factor section. Passkeys only if time allows. Then assistant upgrades.

## Phase 4.7 — Two-factor authentication (2026-09-18) ✅

Commit: `55bd2ae` feat(2fa).

### What changed
- **TOTP** (`utils/totp.py`, standard library only): RFC 6238 over RFC 4226, six digits, 30 s steps, HMAC-SHA1, ±1 step window, constant-time compare, and **no replays** — the step of the last accepted code is stored (`users.totp_last_step`) and nothing at or before it is accepted again. Pinned by the RFC's SHA-1 test vectors.
- **Storage** (revision `20260918_000025`, additive; everyone starts with 2FA off): `users.totp_secret` / `totp_pending_secret` are `secret_box` ciphertext (the Fernet key that protects Plaid tokens), `totp_enabled`, `totp_last_step`; `recovery_codes` table with SHA-256 hashes of ten 50-bit single-use codes (cascade on account deletion). Round-tripped on SQLite and a local scratch Postgres.
- **Enrolment** (`routers/two_factor.py`): `POST /auth/2fa/setup` (password) → pending secret, grouped key, `otpauth://` URI and an SVG QR code as a `data:` URI (rendered by `segno`, a new pure-Python dependency; the CSP already allows `data:` images); `POST /auth/2fa/enable` (first code) → turns it on, returns the recovery codes once, and **bumps `session_version`** so any session opened with the password alone is signed out (this browser gets fresh cookies). `POST /auth/2fa/disable` needs the password **and** a code; `POST /auth/2fa/recovery-codes` (password) replaces them; `GET /auth/2fa` reports state and codes left. `/auth/me` and the admin user list carry `two_factor_enabled`.
- **Login step-up**: a correct password on a 2FA account returns `{two_factor_required, challenge}` with **no cookies** and leaves the password lockout counter untouched; `POST /auth/login/2fa` takes the 5-minute challenge JWT (type `2fa_challenge`, bound to `session_version`, so a password reset kills it) plus an app code or a recovery code. Wrong codes count against their own lockout key (`2fa:<user id>`) with the same thresholds as passwords; success clears both counters. The API client no longer runs its refresh-and-retry dance on `/auth/login*` 401s — a retried wrong code would have counted twice.
- **Admin escape hatch**: `POST /admin/users/{id}/disable-2fa` for someone who lost both factors — and, like the admin reset, it signs nobody out (the existing policy test documents why).
- **Frontend**: Login shows a second step ("Code from your authenticator app", `autocomplete="one-time-code"`, numeric keypad, "Use a recovery code", "Start over"); an expired challenge returns to the password step with the server's message; someone who signs in with a recovery code and has ≤3 left lands on Settings → Account. Settings → Account → **Two-factor authentication** walks off → password → QR/key → first code → recovery codes (copy/download, shown once) → on; on-state shows codes left (warns at ≤3), "New recovery codes", "Turn off". Admin rows get "2FA off" for enrolled users. The login form's labels are now associated with their inputs (audit U1) and the eye button has a name.

### Checks
- Backend: **824 passed** (11 new in `test_two_factor.py`: RFC vectors, window/replay/format, enrolment with password + code + recovery codes + session revocation, status and `/me`, step-up without cookies, replay refused, recovery codes single-use and replaceable, challenge expiry / password change / wrong token type, lockout on guessed codes with `Retry-After`, disable needs both, admin reset without sign-out, deletion cascade). `test_admin` pins the new field and asserts no secret leaks.
- Frontend: **1060 Vitest tests** (64 files; `Login.test.tsx` 6, `TwoFactorSection.test.tsx` 4), tsc clean, lint 2 pre-existing warnings, bundle 540 kB / 600.
- Playwright: **18/18** (new `12-two-factor.spec.ts`: enrol via API, sign in through the UI, code step, a code computed in the test, lands signed in).

### Decisions and reasoning
1. **No TOTP dependency on the server**, only for the QR image: the algorithm is 20 lines and pinned by the RFC's own vectors; `segno` renders SVG server-side so the client bundle stays untouched and no QR library ships to every visitor.
2. **Enabling 2FA signs out other sessions.** The threat 2FA answers is "someone has my password"; leaving that someone signed in would make enrolment theatre.
3. **Passkeys deferred.** WebAuthn needs a verified library, per-origin RP configuration for Vercel previews vs production, and credential management UI; doing it properly is its own phase. Recorded for the final checklist.

### Next step (done — see Phase 4.8)
**Phase 4.8 — Assistant upgrades**: confirmed-write tools `add_budget`, `update_budget`, `add_rule` (pending-action flow, same as `add_transaction`), `list_alerts`-style awareness of alert preferences in the context, and routing/prompt updates so Fin offers "set a budget" / "make this a rule" when it fits. Then Phase 5 (UX/a11y).

## Phase 4.8 — Assistant upgrades (2026-09-18) ✅

Commit: `711d303` feat(assistant).

### What changed
- **Confirmed writes** (same pending-action flow as every other write: proposed in the model loop, shown as a card, executed only through `/assistant/execute` with the server-issued token):
  - `set_budget` — creates the category's monthly budget or changes the one it has (amount quantised to cents from `Decimal`, optional rollover, starts this user-local month); expense categories only, matched case-insensitively by name; unknown or non-expense names are a 404, zero or negative amounts a 400.
  - `add_rule` — a "contains" rule on description or merchant for a named category, validated by the rules service; `apply_to_past` also files matching past transactions through the same idempotent `apply_to_past` (never touching hand-filed rows) and reports how many.
- **Awareness**: `get_alert_settings` (read, quick tier) — bill/budget/low-balance switches, the threshold, which watched accounts sit under it, and whether automatic categorisation is on; explicitly read-only. `list_budgets` and `list_rules` from 4.1/4.2 complete the picture.
- **Prompt**: the "changing data" section names the new tools, and one line tells Fin to *offer* a rule when someone keeps re-filing a merchant and a budget when they worry about a category — offer, not insist. The persona block stays byte-identical across users (pinned by a test), so the prompt cache layout is unchanged.
- **Frontend**: confirmation cards are labelled "Budget" and "Rule"; a "Budgets" suggestion chip. A backend test reads `Assistant.tsx` and fails if any write tool lacks a card label.

### Checks
- Backend: **832 passed** (8 new in `test_assistant_writes.py`).
- Frontend: **1060 Vitest tests**, tsc clean, lint 2 pre-existing warnings, build and bundle within budget.

### Phase 4 summary
Budgets, categorisation rules, alerts, search, CSV import/export, split transactions, two-factor authentication and the assistant upgrades are all shipped with backend tests, component tests and one Playwright spec each (specs 7–12). Deferred with reasons: passkeys (4.7), amount-condition rules (4.2), per-user reminder window (4.3), trigram search index (4.4).

### Next step (done — see Phase 5)
**Phase 5 — UX & accessibility polish**: a 390 px / 1440 px pass over every page touched in Phase 4 (Overview with checklist + budgets card, Analytics budget card, Transactions search + import, Settings Rules / Two-factor / Alerts, Login code step), touch targets ≥44 px, visible focus, contrast of `--dim` text on the elevated surfaces, `prefers-reduced-motion` coverage, DESIGN.md token drift (audit U2), and refreshed Playwright screenshots for the changed pages.

## Phase 5 — UX & accessibility polish (2026-09-18) ✅

Commits: `81048de` fix(a11y) · `38aa384` chore(lint).

### What changed
- **Automated accessibility gate** (`e2e/a11y.spec.ts`, `@axe-core/playwright`): axe with WCAG 2.2 A/AA tags on every page — signed out (landing, login, signup, privacy) and signed in (Overview, Analytics, Timeline, Review, Accounts, Portfolio, Recurring, four Settings sections, Assistant) — at **390 px and 1440 px**, plus the Phase 4 sheets and dialogs (budgets, CSV import, split editor, rule sheet, 2FA setup, alert preferences, command palette). Fails on serious/critical findings and on any horizontal page overflow at phone width (WCAG 1.4.10); moderate/minor findings print. It saves a screenshot of every sheet at both widths to `e2e/__screenshots__/phase5/` for review.
- **What it found, and the fixes** (first run: 8 serious/critical across 5 issues; now 0 findings of any impact):
  1. Sign-up's show-password button had no name → `aria-label`; the transaction sheet's close button was a 32 px unnamed icon → 44 px, "Close".
  2. Overview/Accounts info hints were 16 px targets (below WCAG 2.5.8's 24 px) → the same 16 px circle inside a 24 px button.
  3. Contrast: **white text on every saturated fill fails AA** — 2.8:1 on ember, 2.3:1 on green, 2.2:1 on amber, 4.2:1 on red (axe only reported the solid ember button; gradients are not measured). New token `--ink-on-fill: #0A0A0B` (7:1 on ember) for text on primary buttons, confirm buttons, the assistant's send/new-chat/user bubble, modal submit buttons and accent badges; one-line revert by setting it to `#fff`. User-chosen category colours use `readableOn()` (`utils/contrast.ts`, tested), which picks ink or white by WCAG ratio. The active "expense" category tab moves to `#F87171` (4.06 → 5.5:1) and its count loses the 70 % opacity (2.66:1).
  4. The assistant's share bars carried `aria-label` on a role-less `div` → `role="img"`; the split editor duplicated its sheet's name on a role-less `div` → removed.
- **Visual pass** (screenshots at both widths): content in a titled sheet sat flush under the header rule → `.sheet-body--titled` pads 16 px (all sheets); a disabled primary button looked live ("Nothing to import") → `.btn-gradient:disabled` at 45 % with no shadow; new controls raised from 32–40 px to 44 px.
- **Motion**: the progress bar animated width for 700 ms and ignored reduced motion → 200 ms, `motion-reduce:transition-none` (DESIGN.md's own 140–250 ms rule).
- **DESIGN.md** (audit U2): colour, type and radius tables now state what ships (`--bg #070708`, `--muted #9CA3AF`, `--dim #858B96`, rgba lines, system-first sans stack with DM Serif for money, radii 10/14/18), plus an "Accessibility (checked, not aspirational)" section documenting the rules above. Every `--dim` pairing was recomputed: ≥ 5.0:1 on all surfaces.
- **Lint decision** (from Phase 2): the React-Compiler-era rules with zero findings are now **errors** (`purity`, `immutability`, `static-components`, `set-state-in-render`, `globals`, `error-boundaries`, `use-memo`, `component-hook-factories`); `set-state-in-effect` (46) and `refs` (10) stay off with the reasoning in `eslint.config.js`. The two long-standing unused-variable warnings are gone — **lint is at 0 problems**.
- Audit U1 (login label association) was closed in Phase 4.7.

### Checks
- Frontend: **1062 Vitest tests** (65 files), tsc clean, **lint 0 problems**, bundle within budget; `audit-ci` passes (allowlisted RSC advisory unchanged); `pip-audit` clean with `segno`.
- Playwright: **21/21** (18 functional + 3 accessibility scans).
- Backend unchanged: 832 passed.

### Decisions and reasoning
1. **Ink on fills, not a darker ember.** Darkening the fill would change the brand colour of every button; changing the text keeps every Ledger token and fixes all four saturated fills with one rule. It is the most visible change of this phase and reverts with one token.
2. **axe is a floor.** Automated checks catch labels, names, contrast, landmarks and targets; they do not judge focus order, reading order or plain language. The spec says so in its header.

### Next step (done — see Phase 6)
**Phase 6 — Tests & CI**: backend coverage report with a floor on the money paths (`services/ledger.py`, `budgets.py`, `splits.py`, `csv_import.py`, `categorization_rules.py`, `alerts.py`, `routers/plaid_router/sync.py`, `transfers`), frontend coverage for `features/**/calculations`; CI runs the full Playwright suite (incl. accessibility) on PRs, uploads the phase5 screenshots as an artifact, keeps the bundle budget, and checks migrations up/down/up plus the schema-chain test.

## Phase 6 — Tests & CI (2026-09-18) ✅

Commits: `cc219be` test · `dedc8e7` test(frontend) · `4baf256` fix(db).

### ⚠️ Correction to the production stamp (read this before deploying)
Phase 3 and the checklist said to run `alembic stamp <head>` on production. **That would be wrong for this branch.** Production was built by `main`'s legacy boot-time repairs to the schema of revision **`20260916_000013`** (the last revision on `main`). This branch adds columns to existing tables (users 2FA, accounts low-balance marker, transactions import batch, user preferences alerts, savings-goal milestone); stamping head would record those revisions as applied without running them, and every request would fail. The correct, rehearsed procedure is:

1. With `main` still serving, run once against production: `alembic stamp 20260916_000013` (writes only the `alembic_version` row).
2. Deploy the branch. Boot sees a stamped database and runs `alembic upgrade head` (revisions 14–26, every one guarded by existence checks).

`utils/migrations.py` now holds this as `PRODUCTION_BASELINE`, and the boot warning names it (with "do not stamp head"). **Safety net:** if the branch is deployed *before* the stamp, the boot-time schema check finds the missing columns and `/healthz` (Render's health check path) answers 503, so Render does not promote the release and the previous one keeps serving; the log line names the stamp command. A database unreachable at boot does not trip this — only a positive finding does.

**Rehearsed** (`backend/scripts/rehearse_production_upgrade.py`, scratch Postgres on localhost, `main` checked out in a worktree): main's own boot built the schema and wrote rows → this branch on the unstamped database: `outcome=unstamped missing=10 healthz=503` → `alembic stamp 20260916_000013` → boot again: `outcome=upgraded missing=0 healthz=200` → rows intact (`rows=1 sum=-12.34`), new columns at their defaults. **REHEARSAL PASSED.** The only remaining difference on a main-built database is two redundant unique indexes from the legacy repairs (`uq_accounts_plaid_account_id`, `uq_transactions_plaid_tx_id`), which duplicate the models' unique constraints; left in place deliberately (uniqueness and Plaid's `ON CONFLICT` behave identically either way).

### What changed
- **Backend coverage floors** (`scripts/check_coverage.py`): overall ≥ 85 % (measured 89.7 %) plus a per-file floor for every module that moves money or guards an account — ledger, transactions, transfers, budgets, splits, CSV import, rules, alerts, recurring bills, enrichment, Plaid sync, TOTP, secret box, auth, 2FA, lockout, account export/deletion. Measuring found **transfers at 67 %** and the secret box at 89 %: new `test_transfers.py` pins transfer behaviour as it stands (exact balance moves, cents never drift across many transfers, invalid transfers change nothing, other users' accounts out of reach, per-user listing newest first, delete restores both balances) → 100 %; secret-box edges (idempotent encrypt, legacy plaintext, empty refused, tampered token fails loudly, no key is an error) → 100 %. The two original secret-box tests are kept verbatim.
- **Frontend coverage floors** (`@vitest/coverage-v8`, `scripts/coverage-report.mjs`, `npm run test:coverage`): every `features/*/calculations/*` module ≥ 85 % lines, `utils/contrast` ≥ 95 %, `lib/deepLinks` ≥ 90 %. Measuring found the insight generator at 67 % and the period summary at 79 %: `insights.test.ts` (13 cases, each switching on one signal from a deliberately quiet baseline, plus top-three ordering) and `summary.test.ts` (9 cases) — which **found a copy bug**: the summary read "up +15.0 pp", now "up 15.0 pp" and pinned. Deep-link tests cover the Phase 4 builders; a detached doc comment in `deepLinks.ts` was re-attached. 34 calculation modules checked, 0 below floor.
- **Schema drift**: `scripts/check_schema_drift.py` compares a database migrated to head with the models (tables, columns, types, indexes, foreign keys; server defaults excluded). On Postgres it found five pre-existing differences from older revisions; **revision `20260918_000026`** reconciles them, each step guarded so it is correct on both a chain-built and a model-built database: the per-user snapshot index (declared on the model now, so production gains it), the `recurring_transactions.last_transaction_id` foreign key (SET NULL), three primary-key indexes, and `user_preferences.user_id` uniqueness as one unique index. Chain → drift check: **0 differences**; full walk base → head → base → head on SQLite and Postgres.
- **CI** (`.github/workflows/ci.yml`): backend runs with coverage and the floor check; new **`migrations-postgres`** job (Postgres 16 service) builds the chain, runs the drift check, walks down to base and up again, and checks drift again; frontend runs `test:coverage`; the e2e job (now also gated on the Postgres job) runs the functional specs **and** the WCAG scan and uploads the 390/1440 screenshots as an artifact on every run.

### Checks
- Backend: **848 passed**; coverage 89.7 % overall, every floor met.
- Frontend: **1089 Vitest tests** (67 files), lint 0, tsc clean, bundle within budget.
- Playwright: **21/21**.

### Next step
**Phase 7 — Docs & launch kit**: root `README.md`, `docs/ARCHITECTURE.md` (Mermaid: request path, data model, sync, assistant), `docs/DEPLOY.md` (the stamp procedure above, env vars, Render/Vercel/Neon/Plaid, rollback), `CHANGELOG.md`, the final report with the manual-steps checklist in this log, memory update, and the PR `fable/upgrade` → `main` (not merged).

## Phase 7 — Docs & launch kit (2026-09-18) ✅

- `README.md` (root): what Fintrack is, stack, layout, local setup, test commands, house rules, and the stamp warning.
- `docs/ARCHITECTURE.md`: Mermaid diagrams of the system context, backend request path, category precedence, bank sync, the assistant's confirm-before-write loop, sign-in and 2FA, and boot plus the schema guard.
- `docs/DEPLOY.md`: the rehearsed first-deploy procedure, encryption-key continuity (set `PLAID_TOKEN_ENCRYPTION_KEY` to the current `SECRET_KEY` value, never a new value), rollback without downgrading the schema, every environment variable, the cron table with the two new jobs, and health and monitoring.
- `CHANGELOG.md`; `backend/.env.example`. `render.yaml` gains the launch switches and loses `ADMIN_EMAIL`, which no code reads. `scripts/check_schema_drift.py` now refuses non-local databases, as the docs claim.

---

# Final report

## Outcome
All seven phases and the public-launch track are done on `fable/upgrade`. The branch is pushed and a PR to `main` is ready; it is not merged. Nothing touched production at any point: no connection to Neon production, no production migration, no real secrets read, no Plaid production calls.

| Measure | Before (Phase 0) | After |
|---|---|---|
| Backend tests | 577 (9 m 54 s) | **848** (~35 s) |
| Backend coverage | not measured | **89.7 %**, per-file floors on money and account code |
| Frontend tests | 973 (Jest, 41 s) | **1089** (Vitest, ~20 s), floors on 34 calculation modules |
| Playwright | 12 | **21**, including an axe WCAG 2.2 AA scan at 390 and 1440 px |
| Lint | 2 warnings | **0** |
| Initial JS (gzip) | 139.8 kB | ~137 kB (budget 150) |
| Accessibility findings | Lighthouse a11y 88 on `/login` | **0** axe findings on every page and sheet |
| Schema | two sources of truth, never migrated | Alembic authoritative, Postgres drift check in CI, rehearsed upgrade path |

## Manual steps (only you can do these)
1. **Production database**: restore point, then `alembic stamp 20260916_000013`, then merge. Follow `docs/DEPLOY.md` §"First deploy". *Not head.*
2. **Encryption key**: if `PLAID_TOKEN_ENCRYPTION_KEY` is unset on Render, set it to the current `SECRET_KEY` value before or with the deploy.
3. **Vercel**: rename `REACT_APP_VAPID_PUBLIC_KEY` to `VITE_VAPID_PUBLIC_KEY`, and confirm the Vite preset builds.
4. **Scheduler**: add nightly `POST /cron/check-budgets` and `POST /cron/check-balances`.
5. **Render**: confirm the dashboard runtime is Python 3.13 and the health check path is `/healthz` (as in `render.yaml`).
6. **Local hygiene**: remove `PRODUCTION_DATABASE_URL` from `backend/.env` (audit S14).
7. **After verifying your own email**, optionally set `REQUIRE_EMAIL_VERIFICATION=true`. Set `SIGNUP_INVITE_CODE` or `SIGNUPS_ENABLED=false` for a private beta.
8. **Optional**: `SENTRY_DSN` and `VITE_SENTRY_DSN`. Review the draft `/privacy` and `/terms` before inviting anyone.
9. **Plaid production** (trial pending since 2026-04-20): set `PLAID_ENV=production` and the production secret when approved.
10. **After production is stamped and stable**: delete the frozen legacy `_prepare_database()` repairs (follow-up below).

## Deferred, with reasons
- **Passkeys**: they need a vetted WebAuthn library and per-origin configuration for previews and production; that deserves its own phase.
- **Rules with amount conditions**; **per-user bill-reminder window**: not requested beyond the brief's scope, and cheap to add later.
- **Trigram search index**: needs `CREATE EXTENSION pg_trgm` on Neon, a production step; current volumes don't need it.
- **Legacy boot repairs removal**: only after production is stamped.
- **Redundant unique indexes on production** (`uq_accounts_plaid_account_id`, `uq_transactions_plaid_tx_id`): harmless duplicates of the models' unique constraints, left in place deliberately.
- **`set-state-in-effect` / `refs` lint rules**: 56 deliberate call sites; revisit if the React Compiler is adopted.

## Most visible change to look at first
Primary buttons now carry near-black text on the ember fill, an accessibility fix (2.8:1 → 7:1). To revert it, set `--ink-on-fill: #fff` in `frontend/src/index.css`.
