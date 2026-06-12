# Product

## Register

product

## Users

A single owner-operator (Mehdi) tracking his complete personal finances: accounts, transactions, recurring payments, investments, physical assets, savings goals, and loans. Used daily — quick glances on an iPhone PWA (bottom nav, pull-to-refresh, safe-area insets) and longer review sessions on desktop. The user is technical and numbers-fluent; he wants density and precision, not hand-holding.

## Product Purpose

Fintrack answers "where does my money stand right now?" in under two seconds, and "where is it going?" with one more tap. Success = the net worth number is trusted, entering a transaction takes under five seconds, and the analytics view replaces a spreadsheet.

## Brand Personality

Precise, calm, ledger-like. A private banker's desk at night: warm near-black surfaces, a single ember-orange accent, serif numerals for money, mono for labels. Confidence through restraint — the data is the decoration.

## Anti-references

- Neobank confetti apps (Revolut-style gradients, mascots, celebration overload)
- Generic AI-fintech SaaS: purple/blue glow gradients, hero-metric cards with side stripes, identical card grids
- Bloomberg-terminal cosplay: density without hierarchy

## Design Principles

1. **The number is the hero.** Monetary values get the display serif, everything else serves them.
2. **Unseen details compound.** Press feedback, origin-aware menus, tabular numerals, staggered entrances — each invisible alone, together they make it feel expensive.
3. **Fast beats fancy.** UI motion stays under 250ms with strong ease-out curves; keyboard-initiated actions don't animate.
4. **One accent, locked.** Ember orange (#F97316) marks action and state. Green/red are semantic only.
5. **Mobile is not a fallback.** Every surface works one-handed on a phone with the PWA chrome (safe areas, bottom nav, touch targets ≥44px).

## Accessibility & Inclusion

- Dark theme only (by design — verify all text ≥4.5:1 against the near-black surfaces)
- `prefers-reduced-motion` honored everywhere: movement removed, opacity transitions kept
- Visible `:focus-visible` rings; hover effects gated behind `(hover: hover)`
- Touch targets ≥44px on mobile
