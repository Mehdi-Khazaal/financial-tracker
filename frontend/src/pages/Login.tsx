import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(identifier, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="w-full max-w-sm fade-in">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', borderRadius: '8px', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="mb-4">
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '20px', color: 'var(--accent)' }}>F</span>
          </div>
          <h1 className="text-2xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}>Welcome back</h1>
          <p className="text-muted text-sm mt-1">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="card p-6 space-y-4">
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.08)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.15)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="label mb-2">Email or Username</p>
              <input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)}
                className="input-dark" placeholder="you@example.com" required autoFocus />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="label">Password</p>
                <Link to="/forgot-password" className="text-xs transition-colors" style={{ color: 'var(--accent)' }}>
                  Forgot password?
                </Link>
              </div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="input-dark" placeholder="••••••••" required />
            </div>
            <button type="submit" disabled={loading}
              className="btn-gradient w-full py-3.5 text-base disabled:opacity-60 mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin-slow" />
                  Signing in…
                </span>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-muted text-sm mt-6">
          Don't have an account?{' '}
          <Link to="/signup" className="font-semibold transition-colors" style={{ color: 'var(--accent)' }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
