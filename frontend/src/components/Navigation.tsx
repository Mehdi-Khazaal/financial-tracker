import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { path: '/',             label: 'Overview',      icon: 'M3 4a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM11 4a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zM11 11a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z' },
  { path: '/wallet',       label: 'Wallet',        icon: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z' },
  { path: '/cards',        label: 'Cards',         icon: 'M2 5a2 2 0 012-2h12a2 2 0 012 2v2H2V5zm0 4h16v7a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm3 3a1 1 0 000 2h.01a1 1 0 000-2H5zm2 0a1 1 0 000 2h3a1 1 0 000-2H7z' },
  { path: '/transactions', label: 'Transactions',  icon: 'M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z' },
  { path: '/investments',  label: 'Invest',        icon: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z' },
  { path: '/assets',       label: 'Assets',        icon: 'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z' },
  { path: '/savings',      label: 'Savings',       icon: 'M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z' },
  { path: '/analytics',    label: 'Analytics',     icon: 'M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z' },
  { path: '/recurring',    label: 'Recurring',     icon: 'M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z' },
  { path: '/loans',        label: 'Loans',         icon: 'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v1h-3zM4.75 12.094A5.973 5.973 0 004 15v1H1v-1a3 3 0 013.75-2.906z' },
];

// Mobile shows 5 items; the rest go in a "More" overflow
const MOBILE_MAIN = navItems.slice(0, 5);
const MOBILE_MORE = navItems.slice(5);


const Navigation: React.FC = () => {
  const location = useLocation();
  const { logout, user } = useAuth();
  const [showLogout, setShowLogout] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col fixed inset-y-0 left-0 w-60 z-40"
        style={{ backgroundColor: '#0b0d12', borderRight: '1px solid #252a3a' }}>
        {/* Logo */}
        <div className="flex items-center gap-3 h-16 px-5" style={{ borderBottom: '1px solid #252a3a' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #5b8fff, #a78bfa)' }}>
            <span className="text-white font-bold text-xs">F</span>
          </div>
          <span className="font-bold text-sm tracking-wide text-text">Fintrack</span>
        </div>

        {/* Links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(item => {
            const active = isActive(item.path);
            return (
              <Link key={item.path} to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active ? 'text-text' : 'text-muted hover:text-text/80 hover:bg-surface'
                }`}
                style={active ? { backgroundColor: '#181c28', borderLeft: '3px solid #5b8fff', paddingLeft: '9px' } : {}}>
                <span style={active ? { color: '#5b8fff' } : {}}>
                  <svg viewBox="0 0 20 20" fill={active ? 'currentColor' : 'none'} stroke="currentColor"
                    strokeWidth={active ? 0 : 1.5} className="w-5 h-5">
                    <path d={item.icon} />
                  </svg>
                </span>
                {item.label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#5b8fff' }} />}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-3" style={{ borderTop: '1px solid #252a3a' }}>
          <button onClick={() => setShowLogout(!showLogout)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface transition-colors">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #5b8fff, #a78bfa)' }}>
              <span className="text-white font-bold text-sm">{user?.username.charAt(0).toUpperCase()}</span>
            </div>
            <div className="text-left min-w-0 flex-1">
              <p className="text-text text-sm font-medium truncate">{user?.username}</p>
              <p className="text-muted text-xs truncate">{user?.email}</p>
            </div>
          </button>
          {showLogout && (
            <button onClick={logout}
              className="mt-1 w-full py-2 text-xs font-medium transition-colors rounded-lg"
              style={{ color: '#ff5f6d' }}>
              Sign out
            </button>
          )}
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom"
        style={{ backgroundColor: 'rgba(11,13,18,.95)', borderTop: '1px solid #252a3a', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
        <div className="flex items-center justify-around h-16 px-1">
          {MOBILE_MAIN.map(item => {
            const active = isActive(item.path);
            return (
              <Link key={item.path} to={item.path}
                className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors ${active ? '' : 'text-dim'}`}
                style={active ? { color: '#5b8fff' } : {}}>
                <svg viewBox="0 0 20 20" fill={active ? 'currentColor' : 'none'} stroke="currentColor"
                  strokeWidth={active ? 0 : 1.5} className="w-5 h-5">
                  <path d={item.icon} />
                </svg>
                <span className="text-[9px] font-semibold leading-none">{item.label}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setShowMore(!showMore)}
            className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors ${showMore ? '' : 'text-dim'}`}
            style={showMore ? { color: '#5b8fff' } : {}}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
            <span className="text-[9px] font-semibold leading-none">More</span>
          </button>
        </div>

        {/* More drawer */}
        {showMore && (
          <>
            <div className="absolute inset-0 -top-full" onClick={() => setShowMore(false)} />
            <div className="absolute bottom-full inset-x-0 pb-1"
              style={{ backgroundColor: 'rgba(17,20,28,.97)', backdropFilter: 'blur(28px)', borderTop: '1px solid #252a3a' }}>
              <div className="grid grid-cols-3 gap-0 px-2 py-3">
                {MOBILE_MORE.map(item => {
                  const active = isActive(item.path);
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setShowMore(false)}
                      className="flex flex-col items-center gap-2 py-3 rounded-xl transition-colors"
                      style={active ? { color: '#5b8fff', backgroundColor: '#181c28' } : { color: '#7880a0' }}>
                      <svg viewBox="0 0 20 20" fill={active ? 'currentColor' : 'none'} stroke="currentColor"
                        strokeWidth={active ? 0 : 1.5} className="w-5 h-5">
                        <path d={item.icon} />
                      </svg>
                      <span className="text-xs font-semibold">{item.label}</span>
                    </Link>
                  );
                })}
                <button onClick={logout}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl"
                  style={{ color: '#ff5f6d' }}>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span className="text-xs font-semibold">Sign out</span>
                </button>
              </div>
            </div>
          </>
        )}
      </nav>
    </>
  );
};

export default Navigation;
