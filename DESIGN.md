# Design — "Ledger" system

Dark-only product UI. A private banker's desk at night: warm near-black, one ember accent, serif money, mono labels. All tokens live in `frontend/src/index.css` (`:root`) and are mirrored in `tailwind.config.js`.

## Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0A0A0B` | App background |
| `--elev-1` | `#111113` | Cards, panels |
| `--elev-sub` | `#0D0D0F` | Nested surfaces, inputs |
| `--fg` | `#F1F1F3` | Primary text |
| `--muted` / `--dim` | `#6B7280` / `#4B5563` | Secondary / tertiary text |
| `--line` / `--line-strong` | `#1E1E22` / `#2A2A30` | Structural borders |
| `--accent` | `#F97316` | THE accent — actions, selection, brand. One per page, locked. |
| `--pos` / `--neg` | `#22C55E` / `#EF4444` | Semantic only (money in/out). Never decorative. |

Category palette: `--cat-1`…`--cat-8` (fixed 8 colors for user categories).
Shadows are tinted warm-black (`--shadow-card/float/modal`), never pure black; cards carry a 1px top edge-light (`--edge-light`).

## Typography

- **Geist** (sans) — UI, body, buttons
- **DM Serif Display** — large monetary values only (`.value-display`) + page H1s
- **DM Mono** — labels (`.label`: 10px uppercase 0.13em tracking), amounts, dates
- All numerals tabular (`tabular-nums`), money formatted `$1,234.56`

## Shape

Radii: 8 / 10 / 14px (sm/md/lg); pills and quick-action buttons are full-round. Cards top out at ~14px.

## Motion

Curves in tokens — never default easings:
- `--ease-out: cubic-bezier(0.23,1,0.32,1)` — enters, hovers (UI default)
- `--ease-drawer: cubic-bezier(0.32,0.72,0,1)` — sheets/drawers
- `--ease-exit: cubic-bezier(0.4,0,1,1)` — exits (faster than enters)

Rules: UI transitions 140–250ms, transform/opacity only, `.pressable` scale(0.97) on `:active`, hovers gated behind `(hover: hover)`, keyboard-initiated UI (⌘K palette) opens with no animation, list entrances use `.stagger-in` (45ms steps). `prefers-reduced-motion` strips movement, keeps fades.

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
