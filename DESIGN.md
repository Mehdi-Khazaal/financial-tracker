# Design — Swiss / utility system

Calm and fast to scan. Neutral greys, one strong colour, big clear numbers, thin rules instead of boxes. Light by default, dark when the device is dark (or when the user picks it in Settings → Preferences → Appearance). All tokens live in `frontend/src/index.css` (`:root`, plus the dark block) and are mirrored in `tailwind.config.js`.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAF8` | `#0F1012` | Page background |
| `--elev-1` | `#FFFFFF` | `#16181B` | Panels, inputs, menus, sheets |
| `--elev-sub` | `#F1F1EE` | `#1B1D21` | Hover, chips, subtle fills |
| `--fg` | `#141414` | `#F1F1EE` | Primary text; also spending figures (spending is not a verdict) |
| `--muted` / `--dim` | `#57574F` / `#6B6B63` | `#A1A19A` / `#8E8E87` | Secondary / tertiary text (≥ 4.5:1 on every surface) |
| `--line` / `--line-strong` | `#E4E4E0` / `#CFCFC8` | `#26282C` / `#34373C` | Hairline rules / control borders |
| `--accent` | `#2347D9` | `#7B93FF` | The one strong colour: links, the primary action, selection, the chart line |
| `--logo-bg` | `#2347D9` | `#4A6BF2` | The logo tile |
| `--ink-on-fill` | `#FFFFFF` | `#0B0C0E` | Text on a solid accent fill |
| `--pos` / `--neg` | `#15803D` / `#B42318` | `#4ADE80` / `#F97066` | Money in / over budget, debt. Semantic only. |
| `--warn` | `#A15C07` | `#FBBF24` | Close to a limit |

Tints are `color-mix(in oklab, var(--token) N%, transparent)`, never hard-coded rgba, so both modes follow. Saved palettes (category and collection colour presets) stay as hex because they are stored data.

## Typography

- **IBM Plex Sans** for everything (`--font-sans`; `--font-mono`, `--font-display` and `--font-money` all resolve to it). One family; hierarchy comes from size and weight.
- All figures tabular (`font-variant-numeric: tabular-nums` on `body`), so amounts line up without a monospace face.
- Section titles 15px semibold (`.section-title`). Labels are 13px sentence case in `--muted` (`.label`, `.metric-label`) — no uppercase tracked eyebrows.

## Layout

- Prefer rules to boxes. A section is a title, then rows divided by hairlines (`.row-list`, `.row-link`). Figures sit in a strip divided by vertical rules (`.metric-strip`).
- Where a panel is still useful (`.card`, `.ledger-panel`) it is a flat `--elev-1` surface with one hairline: no gradient, no glow, no shadow. Cells inside a panel (`.ledger-cell`) are just a rule above, never a box inside a box.
- Only floating layers (menus, sheets, toasts, the palette) cast a shadow (`--shadow-float`, `--shadow-modal`).

## Shape

Radii 6 / 8 / 10px (`--radius-sm/md/lg`); Tailwind's `rounded-*` scale is tightened to match. Segmented controls are bordered strips with the active segment filled in `--fg`.

## Charts

Thin lines, no gradient fills, square bars. Money in is ink, outflows are greys, the result is the accent. Labels are in readable ink, never in a light chart colour.

## Motion

Curves in tokens (`--ease-out`, `--ease-drawer`, `--ease-exit`). Transitions 120–260ms; feedback is opacity, not bouncing scale. No grain and no looping animations (they repainted every frame). `prefers-reduced-motion` strips movement.

## Logo

The Tally mark (`components/LogoMark.tsx`): four strokes crossed by a fifth on a rounded `--logo-bg` square; three strokes below 20px. The same drawing is rendered into every icon in `frontend/public/` (favicon.svg/.png/.ico, icon-192/512, maskable, apple-touch-icon).

## Accessibility (checked, not aspirational)

`e2e/a11y.spec.ts` runs axe (WCAG 2.2 A/AA) on every page at 390px and 1440px and fails on serious/critical findings or horizontal overflow.

- **Contrast**: body text ≥ 4.5:1 in both modes. User-chosen category colours pick ink or white with `readableOn()` (`utils/contrast.ts`).
- **Targets**: 44px (`--hit-min`) for controls.
- **Names**: icon-only buttons have an `aria-label`; inputs have labels.
- **Disabled primary** drops to 45% opacity.

## Z-scale

`--z-sticky 20 → nav 40 → topbar 50 → backdrop 60 → modal 70 → toast 80`.

## Component vocabulary

`.card`, `.ledger-panel`, `.ledger-cell`, `.btn-gradient` (the solid primary; name kept), `.btn-ghost`, `.btn-danger`, `.input-dark`, `.form-label`, `.header-action` / `--primary`, `.menu-surface` / `.menu-item`, `.pill-*`, `.section-title`, `.section-link`, `.row-list`, `.row-link`, `.metric-strip`, `.skeleton`, `.cmdk-*`.

## App-level features with design hooks

- **Light / dark**: `utils/theme.ts` + `public/theme-init.js` (applies a saved choice before first paint).
- **Privacy mode**: `body.privacy-on` blurs amounts (`.value-display`, `.stat-value`, `.tabular-nums`).
- **Command palette**: ⌘K / Ctrl+K (`CommandPalette.tsx`).
