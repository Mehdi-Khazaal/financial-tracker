import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const TopBar: React.FC = () => {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) return null;

  return (
    <div ref={ref} className="fixed top-4 right-4 z-50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-9 h-9 rounded-full flex items-center justify-center font-mono font-bold text-sm shadow-lg transition-all hover:scale-105 active:scale-95"
        style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line-strong)', color: 'var(--accent)' }}>
        {user.username.charAt(0).toUpperCase()}
      </button>

      {open && (
        <div className="absolute right-0 top-11 rounded-xl overflow-hidden shadow-2xl"
          style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', minWidth: '200px' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>{user.username}</p>
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>{user.email}</p>
          </div>
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm transition-colors"
            style={{ color: 'var(--muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--fg)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 shrink-0">
              <path d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" />
            </svg>
            Settings
          </Link>
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="flex items-center gap-3 w-full px-4 py-3 text-sm"
            style={{ color: 'var(--neg)', borderTop: '1px solid var(--line)' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h5a2 2 0 012 2v1M3 3v12a2 2 0 002 2h10a2 2 0 002-2V8m0 0h-5a2 2 0 00-2-2V3m5 5l3-3m0 0l-3-3m3 3H10" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

export default TopBar;
