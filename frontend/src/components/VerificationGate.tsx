import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { VERIFICATION_REQUIRED_EVENT, resendVerification } from '../utils/api';

/**
 * Shown when the server refuses data routes because the email address has
 * not been verified (deployments with `REQUIRE_EMAIL_VERIFICATION=true`).
 *
 * A full-screen gate rather than a banner: with enforcement on, nothing
 * behind it can load anyway, and a page of empty error states would be worse
 * than a plain explanation with the two things that help — resend the mail,
 * or sign out. The gate closes itself once the session says verified.
 */
const VerificationGate: React.FC = () => {
  const { user, logout, refresh } = useAuth();
  const [required, setRequired] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const show = () => setRequired(true);
    window.addEventListener(VERIFICATION_REQUIRED_EVENT, show);
    return () => window.removeEventListener(VERIFICATION_REQUIRED_EVENT, show);
  }, []);

  useEffect(() => {
    if (user?.is_verified) setRequired(false);
  }, [user?.is_verified]);

  if (!required || !user || user.is_verified) return null;

  const resend = async () => {
    setBusy(true);
    try {
      const res = await resendVerification();
      setSent(res.data.message);
    } catch {
      setSent('Could not send the email right now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-gate-title"
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 'var(--z-modal)' as unknown as number, backgroundColor: 'var(--bg)' }}
    >
      <div className="card p-6 w-full" style={{ maxWidth: 420 }}>
        <p className="label mb-3" style={{ color: 'var(--accent)' }}>One more step</p>
        <h1 id="verify-gate-title" className="text-xl font-semibold mb-2" style={{ letterSpacing: '-0.01em' }}>
          Verify your email
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
          We sent a link to <span style={{ color: 'var(--fg)' }}>{user.email}</span>. Open it to unlock your ledger.
          Already did? <button type="button" className="underline" style={{ color: 'var(--accent)' }} onClick={() => { void refresh(); }}>Check again</button>.
        </p>
        {sent && <p className="text-sm mt-3" style={{ color: 'var(--pos)' }} role="status">{sent}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" className="btn-gradient pressable" style={{ minHeight: 44 }} onClick={() => { void resend(); }} disabled={busy}>
            {busy ? 'Sending…' : 'Resend the email'}
          </button>
          <button type="button" className="btn-ghost pressable" style={{ minHeight: 44 }} onClick={() => { void logout(); }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default VerificationGate;
