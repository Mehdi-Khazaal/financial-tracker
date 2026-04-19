import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verifyEmail } from '../utils/api';

const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token found in the link.');
      return;
    }
    verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(err => {
        setStatus('error');
        setMessage(err.response?.data?.detail ?? 'Invalid or expired verification link.');
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="w-full max-w-sm fade-in">
        <div className="flex flex-col items-center mb-8">
          <div style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="mb-4">
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '20px', color: 'var(--accent)' }}>F</span>
          </div>
          <h1 className="text-2xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}>Email Verification</h1>
        </div>

        <div className="card p-8 text-center">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-3">
              <span className="w-8 h-8 rounded-full border-2 border-t-transparent spin-slow"
                style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              <p className="text-muted">Verifying your email…</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-3">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.08)', color: 'var(--pos)' }}>
                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-text font-semibold text-lg">Email verified!</p>
              <p className="text-muted text-sm">Your account is now fully verified.</p>
              <Link to="/" className="btn-gradient inline-block px-6 py-2.5 mt-2 text-sm font-semibold rounded-xl">
                Go to Dashboard
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.08)', color: 'var(--neg)' }}>
                <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <p className="text-text font-semibold">Verification failed</p>
              <p className="text-muted text-sm">{message}</p>
              <Link to="/" className="inline-block text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                Go home
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
