import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../utils/api';

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="w-full max-w-sm fade-in">
        <div className="flex flex-col items-center mb-8">
          <div style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="mb-4">
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '20px', color: 'var(--accent)' }}>F</span>
          </div>
          <h1 className="text-2xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}>Reset password</h1>
          <p className="text-muted text-sm mt-1 text-center">
            Enter your email and we'll send a reset link
          </p>
        </div>

        <div className="card p-6">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
                style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.08)', color: 'var(--pos)' }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-text font-medium">Check your inbox</p>
              <p className="text-muted text-sm">
                If <strong>{email}</strong> is registered, you'll receive a reset link shortly.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl px-4 py-3 text-sm font-medium"
                  style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.08)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.15)' }}>
                  {error}
                </div>
              )}
              <div>
                <p className="label mb-2">Email address</p>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="input-dark" placeholder="you@example.com" required autoFocus />
              </div>
              <button type="submit" disabled={loading}
                className="btn-gradient w-full py-3.5 text-base disabled:opacity-60">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin-slow" />
                    Sending…
                  </span>
                ) : 'Send Reset Link'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-muted text-sm mt-6">
          <Link to="/login" className="font-semibold transition-colors" style={{ color: 'var(--accent)' }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;
