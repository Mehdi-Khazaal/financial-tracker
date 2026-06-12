import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { TabContext } from '../context/TabContext';
import { useUI, requestQuickAction, QuickAction } from '../context/UIContext';

type Cmd = {
  id: string;
  label: string;
  group: 'Quick actions' | 'Navigate' | 'Preferences';
  keywords: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
};

const I = ({ d }: { d: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}
    strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0 cmdk-icon">
    <path d={d} />
  </svg>
);

/** Global ⌘K / Ctrl+K palette — navigation, quick actions, preferences.
    Keyboard-initiated, so it opens instantly: no entrance animation. */
const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { setRouteTab } = useContext(TabContext);
  const { paletteOpen, setPaletteOpen, privacy, togglePrivacy } = useUI();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [paletteOpen]);

  const close = () => setPaletteOpen(false);

  const go = (path: string, tab?: string) => {
    close();
    navigate(path);
    if (tab) setRouteTab(path, tab);
  };

  const quick = (action: QuickAction) => {
    close();
    navigate('/');
    setRouteTab('/', 'overview');
    requestQuickAction(action);
  };

  const commands: Cmd[] = useMemo(() => [
    { id: 'qa-expense', label: 'Add expense', group: 'Quick actions', keywords: 'spend pay new transaction',
      icon: <I d="M10 4v12m0 0l-4-4m4 4l4-4" />, run: () => quick('expense') },
    { id: 'qa-income', label: 'Add income', group: 'Quick actions', keywords: 'salary earn new transaction',
      icon: <I d="M10 16V4m0 0L6 8m4-4l4 4" />, run: () => quick('income') },
    { id: 'qa-transfer', label: 'Transfer between accounts', group: 'Quick actions', keywords: 'move money send',
      icon: <I d="M4 7h12m0 0l-3-3m3 3l-3 3M16 13H4m0 0l3 3m-3-3l3-3" />, run: () => quick('transfer') },

    { id: 'nav-dash', label: 'Dashboard', group: 'Navigate', keywords: 'home overview net worth',
      icon: <I d="M3 10l7-6 7 6v7a1 1 0 01-1 1h-4v-5H8v5H4a1 1 0 01-1-1v-7z" />, run: () => go('/', 'overview') },
    { id: 'nav-analytics', label: 'Analytics', group: 'Navigate', keywords: 'charts spending reports trends',
      icon: <I d="M4 16V9m6 7V4m6 12v-5" />, run: () => go('/', 'analytics') },
    { id: 'nav-accounts', label: 'Accounts', group: 'Navigate', keywords: 'wallet balance bank',
      icon: <I d="M3 7a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 3h14" />, run: () => go('/accounts', 'wallet') },
    { id: 'nav-cards', label: 'Cards', group: 'Navigate', keywords: 'credit card accounts',
      icon: <I d="M3 7a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm3 7h3" />, run: () => go('/accounts', 'cards') },
    { id: 'nav-loans', label: 'Loans', group: 'Navigate', keywords: 'debt borrow accounts',
      icon: <I d="M10 3v14m-5-4c0 1.5 2.2 2.5 5 2.5s5-1 5-2.5M5 7c0-1.5 2.2-2.5 5-2.5s5 1 5 2.5" />, run: () => go('/accounts', 'loans') },
    { id: 'nav-tx', label: 'Transactions', group: 'Navigate', keywords: 'history list spending',
      icon: <I d="M4 6h12M4 10h12M4 14h8" />, run: () => go('/transactions', 'transactions') },
    { id: 'nav-recurring', label: 'Recurring', group: 'Navigate', keywords: 'subscriptions salary repeat',
      icon: <I d="M4 10a6 6 0 0110.5-4M16 10a6 6 0 01-10.5 4M14.5 3v3h-3M5.5 17v-3h3" />, run: () => go('/transactions', 'recurring') },
    { id: 'nav-invest', label: 'Investments', group: 'Navigate', keywords: 'portfolio stocks crypto',
      icon: <I d="M3 14l4-5 3 3 5-7m0 0v4m0-4h-4" />, run: () => go('/portfolio', 'investments') },
    { id: 'nav-assets', label: 'Assets', group: 'Navigate', keywords: 'portfolio physical property',
      icon: <I d="M4 17V8l6-4 6 4v9M8 17v-5h4v5" />, run: () => go('/portfolio', 'assets') },
    { id: 'nav-savings', label: 'Savings goals', group: 'Navigate', keywords: 'portfolio goal target save',
      icon: <I d="M10 17a7 7 0 110-14 7 7 0 010 14zm0-4a3 3 0 110-6 3 3 0 010 6z" />, run: () => go('/portfolio', 'savings') },
    { id: 'nav-settings', label: 'Settings', group: 'Navigate', keywords: 'password notifications profile admin',
      icon: <I d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm6.5-2.5a6.5 6.5 0 01-.34 2.08l1.6 1.25-1.5 2.6-1.89-.76a6.52 6.52 0 01-3.6 2.08L10.5 19h-3l-.27-2.25a6.52 6.52 0 01-3.6-2.08l-1.89.76-1.5-2.6 1.6-1.25" />, run: () => go('/settings') },

    { id: 'pref-privacy', label: privacy ? 'Show amounts' : 'Hide amounts (privacy mode)', group: 'Preferences',
      keywords: 'privacy blur hide money eye',
      icon: privacy
        ? <I d="M3 3l14 14M8.5 8.6a2.5 2.5 0 003.4 3.4M5.6 5.8C4 6.9 2.9 8.4 2.5 10c1 3 4 5.5 7.5 5.5 1.3 0 2.6-.35 3.7-.95M9 4.6c.33-.04.66-.06 1-.06 3.5 0 6.5 2.5 7.5 5.5-.25.76-.62 1.5-1.1 2.15" />
        : <I d="M2.5 10C3.5 7 6.5 4.5 10 4.5S16.5 7 17.5 10c-1 3-4 5.5-7.5 5.5S3.5 13 2.5 10zm10 0a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />,
      run: () => { togglePrivacy(); close(); } },
    { id: 'pref-logout', label: 'Sign out', group: 'Preferences', keywords: 'logout exit leave',
      icon: <I d="M12 13l3-3-3-3m3 3H7m2 7H5a1 1 0 01-1-1V4a1 1 0 011-1h4" />,
      run: () => { close(); logout(); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [privacy]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!paletteOpen || !user) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[selected]?.run(); }
  };

  let lastGroup = '';

  return (
    <>
      <div className="cmdk-backdrop" onClick={close} />
      <div className="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="flex items-center gap-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}
            strokeLinecap="round" className="w-4 h-4 shrink-0" style={{ color: 'var(--dim)' }}>
            <path d="M13.5 13.5L17 17M9 14.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent outline-none py-3.5 text-sm"
            style={{ color: 'var(--fg)', fontFamily: 'var(--font-sans)' }}
          />
          <span className="cmdk-kbd">esc</span>
        </div>

        <div ref={listRef} className="app-scrollbar overflow-y-auto p-2" style={{ maxHeight: '46vh' }}>
          {filtered.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>
              No results for “{query}”
            </p>
          )}
          {filtered.map((c, i) => {
            const showGroup = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <React.Fragment key={c.id}>
                {showGroup && <p className="label px-3 pt-3 pb-1.5">{c.group}</p>}
                <button
                  className="cmdk-item"
                  data-selected={i === selected}
                  onMouseEnter={() => setSelected(i)}
                  onClick={c.run}>
                  {c.icon}
                  <span className="flex-1">{c.label}</span>
                  {c.hint && <span className="cmdk-kbd">{c.hint}</span>}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default CommandPalette;
