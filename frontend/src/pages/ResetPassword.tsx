import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { resetPassword } from '../utils/api';

const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Invalid or expired reset link');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="card p-8 text-center max-w-sm w-full">
          <p className="text-muted">Invalid reset link.</p>
          <Link to="/forgot-password" className="mt-4 inline-block font-semibold" style={{ color: 'var(--accent)' }}>
            Request a new one
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="w-full max-w-sm fade-in">
        <div className="flex flex-col items-center mb-8">
          <div style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="mb-4">
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '20px', color: 'var(--accent)' }}>F</span>
          </div>
          <h1 className="text-2xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}>New password</h1>
          <p className="text-muted text-sm mt-1">Choose a strong password</p>
        </div>

        <div className="card p-6">
          {done ? (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
                style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.08)', color: 'var(--pos)' }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-text font-medium">Password updated!</p>
              <p className="text-muted text-sm">Redirecting you to sign in…</p>
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
                <p className="label mb-2">New password</p>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  className="input-dark" placeholder="At least 8 characters" required autoFocus minLength={8} />
              </div>
              <div>
                <p className="label mb-2">Confirm password</p>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  className="input-dark" placeholder="••••••••" required />
              </div>
              <button type="submit" disabled={loading}
                className="btn-gradient w-full py-3.5 text-base disabled:opacity-60">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin-slow" />
                    Saving…
                  </span>
                ) : 'Set New Password'}
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

export default ResetPassword;
