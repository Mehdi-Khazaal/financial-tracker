# Design — "Ledger" system

Dark-only product UI. A private banker's desk at night: warm near-black, one ember accent, serif money, mono labels. All tokens live in `frontend/src/index.css` (`:root`) and are mirrored in `tailwind.config.js`.

## Color

Values below are what ships in `index.css` (audited 2026-09-18; the earlier table had drifted).

| Token | Value | Use |
|---|---|---|
| `--bg` | `#070708` | App background |
| `--elev-1` / `--elev-2` | `#121214` / `#18181B` | Cards, panels / raised controls |
| `--elev-sub` | `#0D0D0F` | Nested surfaces, inputs |
| `--fg` | `#F1F1F3` | Primary text |
| `--muted` / `--dim` | `#9CA3AF` / `#858B96` | Secondary / tertiary text (both ≥ 4.5:1 on every surface) |
| `--line` / `--line-strong` | `rgba(255,255,255,.09)` / `rgba(255,255,255,.18)` | Structural borders |
| `--accent` | `#F97316` | THE accent — actions, selection, brand. One per page, locked. |
| `--ink-on-fill` | `#0A0A0B` | Text and icons on any saturated fill (ember, green, red, amber) |
| `--pos` / `--neg` | `#22C55E` / `#EF4444` | Semantic only (money in/out). Never decorative. |

Category palette: `--cat-1`…`--cat-8` (fixed 8 colors for user categories).
Shadows are tinted warm-black (`--shadow-card/float/modal`), never pure black; cards carry a 1px top edge-light (`--edge-light`).

## Typography

- **System UI sans** (`--font-sans`: SF Pro on Apple platforms, then Inter, Geist, `system-ui`) — UI, body, buttons
- **DM Serif Display** (`--font-money`) — large monetary values (`.value-display`)
- **DM Mono** (`--font-mono`) — labels (`.label`: 10px uppercase 0.13em tracking), amounts, dates
- All numerals tabular (`tabular-nums`), money formatted `$1,234.56`

## Shape

Radii: 10 / 14 / 18px (`--radius-sm/md/lg`); pills and quick-action buttons are full-round.

## Motion

Curves in tokens — never default easings:
- `--ease-out: cubic-bezier(0.23,1,0.32,1)` — enters, hovers (UI default)
- `--ease-drawer: cubic-bezier(0.32,0.72,0,1)` — sheets/drawers
- `--ease-exit: cubic-bezier(0.4,0,1,1)` — exits (faster than enters)

Rules: UI transitions 140–250ms, transform/opacity only, `.pressable` scale(0.97) on `:active`, hovers gated behind `(hover: hover)`, keyboard-initiated UI (⌘K palette) opens with no animation, list entrances use `.stagger-in` (45ms steps). `prefers-reduced-motion` strips movement, keeps fades.

Progress bars animate width in 200ms and not at all under `prefers-reduced-motion`.

## Accessibility (checked, not aspirational)

`e2e/a11y.spec.ts` runs axe (WCAG 2.2 A/AA) on every page and on the Phase 4 sheets at 390px and 1440px, and fails on serious/critical findings or any horizontal page overflow. The rules it enforces, and the ones behind them:

- **Contrast**: body text ≥ 4.5:1. White on ember is 2.8:1, so text on a saturated fill uses `--ink-on-fill` (7:1 on ember). User-chosen category colours pick ink or white with `readableOn()` (`utils/contrast.ts`). `--neg` text on its own tint drops to 4.06:1; use `#F87171` there.
- **Targets**: 44px (`--hit-min`) for controls; inline hints (`InfoHint`) keep a 16px circle inside a 24px target.
- **Names**: every icon-only button has an `aria-label`; labels are tied to inputs with `htmlFor`/`id`; a labelled `div` carries a role.
- **Disabled primary** (`.btn-gradient:disabled`) drops to 45% opacity with no shadow — a disabled button must not look pressable.
- **Sheets**: a titled sheet pads its body 16px below the header rule.

## Z-scale

`--z-sticky 20 → nav 40 → topbar 50 → backdrop 60 → modal 70 → toast 80 → grain 90`. No arbitrary values.

## Texture

Fixed full-viewport film grain (`body::after`, 3% opacity SVG noise). Hero card gets a slow ember shimmer + radial glow (`.hero-card`).

## Component vocabulary

`.card`, `.card-hover`, `.btn-gradient` (primary), `.btn-ghost`, `.btn-danger`, `.qa-btn` (quick actions), `.input-dark`, `.pill-*`, `.skeleton`, `.label`, `.cmdk-*` (command palette), `.bottom-nav-item`/`.bn-pill` (mobile nav). Same control = same class everywhere.

## App-level features with design hooks

- **Privacy mode**: `body.privacy-on` blurs `.value-display`, `.stat-value`, `.tabular-nums`, and inline `font-variant-numeric` amounts (`UIContext`, eye toggle in TopBar)
- **Command palette**: ⌘K / Ctrl+K (`CommandPalette.tsx`) — navigation, quick actions, preferences
- **CountUp / Sparkline** components for animated numbers and 12-month trajectories
- Mobile PWA chrome: safe-area insets, 64px bottom nav with animated active pill + haptics, pull-to-refresh
