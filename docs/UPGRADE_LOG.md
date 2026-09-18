# Fintrack Upgrade Log

This file is the resumption point. A fresh session must be able to continue from
it alone: read **Status**, then the latest phase entry, then **Next step**.

## Status

- Branch: `fable/upgrade` (created from `main` @ `1843c6d` on 2026-09-17). Never push to `main`.
- Current phase: **Phase 0 complete → Phase 1 next.**
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

### Next step
**Phase 1 — Security & correctness hardening**, in this order:
1. Test-speed fix first (AUDIT P5) so the rest of the phase is workable: in-memory SQLite + `BCRYPT_ROUNDS` override. Verify all 577 tests still pass.
2. Characterization tests pinning current balance arithmetic for recurring posting, cron posting, savings spend, assistant `add_transaction` (C1/C2), then unify on `LedgerService`.
3. Cross-user tests for every router (S16) — include `loans`, `transfers`, `push` in the test app (D2).
4. S1 push endpoint validation; S2 assistant injection hardening + `save_memory` via confirmation; S4/S5/S6/S7 auth fixes; S8/S9 CSP + headers + `ALLOWED_ORIGINS`; S10 secret_box compatibility test; C3 Decimal output; C4 user-local dates; C5 milestone idempotence.
5. Run the full suite, update this log, commit per step.
