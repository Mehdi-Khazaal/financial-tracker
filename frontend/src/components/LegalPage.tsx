import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Shell for the Privacy Policy and Terms pages.
 *
 * Public, text-first, and honest about its status: the copy is a draft for
 * the operator to review before real users rely on it, and the banner says so
 * until `draft` is turned off. Reads well at 390 px — one column, generous
 * line length, mono labels for dates — and uses the same tokens as the app.
 */
interface Props {
  title: string;
  updated: string;
  draft?: boolean;
  children: React.ReactNode;
}

const LegalPage: React.FC<Props> = ({ title, updated, draft = true, children }) => (
  <main
    className="min-h-dvh px-4 py-10 md:py-16"
    style={{ backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
  >
    <article className="mx-auto w-full" style={{ maxWidth: '68ch' }}>
      <Link to="/" className="label inline-flex items-center gap-2 mb-8" style={{ color: 'var(--accent)' }}>
        <span aria-hidden="true">←</span> Fintrack
      </Link>

      {draft && (
        <div
          role="note"
          className="card p-4 mb-8"
          style={{ borderColor: 'rgba(249,115,22,0.35)' }}
        >
          <p className="label mb-1" style={{ color: 'var(--accent)' }}>Draft</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            This document is a draft prepared for the operator to review. It is not yet a binding statement and
            may change before Fintrack is opened to other users.
          </p>
        </div>
      )}

      <h1
        className="mb-2"
        style={{ fontFamily: 'var(--font-money)', fontSize: 'clamp(2rem, 6vw, 2.75rem)', lineHeight: 1.1, letterSpacing: '-0.02em' }}
      >
        {title}
      </h1>
      <p className="label mb-10" style={{ color: 'var(--dim)' }}>Last updated {updated}</p>

      <div className="legal-body space-y-8 text-[15px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        {children}
      </div>

      <footer className="mt-16 pt-6 flex flex-wrap gap-4 label" style={{ borderTop: '1px solid var(--line)', color: 'var(--dim)' }}>
        <Link to="/privacy" style={{ color: 'var(--muted)' }}>Privacy</Link>
        <Link to="/terms" style={{ color: 'var(--muted)' }}>Terms</Link>
        <Link to="/login" style={{ color: 'var(--muted)' }}>Sign in</Link>
      </footer>
    </article>
  </main>
);

export const LegalSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section>
    <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--fg)' }}>{title}</h2>
    {children}
  </section>
);

export default LegalPage;
