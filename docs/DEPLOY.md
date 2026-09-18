# Deploying Fintrack

| Piece | Where | Notes |
|---|---|---|
| Frontend | Vercel (`frontend/`, framework Vite, output `dist/`) | `vercel.json` holds the `/api/*` rewrites, cache headers and CSP |
| API | Render web service (`render.yaml`, root `backend/`) | health check `/healthz`; migrations run at boot |
| Database | Neon Postgres (pooled URL) | never point local tools at it except for the one stamp below |
| Scheduler | any external cron (cron-job.org, GitHub Actions…) | calls `/cron/*` with `X-Cron-Secret` |

## First deploy of the upgrade branch

Production has never been stamped with an Alembic revision; its schema was built by `main`'s boot-time repairs and matches revision **`20260916_000013`**. This release adds columns to existing tables, so the order matters. This exact procedure was rehearsed against a database built by `main`'s own code (`backend/scripts/rehearse_production_upgrade.py`).

1. **Take a restore point.** In Neon, create a branch of the production database, or confirm point-in-time restore covers now.
2. **Check the encryption key.**
   - Stored Plaid tokens (and, from this release, 2FA secrets) are encrypted with `PLAID_TOKEN_ENCRYPTION_KEY`, or with `SECRET_KEY` when that is unset.
   - If `PLAID_TOKEN_ENCRYPTION_KEY` is not set on Render today, set it to the **current value of `SECRET_KEY`**. The derived key stays the same, and you can then rotate `SECRET_KEY` independently later.
   - Setting it to a new value would make every stored token unreadable.
3. **Stamp the baseline**, once, from a machine with the backend installed (with `main` still serving, nothing changes for users):
   ```bash
   cd backend
   DATABASE_URL='<Neon production URL>' alembic stamp 20260916_000013
   ```
   Never stamp `head`. That would record revisions 14–26 as applied without running them.
4. **Merge the PR.** Render deploys, boot sees a stamped database, and it runs `alembic upgrade head` (revisions 14–26, each guarded).
   - If step 3 was skipped, the boot-time schema check finds the missing columns and `/healthz` answers 503. Render then does not promote the release, the previous one keeps serving, and the log line `schema_behind_code` names the stamp command. Stamp, then redeploy.
5. **Vercel**: rename the env var `REACT_APP_VAPID_PUBLIC_KEY` → `VITE_VAPID_PUBLIC_KEY` (same value) and confirm the project builds with the Vite preset.
6. **Scheduler**: add the two new nightly jobs (table below) next to the existing ones.
7. **Verify**:
   - `GET /healthz` and `/readyz` return 200.
   - Sign in, then open Overview (setup checklist and budgets card), Transactions (search, Add → Import CSV), Settings → Rules, Preferences → Alerts, and Account → Two-factor.
   - Run a Plaid sync from Connections.
8. **Optional hardening once verified**:
   - Set `REQUIRE_EMAIL_VERIFICATION=true` after confirming your own account is verified.
   - Set `SIGNUP_INVITE_CODE` or `SIGNUPS_ENABLED=false` for a private beta.
   - Set `SENTRY_DSN` (API) and `VITE_SENTRY_DSN` (frontend).

**Rolling back**: use Render's "Rollback" to the previous deploy and leave the schema where it is.
- Every column this release added is nullable or has a server default, and every new table is unknown to the old code, so the old release runs unchanged on the upgraded schema.
- Do not `alembic downgrade` production to roll back.

## Environment variables (API)

Declared in `render.yaml`; secrets are entered in the Render dashboard.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled connection string |
| `SECRET_KEY` | yes | signs JWTs; ≥ 32 bytes |
| `PLAID_TOKEN_ENCRYPTION_KEY` | recommended | Fernet source for Plaid tokens and 2FA secrets (see step 2) |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOK_URL` | for bank sync | `PLAID_ENV` is `sandbox` or `production`; webhook is `https://<api>/plaid/webhook` |
| `RESEND_API_KEY`, `FROM_EMAIL`, `FRONTEND_URL` | for email | verification and reset links point at `FRONTEND_URL` |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push | the public key goes to Vercel as `VITE_VAPID_PUBLIC_KEY` |
| `ANTHROPIC_API_KEY` | for the assistant | |
| `CRON_SECRET` | yes | header for `/cron/*` |
| `ALLOWED_ORIGINS` | optional | CSV of extra browser origins (custom domain, preview URLs) |
| `SIGNUPS_ENABLED` (true), `SIGNUP_INVITE_CODE`, `REQUIRE_EMAIL_VERIFICATION` (false) | optional | launch controls |
| `ASSISTANT_DAILY_TURN_CAP` (150), `ASSISTANT_DAILY_COST_CAP_USD` (3.00) | optional | per user per day; 0 disables |
| `AUTO_CATEGORIZE` (true) | optional | operator kill switch for inferred categories (rules still apply) |
| `RUN_MIGRATIONS_ON_BOOT` (true), `AUTO_PREPARE_DB` (true) | optional | boot-time migrations / legacy repairs |
| `DB_POOL_SIZE` (5), `DB_MAX_OVERFLOW` (5), `DB_POOL_RECYCLE_SECONDS` (300), `DB_POOL_TIMEOUT_SECONDS` (10), `DB_STATEMENT_TIMEOUT_MS` (15000), `DB_CONNECT_TIMEOUT_SECONDS` (10) | optional | Neon pool tuning. The statement timeout is only sent to direct (non-`-pooler`) hosts: Neon's pooler rejects startup parameters. |
| `CRON_TIME_BUDGET_SECONDS` (20) | optional | stops long cron work before Render's 30 s proxy limit |
| `LOG_FORMAT` (json), `LOG_LEVEL`, `EXPOSE_API_DOCS` (false), `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | optional | observability |

Frontend (Vercel): `VITE_VAPID_PUBLIC_KEY`, optional `VITE_SENTRY_DSN`.

## Scheduled jobs

All are `POST https://<api>/cron/<name>` with header `X-Cron-Secret: $CRON_SECRET`. Each is safe to run more than once.

| Job | Schedule | What it does |
|---|---|---|
| `run-jobs` | every minute | drains the Postgres-backed job queue (per-user snapshot work) |
| `process-recurring` | nightly | posts due manual bills, reconciles bank-linked bills, sends bill reminders (respects the user's switch) |
| `refresh-balance-snapshots` | nightly | month-end balance snapshots for the history charts |
| `refresh-merchant-categories` | nightly | merchant category statistics |
| `check-budgets` | nightly · **new** | over-budget push, once per budget per month |
| `check-balances` | nightly · **new** | low-balance push for opted-in users, once per dip |
| `prune-idempotency-keys` | hourly | drops expired idempotency keys, pending assistant actions and old bookkeeping |

## Health and monitoring

- **`/healthz`**: 200 when the process can serve. It answers 503 only if boot found the schema missing columns the code needs, which is Render's signal not to promote a release.
- **`/readyz`**: also runs `SELECT 1`.
- **Logs**: JSON lines with a `request_id` per request (`LOG_FORMAT=json`).
- **Errors**: Sentry is inert until DSNs are set.
- **Admin**: Settings → Admin shows users, assistant usage and cost per user, and can turn off someone's 2FA or send them a password reset. Neither action signs them out.

## Local rehearsal before risky changes

```bash
git worktree add ../fintrack-main main
cd backend
python scripts/rehearse_production_upgrade.py --main ../../fintrack-main/backend \
  --scratch-url postgresql://postgres:postgres@localhost:5432/fintrack_rehearsal
DATABASE_URL=postgresql://…/scratch python scripts/check_schema_drift.py
```

Both refuse to run against anything but a local database.
