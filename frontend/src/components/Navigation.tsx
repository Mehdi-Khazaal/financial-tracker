import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import TopBar from './TopBar';

const navItems = [
  {
    path: '/',
    label: 'Dashboard',
    icon: 'M3 4a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM11 4a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zM11 11a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z',
    matchPaths: ['/', '/analytics'],
  },
  {
    path: '/accounts',
    label: 'Accounts',
    icon: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z',
    matchPaths: ['/accounts', '/wallet', '/cards', '/loans'],
  },
  {
    path: '/transactions',
    label: 'Transactions',
    icon: 'M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z',
    matchPaths: ['/transactions', '/recurring'],
  },
  {
    path: '/portfolio',
    label: 'Portfolio',
    icon: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z',
    matchPaths: ['/portfolio', '/investments', '/assets', '/savings'],
  },
];

const COLLAPSE_KEY = 'nav_collapsed';

const Navigation: React.FC = () => {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  const isActive = (item: typeof navItems[0]) => item.matchPaths.includes(location.pathname);

  useEffect(() => {
    document.body.classList.toggle('nav-collapsed', collapsed);
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
      <TopBar />

      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside
        className="nav-sidebar hidden md:flex flex-col fixed inset-y-0 left-0 z-40 transition-all duration-300"
        style={{ width: collapsed ? '64px' : '240px', backgroundColor: 'var(--bg)', borderRight: '1px solid var(--line)' }}>

        {/* Logo + collapse */}
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
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {navItems.map(item => {
            const active = isActive(item);
            return (
              <Link key={item.path} to={item.path}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 py-2.5 rounded-md text-sm transition-colors ${collapsed ? 'justify-center px-0' : 'px-3'}`}
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

        {/* Expand button when collapsed */}
        {collapsed && (
          <div className="p-2 shrink-0" style={{ borderTop: '1px solid var(--line)' }}>
            <button
              onClick={toggleCollapse}
              className="w-full flex items-center justify-center py-2 rounded-md transition-colors"
              style={{ color: 'var(--dim)' }}
              title="Expand sidebar">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
      </aside>

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom"
        style={{ backgroundColor: 'rgba(10,10,11,.95)', borderTop: '1px solid var(--line)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
        <div className="flex items-center justify-around h-16 px-1">
          {navItems.map(item => {
            const active = isActive(item);
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
        </div>
      </nav>
    </>
  );
};

export default Navigation;
