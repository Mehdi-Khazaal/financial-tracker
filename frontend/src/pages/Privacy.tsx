import React from 'react';
import LegalPage, { LegalSection } from '../components/LegalPage';

const Privacy: React.FC = () => (
  <LegalPage title="Privacy Policy" updated="17 September 2026">
    <LegalSection title="What Fintrack is">
      <p>
        Fintrack is a personal finance tracker. It stores the financial records you enter or import so it can
        show you balances, spending, recurring bills, goals and an AI-assisted view of your money. It is operated
        by an individual, not a company; the operator&apos;s contact details will appear here before launch.
      </p>
    </LegalSection>

    <LegalSection title="Data we store">
      <ul className="list-disc pl-5 space-y-1">
        <li><strong style={{ color: 'var(--fg)' }}>Account data</strong>: your email address, username, a hashed password, your time zone, and settings.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Financial records</strong>: accounts, transactions, transfers, assets, savings goals, loans, recurring bills and categories, whether typed in or imported from a bank.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Bank connections</strong>: when you connect a bank through Plaid, an access token for that connection is stored encrypted. Fintrack never sees or stores your bank credentials.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Assistant conversations</strong>: messages you exchange with the assistant, and the facts you confirm it may remember.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Device tokens</strong> for push notifications, if you turn them on.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Operational logs</strong>: request identifiers, timestamps, status codes and error reports. Logs do not contain passwords, bank tokens or transaction descriptions.</li>
      </ul>
    </LegalSection>

    <LegalSection title="Who processes it">
      <p>Fintrack relies on a small number of service providers, each receiving only what its job requires:</p>
      <ul className="list-disc pl-5 space-y-1 mt-2">
        <li><strong style={{ color: 'var(--fg)' }}>Plaid</strong> — connects to your bank and returns account balances and transactions.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Anthropic</strong> — runs the assistant. Your question and the ledger data the assistant reads to answer it are sent to Anthropic for the duration of the request and are not used to train models.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Neon</strong> (database), <strong style={{ color: 'var(--fg)' }}>Render</strong> (API hosting) and <strong style={{ color: 'var(--fg)' }}>Vercel</strong> (web hosting).</li>
        <li><strong style={{ color: 'var(--fg)' }}>Resend</strong> — delivers verification and password-reset email.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Sentry</strong> — receives error reports without personal data, only when the operator has enabled it.</li>
        <li><strong style={{ color: 'var(--fg)' }}>CoinGecko and Yahoo Finance</strong> — provide market prices; they receive only the ticker symbol you look up.</li>
      </ul>
    </LegalSection>

    <LegalSection title="What we do not do">
      <ul className="list-disc pl-5 space-y-1">
        <li>We do not sell your data or share it with advertisers.</li>
        <li>We do not use your financial records to train AI models.</li>
        <li>We do not read another user&apos;s data to serve yours; every record is scoped to the account that created it.</li>
      </ul>
    </LegalSection>

    <LegalSection title="Your controls">
      <ul className="list-disc pl-5 space-y-1">
        <li><strong style={{ color: 'var(--fg)' }}>Export</strong> everything at any time from Settings → Account, as JSON and CSV.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Disconnect</strong> a bank from Settings → Connections; the connection is removed at Plaid too.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Delete</strong> your account from Settings → Account. Bank connections are removed at Plaid, push tokens are discarded, and every record is deleted immediately. Backups expire within 30 days.</li>
        <li>Forget any assistant memory from the assistant&apos;s memory list.</li>
      </ul>
    </LegalSection>

    <LegalSection title="Security">
      <p>
        Traffic is encrypted in transit. Passwords are hashed with bcrypt. Bank access tokens are encrypted at rest with a
        key held separately from the database. Sign-in is protected by rate limits and per-account lockout. Sessions can be
        revoked by changing your password or signing out.
      </p>
    </LegalSection>

    <LegalSection title="Retention">
      <p>
        Records are kept while your account exists. Operational logs are retained for a short, fixed period by the hosting
        providers. Deleting your account deletes your records immediately.
      </p>
    </LegalSection>

    <LegalSection title="Changes and contact">
      <p>
        Material changes to this policy will be announced in the app before they take effect. Questions go to the
        operator at the address published on this page before launch.
      </p>
    </LegalSection>
  </LegalPage>
);

export default Privacy;
