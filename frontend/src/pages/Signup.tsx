import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Signup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signup(email, username, password);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Signup failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.028)',
    border: '1px solid rgba(255,255,255,0.08)',
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
    e.target.style.borderColor = 'rgba(249,115,22,0.45)';
    e.target.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.09), 0 0 22px rgba(249,115,22,0.06)';
  };
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'rgba(255,255,255,0.08)';
    e.target.style.boxShadow = 'none';
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.13em',
    textTransform: 'uppercase',
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
      backgroundColor: '#0A0A0B',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* ── Ambient orbs ─────────────────────────────────────────── */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: '-10%', right: '-12%',
        width: 'min(70vw, 540px)', height: 'min(70vw, 540px)',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(249,115,22,0.18) 0%, rgba(249,115,22,0.06) 42%, transparent 68%)',
        filter: 'blur(48px)',
        animation: 'authOrb 10s ease-in-out infinite',
        pointerEvents: 'none',
      }} />
      <div aria-hidden="true" style={{
        position: 'absolute', bottom: '-6%', left: '-8%',
        width: 'min(40vw, 340px)', height: 'min(40vw, 340px)',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 65%)',
        filter: 'blur(32px)',
        animation: 'authOrb 14s ease-in-out infinite reverse',
        pointerEvents: 'none',
      }} />

      {/* ── Dot-grid texture ─────────────────────────────────────── */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.022) 1px, transparent 1px)',
        backgroundSize: '30px 30px',
        pointerEvents: 'none',
      }} />

      {/* ── Vignettes ────────────────────────────────────────────── */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '28%',
        background: 'linear-gradient(to bottom, rgba(10,10,11,0.9), transparent)',
        pointerEvents: 'none',
      }} />
      <div aria-hidden="true" style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '20%',
        background: 'linear-gradient(to top, rgba(10,10,11,0.7), transparent)',
        pointerEvents: 'none',
      }} />

      {/* ── Content ──────────────────────────────────────────────── */}
      <div style={{ width: '100%', maxWidth: '400px', position: 'relative', zIndex: 10 }}>

        {/* Logo + heading */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          marginBottom: '2rem',
          animation: 'authReveal 0.65s cubic-bezier(.32,1,.4,1) both',
          animationDelay: '0.05s',
        }}>
          <div style={{
            width: '68px', height: '68px', borderRadius: '20px',
            background: 'linear-gradient(140deg, #F97316 0%, #C2410C 100%)',
            boxShadow: '0 0 0 1px rgba(249,115,22,0.25), 0 10px 40px rgba(249,115,22,0.45), 0 0 90px rgba(249,115,22,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '1.75rem',
          }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: '30px', color: '#fff', lineHeight: 1, fontStyle: 'italic' }}>F</span>
          </div>

          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(1.85rem, 5.5vw, 2.4rem)',
            fontStyle: 'italic',
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
            textTransform: 'uppercase',
            color: 'var(--muted)',
            margin: 0,
          }}>
            Start your financial journey
          </p>
        </div>

        {/* Glass card */}
        <div style={{
          background: 'rgba(17,17,19,0.72)',
          backdropFilter: 'blur(28px) saturate(160%)',
          WebkitBackdropFilter: 'blur(28px) saturate(160%)',
          borderRadius: '22px',
          border: '1px solid rgba(255,255,255,0.07)',
          borderTop: '1px solid rgba(255,255,255,0.13)',
          boxShadow: '0 48px 96px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.25) inset',
          padding: '2rem',
          animation: 'authReveal 0.65s cubic-bezier(.32,1,.4,1) both',
          animationDelay: '0.18s',
        }}>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.18)',
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

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '15px',
                marginTop: '0.25rem',
                borderRadius: '12px',
                border: 'none',
                background: loading
                  ? 'rgba(249,115,22,0.45)'
                  : 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                letterSpacing: '-0.01em',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 8px 28px rgba(249,115,22,0.38), 0 2px 8px rgba(0,0,0,0.3)',
                transition: 'box-shadow 0.2s, transform 0.2s',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={e => {
                if (!loading) {
                  e.currentTarget.style.boxShadow = '0 14px 36px rgba(249,115,22,0.5), 0 2px 8px rgba(0,0,0,0.3)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={e => {
                if (!loading) {
                  e.currentTarget.style.boxShadow = '0 8px 28px rgba(249,115,22,0.38), 0 2px 8px rgba(0,0,0,0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
              onMouseDown={e => { if (!loading) e.currentTarget.style.transform = 'translateY(0) scale(0.985)'; }}
              onMouseUp={e => { if (!loading) e.currentTarget.style.transform = 'translateY(-1px)'; }}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin-slow" />
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
            <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.06))' }} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              letterSpacing: '0.18em',
              color: 'var(--dim)',
              textTransform: 'uppercase',
            }}>Fintrack</span>
            <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to left, transparent, rgba(255,255,255,0.06))' }} />
          </div>
        </div>

      </div>
    </div>
  );
};

export default Signup;
