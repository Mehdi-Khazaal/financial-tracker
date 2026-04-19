import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { path: '/',             label: 'Overview',     icon: 'M3 4a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM11 4a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zM11 11a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z' },
  { path: '/wallet',       label: 'Wallet',       icon: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z' },
  { path: '/cards',        label: 'Cards',        icon: 'M2 5a2 2 0 012-2h12a2 2 0 012 2v2H2V5zm0 4h16v7a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm3 3a1 1 0 000 2h.01a1 1 0 000-2H5zm2 0a1 1 0 000 2h3a1 1 0 000-2H7z' },
  { path: '/transactions', label: 'Transactions', icon: 'M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z' },
  { path: '/investments',  label: 'Invest',       icon: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z' },
  { path: '/assets',       label: 'Assets',       icon: 'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z' },
  { path: '/savings',      label: 'Savings',      icon: 'M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z' },
  { path: '/analytics',    label: 'Analytics',    icon: 'M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z' },
  { path: '/recurring',    label: 'Recurring',    icon: 'M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z' },
  { path: '/loans',        label: 'Loans',        icon: 'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v1h-3zM4.75 12.094A5.973 5.973 0 004 15v1H1v-1a3 3 0 013.75-2.906z' },
];

const SETTINGS_ITEM = {
  path: '/settings', label: 'Settings',
  icon: 'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z',
};

const MOBILE_MAIN = navItems.slice(0, 5);
const MOBILE_MORE = navItems.slice(5);

const COLLAPSE_KEY = 'nav_collapsed';

const Navigation: React.FC = () => {
  const location = useLocation();
  const { logout, user } = useAuth();
  const [showMore, setShowMore] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const isActive = (path: string) => location.pathname === path;

  useEffect(() => {
    if (collapsed) {
      document.body.classList.add('nav-collapsed');
    } else {
      document.body.classList.remove('nav-collapsed');
    }
  }, [collapsed]);

  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_KEY) === '1') {
      document.body.classList.add('nav-collapsed');
    }
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  };

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside
        className="nav-sidebar hidden md:flex flex-col fixed inset-y-0 left-0 z-40 transition-all duration-300"
        style={{ width: collapsed ? '64px' : '240px', backgroundColor: 'var(--bg)', borderRight: '1px solid var(--line)' }}>

        {/* Logo + collapse toggle */}
        <div className="flex items-center h-16 px-4 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
            <span className="font-mono font-bold text-xs" style={{ color: 'var(--accent)' }}>F</span>
          </div>
          {!collapsed && (
            <>
              <span className="nav-logo-text font-semibold text-sm ml-3 flex-1 whitespace-nowrap" style={{ color: 'var(--fg)', letterSpacing: '-0.01em' }}>Fintrack</span>
              <button
                onClick={toggleCollapse}
                className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
                style={{ color: 'var(--dim)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--muted)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
                title="Collapse sidebar">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {navItems.map(item => {
            const active = isActive(item.path);
            return (
              <Link key={item.path} to={item.path}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 py-2 rounded-md text-sm transition-colors ${
                  collapsed ? 'justify-center px-0' : 'px-3'
                }`}
                style={{
                  backgroundColor: active ? 'var(--elev-1)' : 'transparent',
                  color: active ? 'var(--fg)' : 'var(--muted)',
                }}>
                <span className="shrink-0" style={{ color: active ? 'var(--accent)' : 'inherit' }}>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                    <path d={item.icon} />
                  </svg>
                </span>
                {!collapsed && <span className="flex-1 whitespace-nowrap">{item.label}</span>}
                {!collapsed && active && <span className="nav-dot ml-auto w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: 'var(--accent)' }} />}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: Settings + user */}
        <div className="p-2 space-y-1 shrink-0" style={{ borderTop: '1px solid var(--line)' }}>
          {/* Expand button when collapsed */}
          {collapsed && (
            <button
              onClick={toggleCollapse}
              className="w-full flex items-center justify-center py-2 rounded-md transition-colors"
              style={{ color: 'var(--dim)' }}
              title="Expand sidebar">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          {/* Settings link */}
          {(() => {
            const active = isActive(SETTINGS_ITEM.path);
            return (
              <Link to={SETTINGS_ITEM.path}
                title={collapsed ? SETTINGS_ITEM.label : undefined}
                className={`flex items-center gap-3 py-2 rounded-md text-sm transition-colors ${
                  collapsed ? 'justify-center px-0' : 'px-3'
                }`}
                style={{
                  backgroundColor: active ? 'var(--elev-1)' : 'transparent',
                  color: active ? 'var(--fg)' : 'var(--muted)',
                }}>
                <span className="shrink-0" style={{ color: active ? 'var(--accent)' : 'inherit' }}>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                    <path d={SETTINGS_ITEM.icon} />
                  </svg>
                </span>
                {!collapsed && <span className="whitespace-nowrap">{SETTINGS_ITEM.label}</span>}
                {!collapsed && active && <span className="nav-dot ml-auto w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: 'var(--accent)' }} />}
              </Link>
            );
          })()}

          {/* User chip */}
          <div className={`flex items-center gap-3 py-2 ${collapsed ? 'justify-center px-0' : 'px-3'}`}>
            <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
              title={collapsed ? user?.username : undefined}>
              <span className="font-mono font-bold text-xs" style={{ color: 'var(--accent)' }}>{user?.username.charAt(0).toUpperCase()}</span>
            </div>
            {!collapsed && (
              <div className="nav-user-info text-left min-w-0 flex-1">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>{user?.username}</p>
                <p className="text-[10px] truncate" style={{ color: 'var(--muted)' }}>{user?.email}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom"
        style={{ backgroundColor: 'rgba(10,10,11,.95)', borderTop: '1px solid var(--line)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
        <div className="flex items-center justify-around h-16 px-1">
          {MOBILE_MAIN.map(item => {
            const active = isActive(item.path);
            return (
              <Link key={item.path} to={item.path}
                className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors"
                style={{ color: active ? 'var(--accent)' : 'var(--dim)' }}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path d={item.icon} />
                </svg>
                <span className="text-[9px] font-semibold leading-none">{item.label}</span>
              </Link>
            );
          })}

          {/* More */}
          <button onClick={() => setShowMore(!showMore)}
            className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors"
            style={{ color: showMore ? 'var(--accent)' : 'var(--dim)' }}>
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
            <div className="absolute bottom-full inset-x-0 pb-1 slide-up"
              style={{ backgroundColor: 'rgba(17,17,19,.97)', backdropFilter: 'blur(28px)', borderTop: '1px solid var(--line)' }}>
              <div className="grid grid-cols-3 gap-0 px-2 py-3">
                {[...MOBILE_MORE, SETTINGS_ITEM].map(item => {
                  const active = isActive(item.path);
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setShowMore(false)}
                      className="flex flex-col items-center gap-2 py-3 rounded-md transition-colors"
                      style={active ? { color: 'var(--accent)', backgroundColor: 'var(--elev-1)' } : { color: 'var(--muted)' }}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                        <path d={item.icon} />
                      </svg>
                      <span className="text-xs font-semibold">{item.label}</span>
                    </Link>
                  );
                })}
                <button onClick={logout}
                  className="flex flex-col items-center gap-2 py-3 rounded-md"
                  style={{ color: 'var(--neg)' }}>
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
