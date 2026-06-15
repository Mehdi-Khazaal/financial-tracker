import React, { useState, useEffect, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import TopBar from './TopBar';
import { TabContext } from '../context/TabContext';
import { useUI } from '../context/UIContext';

/* Subtle tap feedback on devices that support it */
const haptic = () => { if ('vibrate' in navigator) navigator.vibrate(8); };

const navItems = [
  {
    path: '/',
    label: 'Dashboard',
    mobileLabel: 'Home',
    icon: 'M3 4a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM11 4a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zM11 11a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z',
    matchPaths: ['/', '/analytics'],
  },
  {
    path: '/accounts',
    label: 'Accounts',
    mobileLabel: 'Money',
    icon: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z',
    matchPaths: ['/accounts', '/wallet', '/cards', '/loans'],
  },
  {
    path: '/transactions',
    label: 'Transactions',
    mobileLabel: 'Txns',
    icon: 'M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z',
    matchPaths: ['/transactions', '/recurring'],
  },
  {
    path: '/portfolio',
    label: 'Portfolio',
    mobileLabel: 'Invest',
    icon: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z',
    matchPaths: ['/portfolio', '/investments', '/assets', '/savings'],
  },
];

const assistantItem = {
  label: 'AI Assistant',
  mobileLabel: 'AI',
  icon: 'M10 2.5l.9 3.1a4.4 4.4 0 002.9 2.9l3.2.9-3.2.9a4.4 4.4 0 00-2.9 2.9l-.9 3.3-.9-3.3a4.4 4.4 0 00-2.9-2.9L3 9.4l3.2-.9a4.4 4.4 0 002.9-2.9L10 2.5zM15.5 13l.4 1.2a1.9 1.9 0 001.2 1.2l1.2.4-1.2.4a1.9 1.9 0 00-1.2 1.2l-.4 1.2-.4-1.2a1.9 1.9 0 00-1.2-1.2l-1.2-.4 1.2-.4a1.9 1.9 0 001.2-1.2l.4-1.2z',
};

/* Sub-tabs shown in the context bar per route */
const ROUTE_TABS: Record<string, { label: string; value: string }[]> = {
  '/':             [{ label: 'Overview', value: 'overview' }, { label: 'Analytics', value: 'analytics' }],
  '/accounts':     [{ label: 'Wallet', value: 'wallet' }, { label: 'Cards', value: 'cards' }, { label: 'Loans', value: 'loans' }],
  '/transactions': [{ label: 'Board', value: 'transactions' }, { label: 'List', value: 'list' }, { label: 'Recurring', value: 'recurring' }],
  '/portfolio':    [{ label: 'Investments', value: 'investments' }, { label: 'Assets', value: 'assets' }, { label: 'Savings', value: 'savings' }],
};

const COLLAPSE_KEY = 'nav_collapsed';

const Navigation: React.FC = () => {
  const location = useLocation();
  const { tabs, setRouteTab } = useContext(TabContext);
  const { setPaletteOpen } = useUI();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  const isActive = (item: typeof navItems[0]) => item.matchPaths.includes(location.pathname);

  const routeTabs = ROUTE_TABS[location.pathname] ?? [];
  const activeTab = tabs[location.pathname] ?? '';

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
        style={{
          width: collapsed ? '64px' : '240px',
          backgroundColor: 'var(--bg)',
          borderRight: '1px solid var(--line)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
        }}>

        {/* Logo + collapse */}
        <div className="flex items-center h-16 px-4 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #F97316 0%, #C2410C 100%)', boxShadow: '0 2px 10px rgba(249,115,22,0.35)' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: '17px', color: '#fff', lineHeight: 1, fontStyle: 'italic' }}>F</span>
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

        {/* Search / command palette trigger */}
        <div className="px-2 pt-3">
          <button
            onClick={() => setPaletteOpen(true)}
            title="Search & commands (Ctrl+K)"
            className={`nav-item flex items-center gap-3 py-2.5 rounded-md text-sm w-full ${collapsed ? 'justify-center px-2' : 'px-3'}`}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}
              strokeLinecap="round" className="w-[18px] h-[18px] shrink-0">
              <path d="M13.5 13.5L17 17M9 14.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11z" />
            </svg>
            {!collapsed && (
              <>
                <span className="nav-label flex-1 text-left whitespace-nowrap text-sm font-medium">Search</span>
                <span className="nav-cmdk-hint font-mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--dim)', border: '1px solid var(--line)' }}>⌘K</span>
              </>
            )}
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {navItems.map(item => {
            const active = isActive(item);
            return (
              <Link key={item.path} to={item.path}
                title={collapsed ? item.label : undefined}
                className={`nav-item flex items-center gap-3 py-2.5 rounded-md text-sm ${active ? 'nav-item-active' : ''} ${collapsed ? 'justify-center px-2' : 'px-3'}`}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}
                  className="w-[18px] h-[18px] shrink-0 transition-colors"
                  style={{ color: active ? 'var(--accent)' : 'inherit' }}>
                  <path d={item.icon} />
                </svg>
                {!collapsed && (
                  <span className="nav-label flex-1 whitespace-nowrap text-sm font-medium transition-all">{item.label}</span>
                )}
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

      {/* ── Mobile context tab bar (above bottom nav) ────────────────── */}
      {routeTabs.length > 0 && (
        <div
          className="mobile-context-tabs md:hidden fixed inset-x-0 z-40 px-4"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 86px)',
            paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
            paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
          }}>
          <div className="mobile-context-tabs-inner flex gap-1 mx-auto">
            {routeTabs.map(t => (
              <button
                key={t.value}
                onClick={() => { haptic(); setRouteTab(location.pathname, t.value); }}
                className="mobile-context-tab flex-1 h-9 rounded-lg text-xs font-semibold transition-all active:scale-95"
                style={activeTab === t.value
                  ? { backgroundColor: 'var(--accent-dim)', color: 'var(--fg)', boxShadow: 'var(--edge-light)', fontFamily: 'var(--font-mono)' }
                  : { color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <nav className="mobile-dock md:hidden fixed inset-x-0 z-40"
        style={{ bottom: 0 }}>
        <div
          className="mobile-dock-shell mx-auto flex items-center justify-between"
          style={{
            marginLeft: 'max(0.85rem, env(safe-area-inset-left, 0px))',
            marginRight: 'max(0.85rem, env(safe-area-inset-right, 0px))',
          }}>
          {[navItems[0], navItems[2], navItems[1], navItems[3]].map(item => {
            const active = isActive(item);
            return (
              <Link key={item.path} to={item.path}
                onClick={haptic}
                className={`bottom-nav-item flex flex-col items-center justify-center gap-1 ${active ? 'bn-active' : ''}`}
                style={{ color: active ? 'var(--accent)' : 'var(--dim)', minHeight: 44 }}>
                <span className="bn-pill" aria-hidden="true" />
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} className="w-5 h-5 relative">
                  <path d={item.icon} />
                </svg>
                <span className="font-mono text-[9px] font-medium leading-none tracking-wider uppercase relative">{item.mobileLabel}</span>
              </Link>
            );
          })}
          <button
            type="button"
            aria-label="AI Assistant coming soon"
            title={assistantItem.label}
            className="bottom-nav-item bottom-nav-ai flex flex-col items-center justify-center gap-1"
            style={{ color: 'var(--dim)', minHeight: 44 }}
          >
            <span className="bn-pill" aria-hidden="true" />
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 relative">
              <path d={assistantItem.icon} />
            </svg>
            <span className="font-mono text-[9px] font-medium leading-none tracking-wider uppercase relative">{assistantItem.mobileLabel}</span>
          </button>
        </div>
      </nav>
    </>
  );
};

export default Navigation;
