import React from 'react';
import { Link } from 'react-router-dom';

/**
 * The public front door at `/` for someone who is not signed in.
 *
 * Built to the same brief as the product: the number is the hero, one ember
 * accent, serif money, mono labels, nothing that moves for longer than 250 ms.
 * It is a single column on a phone and a two-column hero at desktop width.
 * No marketing library, no images to load — it paints from the CSS the app
 * already ships.
 */

const FEATURES: { label: string; title: string; body: string }[] = [
  {
    label: 'Ledger',
    title: 'Every account in one column.',
    body: 'Chequing, savings, cards, cash and what you have lent out — reconciled to one net-worth figure you can trust, updated the moment a transaction lands.',
  },
  {
    label: 'Banks',
    title: 'Connect once, categorise never.',
    body: 'Link a bank through Plaid and imports arrive already filed, learning from how you categorised that merchant before. Manual entries take under five seconds.',
  },
  {
    label: 'Recurring',
    title: 'Bills you never forget again.',
    body: 'Subscriptions and bills are detected from history, tracked against the real charge, and flagged when a price rises or a payment goes missing.',
  },
  {
    label: 'Fin',
    title: 'An analyst, not a chatbot.',
    body: 'Ask what you can afford, what a plan would look like in five years, or where the money went. Fin reads your ledger, checks live prices, and gives an opinion. It never changes anything without your confirmation.',
  },
];

const SAMPLE = [
  { label: 'Net worth', value: '$48,210.55', tone: 'var(--fg)' },
  { label: 'This month', value: '−$2,318.40', tone: 'var(--neg)' },
  { label: 'Recurring due', value: '$412.00', tone: 'var(--fg)' },
];

const Landing: React.FC = () => (
  <main className="min-h-dvh" style={{ backgroundColor: 'var(--bg)', color: 'var(--fg)' }}>
    {/* Top bar */}
    <header className="mx-auto w-full max-w-6xl px-4 md:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(140deg, #F97316 0%, #C2410C 100%)', boxShadow: '0 6px 20px rgba(249,115,22,0.35)' }}
        >
          <span style={{ fontFamily: 'var(--font-money)', fontStyle: 'italic', color: '#fff', fontSize: 18, lineHeight: 1 }}>F</span>
        </div>
        <span className="label" style={{ color: 'var(--muted)' }}>Fintrack</span>
      </div>
      <nav className="flex items-center gap-2" aria-label="Account">
        <Link to="/login" className="btn-ghost pressable px-4" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', fontSize: 13 }}>
          Sign in
        </Link>
        <Link to="/signup" className="btn-gradient pressable px-4" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', fontSize: 13 }}>
          Create account
        </Link>
      </nav>
    </header>

    {/* Hero */}
    <section className="mx-auto w-full max-w-6xl px-4 md:px-6 pt-10 md:pt-20 pb-16 grid gap-10 md:grid-cols-[1.1fr_0.9fr] md:items-center">
      <div className="stagger-in">
        <p className="label mb-4" style={{ color: 'var(--accent)' }}>Personal finance, kept like a ledger</p>
        <h1
          style={{
            fontFamily: 'var(--font-money)',
            fontSize: 'clamp(2.4rem, 7vw, 4.25rem)',
            lineHeight: 1.02,
            letterSpacing: '-0.03em',
          }}
        >
          Where does your money stand <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>right now?</em>
        </h1>
        <p className="mt-5 text-[15px] md:text-base leading-relaxed" style={{ color: 'var(--muted)', maxWidth: '52ch' }}>
          One number you can trust, one tap to see where it is going. Accounts, bank imports, recurring bills,
          goals and an analyst that reads your ledger — on your phone, without the confetti.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/signup" className="btn-gradient pressable px-5" style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', fontSize: 15 }}>
            Start tracking
          </Link>
          <Link to="/login" className="btn-ghost pressable px-5" style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', fontSize: 15 }}>
            I have an account
          </Link>
        </div>
        <p className="label mt-6" style={{ color: 'var(--dim)' }}>Free while in beta · Export or delete everything, any time</p>
      </div>

      {/* Sample card: the product's hero card, with illustrative numbers */}
      <div className="card hero-card p-5 md:p-6" aria-label="Example overview">
        <p className="label" style={{ color: 'var(--muted)' }}>Net worth · example</p>
        <p className="value-display mt-2" style={{ fontSize: 'clamp(2.2rem, 6vw, 3rem)' }}>$48,210.55</p>
        <p className="label mt-2" style={{ color: 'var(--pos)' }}>▲ $1,204.12 this month</p>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {SAMPLE.map(item => (
            <div key={item.label} className="rounded-xl p-3" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
              <p className="label" style={{ color: 'var(--dim)', fontSize: 9 }}>{item.label}</p>
              <p className="tabular-nums mt-1 text-sm font-semibold" style={{ color: item.tone, fontFamily: 'var(--font-mono)' }}>{item.value}</p>
            </div>
          ))}
        </div>
        <ul className="mt-6 space-y-2" aria-label="Example transactions">
          {[
            ['Whole Foods', 'Groceries', '−$84.12'],
            ['Salary', 'Income', '+$4,200.00'],
            ['Spotify', 'Subscriptions', '−$15.99'],
          ].map(([name, cat, amt]) => (
            <li key={name} className="flex items-center justify-between text-sm">
              <span>
                <span className="font-medium">{name}</span>
                <span className="label ml-2" style={{ color: 'var(--dim)', fontSize: 9 }}>{cat}</span>
              </span>
              <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: amt.startsWith('+') ? 'var(--pos)' : 'var(--fg)' }}>{amt}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>

    {/* Features */}
    <section className="mx-auto w-full max-w-6xl px-4 md:px-6 pb-20 grid gap-4 md:grid-cols-2" aria-label="What Fintrack does">
      {FEATURES.map(feature => (
        <article key={feature.label} className="card p-5 md:p-6">
          <p className="label mb-3" style={{ color: 'var(--accent)' }}>{feature.label}</p>
          <h2 className="text-lg font-semibold mb-2" style={{ letterSpacing: '-0.01em' }}>{feature.title}</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{feature.body}</p>
        </article>
      ))}
    </section>

    {/* Trust */}
    <section className="mx-auto w-full max-w-6xl px-4 md:px-6 pb-16">
      <div className="card p-5 md:p-6 grid gap-4 md:grid-cols-3">
        {[
          ['Your data is yours', 'Export everything as JSON or CSV, or delete the account and every record with it, from Settings.'],
          ['Banks stay behind Plaid', 'Fintrack never sees a bank password. Access tokens are encrypted at rest with a separate key.'],
          ['Nothing happens without you', 'Fin proposes; you confirm. Every write the assistant wants to make waits for a tap.'],
        ].map(([title, body]) => (
          <div key={title}>
            <h3 className="text-sm font-semibold mb-1">{title}</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{body}</p>
          </div>
        ))}
      </div>
    </section>

    <footer className="mx-auto w-full max-w-6xl px-4 md:px-6 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-wrap items-center gap-x-5 gap-y-2 label" style={{ color: 'var(--dim)', borderTop: '1px solid var(--line)', paddingTop: '1.25rem' }}>
      <span>© 2026 Fintrack</span>
      <Link to="/privacy" style={{ color: 'var(--muted)' }}>Privacy</Link>
      <Link to="/terms" style={{ color: 'var(--muted)' }}>Terms</Link>
    </footer>
  </main>
);

export default Landing;
