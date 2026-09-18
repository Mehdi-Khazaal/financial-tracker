# Product

## Register

product

## Users

Fintrack started as a single owner-operator's tool and is now built to be opened to other people. Two kinds of user:

- **The owner-operator** (Mehdi) — daily use, technical, numbers-fluent, wants density and precision, not hand-holding. Quick glances on an iPhone PWA (bottom nav, pull-to-refresh, safe-area insets) and longer review sessions on desktop. Also the admin: sees every user and what the assistant costs per person.
- **Invited users** — people the operator lets in (sign-ups can be closed or gated by an invite code). They get exactly the same product, their own categories, their own bank connections, and never see anyone else's numbers. They arrive with nothing and must reach a meaningful Overview in under two minutes: create an account or connect a bank, keep or trim the default categories, set a budget.

Every user owns their data outright: full export as JSON and CSV, self-serve deletion that also removes bank connections at Plaid and push subscriptions.

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
6. **Nothing happens without you.** The assistant proposes; the user confirms. Every write it wants to make — including what it remembers — waits for a tap.

## Multi-user rules

- Every record is scoped to the account that created it, on every route, job, cron task, push notification and assistant tool. A test suite proves zero cross-visibility.
- The public front door at `/` is a landing page in the Ledger style; the app sits behind sign-in.
- Email verification can be required (`REQUIRE_EMAIL_VERIFICATION`); until verified, the ledger is gated and the person can resend the mail or leave.
- The assistant has per-user daily caps on messages and estimated cost; the operator sees usage per person.
- Privacy Policy and Terms are linked from sign-up and Settings. They are drafts until the operator reviews them.

## Accessibility & Inclusion

- Dark theme only (by design — verify all text ≥4.5:1 against the near-black surfaces)
- `prefers-reduced-motion` honored everywhere: movement removed, opacity transitions kept
- Visible `:focus-visible` rings; hover effects gated behind `(hover: hover)`
- Touch targets ≥44px on mobile
