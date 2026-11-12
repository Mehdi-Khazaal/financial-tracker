# Changelog

## [Unreleased] — transaction sheet

### Before deploying
Nothing manual. Frontend only.

### Changed
- **The transaction window is one sheet with three steps** (details → edit → split). It is a side panel on desktop, so the list stays in view, and a bottom sheet on a phone. Steps slide the way you go, the panel eases to each step's height, and a back arrow (or Escape) returns to the details. Category, account and date rows on the details open the form on that field.
- **Save, Edit, Split and Delete sit in a pinned footer**, so a long category list no longer pushes Save below the fold on a phone. Save stays disabled until something changes; saving returns to the details with the new values.
- Opening Edit no longer puts the cursor in the amount, so the phone keyboard does not jump up over the form. Leaving with unsaved changes asks first.
- The add and edit forms share one set of controls: an Expense/Income switch, bordered category chips with their colour dot, and an amount box with the currency beside the number. Spending is shown in ink, not red, as everywhere else.
- Every sheet now animates out instead of vanishing (respecting reduced motion), and the confirm dialog is a proper alert dialog: focus starts on Cancel, Escape cancels, its button says what it does ("Delete", "Discard").
- A transaction with no description reads "No description" in the list.

### Fixed
- **Editing a transaction overwrote fields that had not changed.** Saving sent every field: a transaction with no description had "No note" written into it, and an untouched category was re-marked as set by hand. Only the changed fields are sent now.
- A sheet re-ran its open logic on every re-render of the page behind it (a list reload after saving), moving keyboard focus out of the sheet and back.
- With a sheet open, the confirm dialog could not be reached with Tab, and Escape closed the sheet behind it.
- The Add sheet's amount lost its focus to the close button a frame after opening.
- Toasts covered the close button of a side panel on desktop.

## [Unreleased] — accuracy round (branch `feat/accuracy-round`)

### Before deploying
Nothing manual. Migration `20261111_000035` adds one nullable column (`transactions.one_off`) and runs at boot. Checked on Postgres: the chain matches the models, and the revision reverts and re-applies.

### Added
- **Restore deleted card payments and transfers** (Accounts → "Find them" on an account whose history is incomplete): asks each bank for its full history, read-only, and lists the transfer-like rows the ledger lacks. The ones you keep come back filed as Transfers, so they fix each account's past balances and never count as income or spending.
- **Gold summary** (Portfolio → Assets): pure weight across every piece, what it cost, what it is worth, the average paid per ounce against today's price, and a year of month-end gold prices (`GET /assets/metal-history`, cached in `market_prices`).
- **One-offs**: a charge of $1,000 or more that does not repeat is a one-off, left out of the "usual month" the goal plan funds goals from. Any transaction can be marked either way from its window.

### Changed
- **The month-end outlook counts paychecks still due**, at each payer's typical pay over the last 90 days, with a low-high range. It said "spend $33.41 more than you earn" with two paychecks due on the 21st.
- **The goal plan funds goals from a usual month** (one-offs left out, and listed). The plain average had turned about $1,935 a month into $783 and counted tuition twice. The assistant uses the same figure.
- **The emergency fund has no deadline**: it shows the months of usual spending it covers, and is never "past deadline".
- **Net-worth history starts at the first transaction or transfer** instead of drawing a flat line back before it; the screens say "Since <month>".
- Analytics sizes its "move money toward a goal" suggestion by cash that is free now (available to spend less this month's bills), not by what the period kept.
- The paycheck plan's suggested amounts use recent pay, and a split deposit counts as one paycheck.
- The Dashboard's goals moved to the wide column, and the budget total shows only with two or more budgets.
- The Dashboard's add, transfer and budgets sheets load on first open (initial bundle 149.1 → 145.3 kB).

### Fixed
- **The API stalled under a burst of requests.** `get_current_user` was `async def` with a blocking query, so a request waiting for a pooled connection blocked the event loop: 13 parallel requests took 22 s on production and two failed. It is a plain function now, and the idempotency middleware and Plaid webhook do their database work in the threadpool. A test fails if any query runs on the event loop.
- Account cards showed impossible histories (checking walked back to −$14k, a paid-off card "$1,444 more owed") when card payments had been deleted; they now say the history is incomplete.
- Transactions' "Add" button sat under the search button at desktop widths.

## [Released 2026-11-10] — trust and planning (branch `feat/trust-and-planning`)

### Before deploying
Nothing manual. Migrations `20261110_000029` to `20261110_000034` are additive (one new table for prices, four for the paycheck plan, nullable columns elsewhere) and run at boot. Checked on Postgres: the chain matches the models, and every revision reverts and re-applies.

### Added
- **Live gold and silver**: a holding with a metal, weight and purity is valued daily from the COMEX price (`GC=F`, `SI=F`). The asset form has presets (1 oz coin, 10 g bar, English and Ottoman gold lira) and a live preview; cards show the metal value against what was paid.
- **Paycheck plan** (Portfolio → Savings): pick the payers that are paychecks, set an amount per goal per payday. Each payday shows the bills due before the next one, each goal's share and what is free; ticking a line sets the money aside. A push goes out when a paycheck lands.
- **Goal plan**: goals are funded in an order you set. Each goal shows when it is really reached at your saving rate and paycheck plan, and whether that is in time. Goal cards and the assistant use the same dates.
- **Transfers**: a `transfer` category type that is never income or spending, and suggestions in Review for card payments and moves between your own accounts, filed in one tap.
- Goals can be edited (name, target, date) and one can be marked as the emergency fund.

### Changed
- **Net worth includes holdings** everywhere, valued at today's prices; history counts each holding from the day it was acquired. One figure on the Dashboard, Analytics, Accounts, Portfolio and the assistant.
- Prices are fetched and stored on the server (`market_prices`) instead of in the browser.
- "Available to spend" and the emergency-fund ratio leave out money set aside for goals.
- The assistant's monthly income and spending use the app's own rules (card payments, transfers and asset purchases are no longer income or spending).

### Fixed
- The net-worth chart's latest point came from a stale month-end snapshot and disagreed with the headline.
- Past account balances ignored transfers between your own accounts.
- Spending was shown in red on Transactions.
- A usage-based bill (gas, electricity) going up a little was reported as a price rise.
- Settings' category types overflowed a 320 px phone once a fourth type existed.

## [Released 2026-09-18] — the Fintrack upgrade (branch `fable/upgrade`)

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
