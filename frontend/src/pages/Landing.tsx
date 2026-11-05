import React from 'react';
import { Link } from 'react-router-dom';
import LogoMark from '../components/LogoMark';

/**
 * The public front door at `/` for someone who is not signed in.
 *
 * Same system as the app: one typeface, one blue, big plain numbers, and
 * rules between things instead of boxes. The example keeps a frame because
 * it stands for a screen of the app. One column on a phone, two at desktop
 * width, no images to load: it paints from the CSS the app already ships.
 */

const FEATURES: { label: string; title: string; body: string }[] = [
  {
    label: 'Ledger',
    title: 'Every account in one column.',
    body: 'Chequing, savings, cards, cash and what you have lent out — reconciled to one net-worth figure you can trust, updated the moment a transaction lands.',
  },
  {
    label: 'Banks',
    title: 'Connect once, categorize never.',
    body: 'Link a bank through Plaid and imports arrive already filed, learning from how you categorized that merchant before. Manual entries take under five seconds.',
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
  { label: 'Available to spend', value: '$9,412.80', tone: 'var(--fg)' },
  { label: 'Spent this month', value: '$2,318.40', tone: 'var(--fg)' },
  { label: 'Recurring due', value: '$412.00', tone: 'var(--fg)' },
];

const Landing: React.FC = () => (
  <main className="min-h-dvh" style={{ backgroundColor: 'var(--bg)', color: 'var(--fg)' }}>
    {/* Top bar */}
    <header className="mx-auto w-full max-w-6xl px-4 md:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <LogoMark size={32} />
        <span className="text-base font-semibold" style={{ color: 'var(--fg)', letterSpacing: '-0.01em' }}>Fintrack</span>
      </div>
      <nav className="flex items-center gap-2" aria-label="Account">
        <Link to="/login" className="btn-ghost pressable px-4" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', fontSize: 13 }}>
          Sign in
        </Link>
        <Link to="/signup" className="btn-gradient pressable px-4" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', fontSize: 13 }}>
          Create account
        </Link>
      </nav>
    </header>

    {/* Hero */}
    <section className="mx-auto w-full max-w-6xl px-4 md:px-6 pt-10 md:pt-20 pb-16 grid gap-10 md:grid-cols-[1.1fr_0.9fr] md:items-center">
      <div className="stagger-in">
        <p className="label mb-4">Personal finance, kept like a ledger</p>
        <h1
          className="font-semibold"
          style={{ fontSize: 'clamp(2.4rem, 7vw, 4.25rem)', lineHeight: 1.02, letterSpacing: '-0.035em' }}
        >
          Where does your money stand right now?
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

      {/* Example: a screen of the app with illustrative numbers */}
      <div className="card p-5 md:p-6" aria-label="Example overview">
        <p className="label">Net worth · example</p>
        <p className="value-display mt-2" style={{ fontSize: 'clamp(2.2rem, 6vw, 3rem)' }}>$48,210.55</p>
        <p className="text-sm font-medium mt-1" style={{ color: 'var(--pos)' }}>+$1,204.12 this month</p>
        <dl className="mt-6 grid grid-cols-3" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
          {SAMPLE.map((item, i) => (
            <div key={item.label} className={`py-3 pr-3 ${i ? 'pl-3' : ''}`} style={i ? { borderLeft: '1px solid var(--line)' } : undefined}>
              <dt className="text-xs" style={{ color: 'var(--muted)' }}>{item.label}</dt>
              <dd className="tabular-nums mt-1 text-sm font-semibold" style={{ color: item.tone }}>{item.value}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-2" aria-label="Example transactions">
          {[
            ['Whole Foods', 'Groceries', '−$84.12'],
            ['Salary', 'Income', '+$4,200.00'],
            ['Spotify', 'Subscriptions', '−$15.99'],
          ].map(([name, cat, amt], i) => (
            <li key={name} className="flex items-center justify-between py-2.5 text-sm" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
              <span>
                <span className="font-medium">{name}</span>
                <span className="ml-2 text-xs" style={{ color: 'var(--dim)' }}>{cat}</span>
              </span>
              <span className="tabular-nums" style={{ color: amt.startsWith('+') ? 'var(--pos)' : 'var(--fg)' }}>{amt}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>

    {/* Features */}
    <section className="mx-auto w-full max-w-6xl px-4 md:px-6 pb-20 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4" aria-label="What Fintrack does">
      {FEATURES.map(feature => (
        <article key={feature.label} className="pt-4" style={{ borderTop: '2px solid var(--fg)' }}>
          <p className="label mb-3">{feature.label}</p>
          <h2 className="text-lg font-semibold mb-2" style={{ letterSpacing: '-0.01em' }}>{feature.title}</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{feature.body}</p>
        </article>
      ))}
    </section>

    {/* Trust */}
    <section className="mx-auto w-full max-w-6xl px-4 md:px-6 pb-16">
      <div className="pt-6 grid gap-x-8 gap-y-6 md:grid-cols-3" style={{ borderTop: '1px solid var(--line)' }}>
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
