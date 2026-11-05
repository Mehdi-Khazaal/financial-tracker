import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getSignupPolicy } from '../utils/api';
import LogoMark from '../components/LogoMark';

const Signup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  // Read without a session so the page can say up front whether sign-ups are
  // open and whether an invite code is needed, instead of failing on submit.
  const [policy, setPolicy] = useState<{ open: boolean; invite_required: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSignupPolicy()
      .then(res => { if (!cancelled) setPolicy(res.data); })
      .catch(() => { if (!cancelled) setPolicy({ open: true, invite_required: false }); });
    return () => { cancelled = true; };
  }, []);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signup(email, username, password, policy?.invite_required ? inviteCode : undefined);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Signup failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'color-mix(in oklab, var(--fg) 2.8%, transparent)',
    border: '1px solid color-mix(in oklab, var(--fg) 8%, transparent)',
    borderRadius: '12px',
    padding: '14px 16px',
    fontSize: '15px',
    fontFamily: 'var(--font-mono)',
    color: 'var(--fg)',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    boxSizing: 'border-box',
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'color-mix(in oklab, var(--accent) 45%, transparent)';
    e.target.style.boxShadow = '0 0 0 3px var(--accent-dim)';
  };
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'color-mix(in oklab, var(--fg) 8%, transparent)';
    e.target.style.boxShadow = 'none';
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.13em',
    color: 'var(--muted)',
    marginBottom: '8px',
  };

  return (
    <div style={{
      minHeight: '100svh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.25rem',
      backgroundColor: 'var(--bg)',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* ── Content ──────────────────────────────────────────────── */}
      <div style={{ width: '100%', maxWidth: '400px', position: 'relative', zIndex: 10 }}>

        {/* Logo + heading */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          marginBottom: '2rem',
          animation: 'authReveal 0.65s cubic-bezier(.32,1,.4,1) both',
          animationDelay: '0.05s',
        }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <LogoMark size={56} title="Fintrack" />
          </div>

          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(1.85rem, 5.5vw, 2.4rem)',
            letterSpacing: '-0.025em',
            color: 'var(--fg)',
            lineHeight: 1.05,
            margin: 0,
            marginBottom: '0.5rem',
            textAlign: 'center',
          }}>
            Create account
          </h1>

          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            letterSpacing: '0.11em',
            color: 'var(--muted)',
            margin: 0,
          }}>
            Start your financial journey
          </p>
        </div>

        {/* Auth card */}
        <div style={{
          background: 'var(--elev-1)',
          borderRadius: '18px',
          border: '1px solid var(--line-strong)',
          boxShadow: 'none',
          padding: '2rem',
          animation: 'authReveal 0.65s cubic-bezier(.32,1,.4,1) both',
          animationDelay: '0.18s',
        }}>

          {error && (
            <div style={{
              background: 'color-mix(in oklab, var(--neg) 7%, transparent)',
              border: '1px solid color-mix(in oklab, var(--neg) 18%, transparent)',
              borderRadius: '10px',
              padding: '11px 15px',
              marginBottom: '1.25rem',
              color: 'var(--neg)',
              fontSize: '12.5px',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.015em',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                style={inputStyle}
                onFocus={handleFocus}
                onBlur={handleBlur}
              />
            </div>

            <div>
              <label style={labelStyle}>Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="your_name"
                required
                style={inputStyle}
                onFocus={handleFocus}
                onBlur={handleBlur}
              />
            </div>

            <div>
              <label style={labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  required
                  minLength={8}
                  style={{ ...inputStyle, padding: '14px 48px 14px 16px' }}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  tabIndex={-1}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                    color: 'var(--dim)', transition: 'color 0.15s', lineHeight: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--muted)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
                  {showPass ? (
                    <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
                      <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/>
                      <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {policy?.invite_required && (
              <div>
                <label style={labelStyle} htmlFor="signup-invite">Invite code</label>
                <input
                  id="signup-invite"
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  placeholder="From your invitation"
                  required
                  autoComplete="off"
                  style={inputStyle}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                />
              </div>
            )}

            {policy && !policy.open && (
              <p role="status" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.6 }}>
                Sign-ups are closed for now. If you already have an account you can still sign in.
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || (policy !== null && !policy.open)}
              style={{
                width: '100%',
                padding: '15px',
                marginTop: '0.25rem',
                borderRadius: '12px',
                border: 'none',
                background: loading
                  ? 'color-mix(in oklab, var(--accent) 45%, transparent)'
                  : 'var(--accent)',
                color: 'var(--ink-on-fill)',
                fontSize: '15px',
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                letterSpacing: '-0.01em',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: 'none',
                transition: 'box-shadow 0.2s, transform 0.2s',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={e => {
                if (!loading) {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={e => {
                if (!loading) {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
              onMouseDown={e => { if (!loading) e.currentTarget.style.transform = 'translateY(0) scale(0.985)'; }}
              onMouseUp={e => { if (!loading) e.currentTarget.style.transform = 'translateY(-1px)'; }}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black spin-slow" />
                  Creating account…
                </span>
              ) : 'Create Account'}
            </button>

          </form>
        </div>

        {/* Footer */}
        <div style={{
          animation: 'authReveal 0.65s cubic-bezier(.32,1,.4,1) both',
          animationDelay: '0.32s',
        }}>
          <p style={{
            textAlign: 'center',
            marginTop: '1.25rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--dim)',
            lineHeight: 1.7,
          }}>
            By creating an account you agree to the{' '}
            <Link to="/terms" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>Terms</Link>
            {' '}and{' '}
            <Link to="/privacy" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>

          <p style={{
            textAlign: 'center',
            marginTop: '1.5rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--muted)',
            letterSpacing: '0.02em',
          }}>
            Already have an account?{' '}
            <Link to="/login" style={{
              color: 'var(--accent)',
              fontWeight: 600,
              textDecoration: 'none',
              transition: 'opacity 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
              Sign in
            </Link>
          </p>

          {/* Brand rule */}
          <div style={{
            marginTop: '2.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--line)' }} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              letterSpacing: '0.18em',
              color: 'var(--dim)',
            }}>Fintrack</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--line)' }} />
          </div>
        </div>

      </div>
    </div>
  );
};

export default Signup;
