import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Signup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#070810' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #a855f7, transparent)', filter: 'blur(60px)' }} />
      </div>

      <div className="w-full max-w-sm fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 32px rgba(99,102,241,.3)' }}>
            <span className="text-white font-bold text-xl">F</span>
          </div>
          <h1 className="text-2xl font-bold text-text">Create account</h1>
          <p className="text-muted text-sm mt-1">Start tracking your finances</p>
        </div>

        <div className="card p-6 space-y-4">
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: 'rgba(244,63,94,.1)', color: '#f43f5e', border: '1px solid rgba(244,63,94,.2)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="label mb-2">Email</p>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="input-dark" placeholder="you@example.com" required autoFocus />
            </div>
            <div>
              <p className="label mb-2">Username</p>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                className="input-dark" placeholder="your_name" required />
            </div>
            <div>
              <p className="label mb-2">Password</p>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="input-dark" placeholder="Min. 8 characters" required minLength={8} />
            </div>
            <button type="submit" disabled={loading}
              className="btn-gradient w-full py-3.5 text-base disabled:opacity-60 mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin-slow" />
                  Creating account…
                </span>
              ) : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-center text-muted text-sm mt-6">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold transition-colors" style={{ color: '#6366f1' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
