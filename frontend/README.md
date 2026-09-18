# Fintrack — frontend

React 19 + TypeScript 5 on Vite, Tailwind 3, tested with Vitest and Playwright.
Deployed to Vercel; `/api/*` is rewritten to the FastAPI backend on Render so the
app is same-origin in every environment (locally, Vite's dev server does the same).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:3000 with `/api` proxied to `http://127.0.0.1:8000` |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve `dist/` on :3000 with the same `/api` proxy |
| `npm test` / `npm run test:ci` | Vitest (watch / single run) |
| `npm run test:coverage` | Vitest with coverage, then per-module floors on `features/*/calculations` (`scripts/coverage-report.mjs`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm run check:bundle` | Fail if `dist/` exceeds the gzip budget in `scripts/check-bundle.mjs` |
| `npm run e2e` | Build, then Playwright against `vite preview` + a scratch backend: one spec per feature and `a11y.spec.ts` (axe, WCAG 2.2 AA, 390 px and 1440 px, sheets included; screenshots in `e2e/__screenshots__/phase5/`) |

## Environment

Copy `.env.example` to `.env.local`. Only `VITE_`-prefixed variables reach the bundle.

| Variable | Purpose |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | Web-push public key (was `REACT_APP_VAPID_PUBLIC_KEY` under CRA). Empty hides the push switch. |
| `VITE_DEV_API_TARGET` | Dev/preview proxy target for `/api` (default `http://127.0.0.1:8000`) |

## Layout

- `src/pages` — one component per route; `src/lib/routes.tsx` lazy-loads all but login, signup and the dashboard.
- `src/features/<area>` — calculations (pure, unit-tested), hooks and components per feature.
- `src/components` — shared UI; `src/index.css` holds the "Ledger" design tokens (see `../DESIGN.md`).
- `src/utils/api.ts` — every backend call; `src/utils/mutationQueue.ts` — offline write queue keyed by `Idempotency-Key`.
- `public/sw.js` — hand-written service worker (static-asset cache, push). `src/lib/serviceWorker.ts` registers it and surfaces "new version" prompts.
- `e2e/` — Playwright specs; `playwright.config.ts` boots the backend with a scratch SQLite DB.
