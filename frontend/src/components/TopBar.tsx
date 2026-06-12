import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';

const EyeIcon: React.FC<{ off: boolean }> = ({ off }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}
    strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
    {off ? (
      <path d="M3 3l14 14M8.5 8.6a2.5 2.5 0 003.4 3.4M5.6 5.8C4 6.9 2.9 8.4 2.5 10c1 3 4 5.5 7.5 5.5 1.3 0 2.6-.35 3.7-.95M9 4.6c.33-.04.66-.06 1-.06 3.5 0 6.5 2.5 7.5 5.5-.25.76-.62 1.5-1.1 2.15" />
    ) : (
      <path d="M2.5 10C3.5 7 6.5 4.5 10 4.5S16.5 7 17.5 10c-1 3-4 5.5-7.5 5.5S3.5 13 2.5 10zm10 0a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
    )}
  </svg>
);

const TopBar: React.FC = () => {
  const { user, logout } = useAuth();
  const { privacy, togglePrivacy, setPaletteOpen } = useUI();
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
    <div ref={ref} className="fixed flex items-center gap-2"
      style={{
        zIndex: 'var(--z-topbar)' as any,
        top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
        right: 'calc(env(safe-area-inset-right, 0px) + 1rem)',
      }}>

      {/* Search / command palette — desktop only; mobile keeps the bottom nav */}
      <button
        onClick={() => setPaletteOpen(true)}
        aria-label="Open command palette"
        title="Search & commands (⌘K)"
        className="pressable w-9 h-9 rounded-full hidden md:flex items-center justify-center"
        style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line-strong)', color: 'var(--muted)', boxShadow: 'var(--edge-light), var(--shadow-card)' }}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}
          strokeLinecap="round" className="w-[17px] h-[17px]">
          <path d="M13.5 13.5L17 17M9 14.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11z" />
        </svg>
      </button>

      {/* Privacy mode */}
      <button
        onClick={togglePrivacy}
        aria-label={privacy ? 'Show amounts' : 'Hide amounts'}
        aria-pressed={privacy}
        title={privacy ? 'Show amounts' : 'Hide amounts'}
        className="pressable w-9 h-9 rounded-full flex items-center justify-center"
        style={{
          backgroundColor: 'var(--elev-1)',
          border: `1px solid ${privacy ? 'rgba(249,115,22,0.4)' : 'var(--line-strong)'}`,
          color: privacy ? 'var(--accent)' : 'var(--muted)',
          boxShadow: 'var(--edge-light), var(--shadow-card)',
          transition: 'color 160ms ease, border-color 160ms ease',
        }}>
        <EyeIcon off={privacy} />
      </button>

      {/* Avatar */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        className="pressable w-9 h-9 rounded-full flex items-center justify-center font-mono font-bold text-sm"
        style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line-strong)', color: 'var(--accent)', boxShadow: 'var(--edge-light), var(--shadow-card)' }}>
        {user.username.charAt(0).toUpperCase()}
      </button>

      {open && (
        <div className="absolute right-0 top-11 rounded-xl overflow-hidden scale-in"
          style={{
            backgroundColor: 'var(--elev-sub)',
            border: '1px solid var(--line)',
            minWidth: '210px',
            boxShadow: 'var(--edge-light), var(--shadow-modal)',
            transformOrigin: 'top right',
          }}>
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
            onClick={() => { togglePrivacy(); setOpen(false); }}
            className="flex items-center gap-3 w-full px-4 py-3 text-sm transition-colors"
            style={{ color: 'var(--muted)', borderTop: '1px solid var(--line)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--fg)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
            <span className="w-4 h-4 flex items-center justify-center shrink-0"><EyeIcon off={privacy} /></span>
            {privacy ? 'Show amounts' : 'Hide amounts'}
          </button>
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
