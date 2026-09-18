# Changelog

## [Unreleased] — the Fintrack upgrade (branch `fable/upgrade`)

Everything since `main` @ `1843c6d`. The full record, with reasoning per phase, is in `docs/UPGRADE_LOG.md`; deployment steps are in `docs/DEPLOY.md`.

### ⚠️ Before deploying
Run `alembic stamp 20260916_000013` against production once, then deploy. Stamp exactly this revision, never head. If you skip it, `/healthz` refuses traffic and Render keeps the previous release serving.

### Added
- **Budgets**: monthly per-category allowances with optional rollover (unspent money only); progress on Overview and Analytics; an over-budget push once per budget per month.
- **Categorization rules**: "description or merchant contains / matches" → category, ahead of every inference. They have a live preview, can be applied to past transactions idempotently (never touching categories set by hand), and can be started from any transaction.
- **Alerts**: switches for bill reminders, budget alerts and low-balance alerts, all honoured server-side, plus a decimal threshold. Low balance is announced once per dip.
- **Search**: timeline search over description and merchant fields, an uncategorized filter, and a ⌘K "Search transactions for …" entry.
- **CSV import**: column mapping suggestions, several date orders and amount formats, debit/credit columns, duplicate detection against the ledger and within the file, a preview, a posting path that goes through the ledger, and undo for a whole batch. Server CSV export honours the list filters.
- **Split transactions**: one charge across several categories, with lines that add up to the cent. Budgets, analytics and the assistant read the lines.
- **Two-factor authentication**: TOTP with ten hashed single-use recovery codes, a login step-up with its own lockout, and settings and admin controls.
- **Assistant**: confirmed `set_budget` and `add_rule` writes, plus read tools for budgets, rules and alert settings.
- **Onboarding**: a first-run checklist on Overview (account, categories, budget).
- **Public launch**: landing page, draft privacy policy and terms, invite-gated or closed sign-up, an email verification gate, per-user daily assistant caps, a usage view for the admin, full data export (JSON and CSV) and self-serve account deletion.
- **Operations**: `/healthz` and `/readyz`, JSON logs with request ids, optional Sentry, a Render blueprint, and a Postgres-backed job queue for cron fan-out.

### Changed
- **Frontend toolchain**: CRA → Vite 8, Jest → Vitest, TypeScript 5.9, ESLint flat config (compiler-era hooks rules on where they have no findings), a service-worker update prompt, and a bundle budget.
- **Backend structure**: the assistant and Plaid routers are split into packages (no behaviour change). Every money write goes through `LedgerService` with atomic balance updates.
- **Schema**: Alembic is authoritative. Migrations run at boot, and a schema check at boot refuses traffic when columns are missing. Revisions 14–26 are additive and guarded.
- **Accessibility**:
  - Text on saturated fills uses a near-black ink (`--ink-on-fill`, 7:1 on ember). White had been 2.2–4.2:1 on every fill.
  - Info hints have 24 px targets, icon buttons are named, and login labels are tied to their inputs.
  - Titled sheets get breathing room, and disabled primary buttons look disabled.
  - `DESIGN.md` now states the tokens that actually ship.

### Fixed
- Non-atomic balance updates and three write paths that bypassed enrichment.
- In-memory assistant pending actions (now stored, hashed, used once).
- The migration chain was missing tables and columns, and differed from the models in five places (revision 26).
- An order-dependent test harness. SQLite now enforces foreign keys the way Postgres does.
- The CSV import result and its Undo disappeared when the page reloaded its accounts.
- The analytics summary read "up +15.0 pp".
- The progress bar animated for 700 ms and ignored reduced motion.

### Security
- Hardened refresh tokens (rotation with a unique `jti`), per-identifier login lockout, CSP and security headers, origin checks on cookie writes, and hardened push endpoints.
- A prompt-injection envelope around assistant tool results, and memory writes confirmed like any other write.
- 2FA secrets are encrypted with the same key as Plaid tokens. Recovery codes are stored as SHA-256 hashes.

### Tests
- Backend: 577 → 848 tests. 89.7 % coverage, with per-file floors on money and account code.
- Frontend: 973 → 1089 tests, with coverage floors on 34 calculation modules.
- Playwright: 12 → 21 specs, including an axe WCAG 2.2 AA scan.
- CI: the migration chain runs on Postgres with a drift check.
