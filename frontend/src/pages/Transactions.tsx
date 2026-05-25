import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouteTab } from '../context/TabContext';
import { localDateStr } from '../utils/date';
import { Transaction, Account, Category, RecurringTransaction } from '../types';
import {
  getTransactions, getAccounts, getCategories, deleteTransaction, cleanDescription,
  getRecurring, deleteRecurring, updateRecurring, processDueRecurring, logVariableRecurring,
  updateTransaction,
} from '../utils/api';
import Navigation from '../components/Navigation';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import EditTransactionModal from '../components/modals/EditTransactionModal';
import TransferModal from '../components/modals/TransferModal';
import AddRecurringModal from '../components/modals/AddRecurringModal';
import PullToRefresh from '../components/PullToRefresh';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

type Tab = 'transactions' | 'recurring';

const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PERIOD_LABELS: Record<string, string> = {
  weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
};
const PERIOD_COLORS: Record<string, string> = {
  weekly: '#a855f7', biweekly: 'var(--accent)', monthly: 'var(--pos)', quarterly: '#f59e0b', yearly: 'var(--neg)',
};

const formatMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

// ── Transaction row (inbox + column variants) ─────────────────────────────────
interface TxCardProps {
  tx: Transaction;
  accounts: Account[];
  isDragging: boolean;
  compact?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onDelete: () => void;
}

const TxCard: React.FC<TxCardProps> = ({
  tx, accounts, isDragging, compact = false, onDragStart, onDragEnd, onClick, onDelete,
}) => {
  const pos = Number(tx.amount) >= 0;
  const accountName = accounts.find(a => a.id === tx.account_id)?.name ?? '';
  const shortDate   = new Date(tx.transaction_date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
  const amountStr = `${pos ? '+' : '-'}$${fmt(Math.abs(Number(tx.amount)))}`;

  if (compact) {
    // ── Compact row inside a category column ──
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onClick}
        className="group flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none transition-colors"
        style={{
          borderBottom: '1px solid var(--line)',
          opacity: isDragging ? 0.25 : 1,
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--elev-sub)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium truncate leading-snug" style={{ color: 'var(--fg)' }}>
            {cleanDescription(tx.description)}
          </p>
          <p className="text-[8px] mt-0.5 leading-none" style={{ color: 'var(--dim)' }}>{shortDate}</p>
        </div>
        <p className="text-[10px] font-bold shrink-0"
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--neg)' }}>
          {amountStr}
        </p>
      </div>
    );
  }

  // ── Full row for the uncategorized inbox ──
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="group flex items-start gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{
        borderBottom: '1px solid var(--line)',
        opacity: isDragging ? 0.25 : 1,
      }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--elev-sub)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      {/* Drag handle */}
      <div className="mt-[3px] shrink-0 opacity-0 group-hover:opacity-30 transition-opacity" style={{ color: 'var(--muted)' }}>
        <svg width="8" height="13" viewBox="0 0 8 13" fill="currentColor">
          <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
          <circle cx="2" cy="6.5" r="1.2"/><circle cx="6" cy="6.5" r="1.2"/>
          <circle cx="2" cy="11" r="1.2"/><circle cx="6" cy="11" r="1.2"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium leading-snug truncate" style={{ color: 'var(--fg)' }}>
          {cleanDescription(tx.description)}
        </p>
        <p className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--dim)' }}>
          {accountName} · {shortDate}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end">
        <p className="text-[11px] font-bold"
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--neg)' }}>
          {amountStr}
        </p>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="text-[8px] font-semibold mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: 'var(--neg)' }}
        >
          delete
        </button>
      </div>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const Transactions: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useRouteTab('/transactions');

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts]         = useState<Account[]>([]);
  const [categories, setCategories]     = useState<Category[]>([]);
  const [loading, setLoading]           = useState(true);

  const [showTx, setShowTx]             = useState(false);
  const [txType, setTxType]             = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer] = useState(false);
  const [editTx, setEditTx]             = useState<Transaction | null>(null);

  const [items, setItems]                       = useState<RecurringTransaction[]>([]);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [processing, setProcessing]             = useState(false);
  const [billInputs, setBillInputs]             = useState<Record<number, string>>({});
  const [loggingBill, setLoggingBill]           = useState<number | null>(null);

  const [selectedMonth, setSelectedMonth]   = useState('');
  const [draggingTxId, setDraggingTxId]     = useState<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<number | 'uncategorized' | null>(null);
  const [expandedCats, setExpandedCats]     = useState<Record<number, boolean>>({});
  const [hideEmpty, setHideEmpty]           = useState(true);
  const [mobileView, setMobileView]         = useState<'queue' | 'categories'>('queue');
  const MAX_TX_SHOWN = 4;

  // ref for the scrollable category grid
  const catScrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [txRes, accRes, catRes, recRes] = await Promise.all([
        getTransactions(), getAccounts(), getCategories(), getRecurring(),
      ]);
      setTransactions(Array.isArray(txRes.data) ? txRes.data : []);
      setAccounts(Array.isArray(accRes.data) ? accRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      setItems(Array.isArray(recRes.data) ? recRes.data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

  // ── Month derivations ────────────────────────────────────────────────────────
  const availableMonths = useMemo(() => {
    const s = new Set(transactions.map(t => t.transaction_date.slice(0, 7)));
    return Array.from(s).sort().reverse();
  }, [transactions]);

  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      const current = new Date().toISOString().slice(0, 7);
      setSelectedMonth(availableMonths.includes(current) ? current : availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  const monthTransactions = useMemo(() =>
    transactions.filter(t => selectedMonth && t.transaction_date.startsWith(selectedMonth)),
    [transactions, selectedMonth],
  );

  const uncategorized = useMemo(() =>
    monthTransactions.filter(t => !t.category_id),
    [monthTransactions],
  );

  // Sort categories by total spend this month ascending (lowest first), empty at end
  const sortedCategories = useMemo(() => {
    const totalMap = new Map(
      categories.map(c => [
        c.id,
        monthTransactions.filter(t => t.category_id === c.id).reduce((s, t) => s + Math.abs(Number(t.amount)), 0),
      ]),
    );
    return [...categories].sort((a, b) => {
      const ta = totalMap.get(a.id) ?? 0;
      const tb = totalMap.get(b.id) ?? 0;
      if (ta === 0 && tb === 0) return a.name.localeCompare(b.name);
      if (ta === 0) return 1;
      if (tb === 0) return -1;
      return ta - tb; // ascending: lowest cost first
    });
  }, [categories, monthTransactions]);

  // When dragging, show all categories so user can drop into any; otherwise hide empty if toggle is on
  const visibleCategories = useMemo(() =>
    sortedCategories.filter(cat => {
      if (draggingTxId !== null) return true;          // reveal all targets while dragging
      if (!hideEmpty) return true;
      return monthTransactions.some(t => t.category_id === cat.id);
    }),
    [sortedCategories, hideEmpty, draggingTxId, monthTransactions],
  );

  const hiddenEmptyCount = sortedCategories.length - visibleCategories.length;

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    const ok = await toast.confirm('Delete this transaction?', { danger: true });
    if (!ok) return;
    try { await deleteTransaction(id); load(); toast.success('Transaction deleted'); }
    catch { toast.error('Failed to delete transaction'); }
  };

  const handleCategorize = async (txId: number, categoryId: number | null) => {
    setTransactions(prev => prev.map(t => t.id === txId ? { ...t, category_id: categoryId } : t));
    try { await updateTransaction(txId, { category_id: categoryId }); }
    catch { load(); toast.error('Failed to update category'); }
  };

  const handleDragOver = (target: number | 'uncategorized') => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(target);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverTarget(null);
  };

  const handleDrop = (categoryId: number | null) => (e: React.DragEvent) => {
    e.preventDefault();
    const txId = parseInt(e.dataTransfer.getData('txId'));
    if (txId) handleCategorize(txId, categoryId);
    setDragOverTarget(null);
    setDraggingTxId(null);
  };

  // ── Recurring helpers ─────────────────────────────────────────────────────────
  const handleDeleteRecurring = async (id: number) => {
    const ok = await toast.confirm('Delete this recurring transaction?', { danger: true });
    if (!ok) return;
    try { await deleteRecurring(id); load(); toast.success('Deleted'); }
    catch { toast.error('Failed to delete'); }
  };

  const handleToggle = async (item: RecurringTransaction) => {
    try { await updateRecurring(item.id, { is_active: !item.is_active }); load(); }
    catch { toast.error('Failed to update'); }
  };

  const handleProcess = async () => {
    setProcessing(true);
    try {
      const res = await processDueRecurring();
      const count = Array.isArray(res.data) ? res.data.length : 0;
      if (count > 0) toast.success(`Logged ${count} transaction${count !== 1 ? 's' : ''}`);
      else toast.info('No fixed recurring transactions due right now');
      load();
    } catch { toast.error('Failed to process'); }
    finally { setProcessing(false); }
  };

  const handleLogBill = async (item: RecurringTransaction) => {
    const input = billInputs[item.id];
    if (!input || parseFloat(input) <= 0) return;
    setLoggingBill(item.id);
    try {
      const sign = Number(item.amount) < 0 ? -1 : 1;
      await logVariableRecurring(item.id, sign * Math.abs(parseFloat(input)));
      setBillInputs(prev => { const n = { ...prev }; delete n[item.id]; return n; });
      load(); toast.success('Bill logged');
    } catch { toast.error('Failed to log bill'); }
    finally { setLoggingBill(null); }
  };

  const getCategory    = (id: number | null) => categories.find(c => c.id === id);
  const getAccountName = (id: number) => accounts.find(a => a.id === id)?.name ?? 'Unknown';

  const today          = localDateStr();
  const dueNow         = items.filter(i => i.is_active && i.next_date <= today);
  const dueFixed       = dueNow.filter(i => !i.is_variable);
  const dueBills       = dueNow.filter(i => i.is_variable);
  const upcoming       = items.filter(i => i.is_active && i.next_date > today);
  const inactive       = items.filter(i => !i.is_active);

  const PERIOD_MULTIPLIERS: Record<string, number> = {
    weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 0.33, yearly: 0.083,
  };
  const monthlyIncome  = items.filter(i => i.is_active && Number(i.amount) > 0).reduce((s, i) => s + Number(i.amount) * (PERIOD_MULTIPLIERS[i.period] ?? 1), 0);
  const monthlyExpense = items.filter(i => i.is_active && Number(i.amount) < 0).reduce((s, i) => s + Math.abs(Number(i.amount)) * (PERIOD_MULTIPLIERS[i.period] ?? 1), 0);
  const monthlyNet     = monthlyIncome - monthlyExpense;

  const formatNextDate = (d: string) => {
    const todayStr = localDateStr();
    if (d === todayStr) return 'Due today';
    if (d < todayStr) return 'Overdue';
    const days = Math.ceil((new Date(d).getTime() - new Date(todayStr).getTime()) / 86400000);
    if (days === 1) return 'Tomorrow';
    if (days <= 7) return `In ${days} days`;
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // ── Recurring Item ─────────────────────────────────────────────────────────────
  const RecurringItem: React.FC<{ item: RecurringTransaction }> = ({ item }) => {
    const pos = Number(item.amount) > 0;
    const cat = getCategory(item.category_id);
    const due = item.next_date <= today;
    return (
      <div className="group transition-colors hover:bg-surface2" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="w-1 h-10 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? (pos ? 'var(--pos)' : 'var(--neg)') }} />
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--elev-sub)', color: item.is_variable ? '#f59e0b' : (pos ? 'var(--pos)' : 'var(--neg)') }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              {item.is_variable
                ? <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                : pos
                  ? <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  : <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
              }
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-text truncate">{item.description || 'Recurring'}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'var(--elev-sub)', color: PERIOD_COLORS[item.period] }}>
                {PERIOD_LABELS[item.period]}
              </span>
              {item.is_variable && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'var(--elev-sub)', color: '#f59e0b' }}>variable</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted flex-wrap">
              <span>{getAccountName(item.account_id)}</span>
              {cat && <><span>·</span><span style={{ color: cat.color }}>{cat.name}</span></>}
              <span>·</span>
              <span style={{ color: due && item.is_active ? 'var(--neg)' : 'var(--muted)' }}>{formatNextDate(item.next_date)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <p className="font-mono font-bold text-sm" style={{ color: item.is_variable ? '#f59e0b' : (pos ? 'var(--pos)' : 'var(--neg)'), fontVariantNumeric: 'tabular-nums' }}>
              {item.is_variable ? '~' : (pos ? '+' : '-')}${fmt(Math.abs(Number(item.amount)))}
            </p>
            <button onClick={() => handleToggle(item)}
              className="w-8 h-5 rounded-full transition-all relative shrink-0"
              style={{ backgroundColor: item.is_active ? 'var(--pos)' : 'var(--line)' }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: item.is_active ? '14px' : '2px' }} />
            </button>
            <button onClick={() => handleDeleteRecurring(item.id)}
              className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
              style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        {item.is_variable && item.is_active && due && (
          <div className="px-4 pb-3 flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted text-xs">$</span>
              <input type="number" step="0.01" min="0.01" value={billInputs[item.id] ?? ''}
                onChange={e => setBillInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                className="input-dark pl-6 text-sm py-2.5"
                placeholder={`This month's amount (last: $${fmt(Math.abs(Number(item.amount)))})`} />
            </div>
            <button onClick={() => handleLogBill(item)}
              disabled={loggingBill === item.id || !billInputs[item.id] || parseFloat(billInputs[item.id] ?? '0') <= 0}
              className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-40 shrink-0"
              style={{ backgroundColor: 'var(--elev-sub)', color: '#f59e0b', border: '1px solid rgba(245,158,11,.25)' }}>
              {loggingBill === item.id ? '…' : 'Log bill'}
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Drag card helper ──────────────────────────────────────────────────────────
  const makeDragHandlers = (tx: Transaction) => ({
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('txId', String(tx.id));
      e.dataTransfer.effectAllowed = 'move';
      setDraggingTxId(tx.id);
    },
    onDragEnd: () => { setDraggingTxId(null); setDragOverTarget(null); },
    onClick: () => setEditTx(tx),
    onDelete: () => handleDelete(tx.id),
  });

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 h-screen flex flex-col" style={{ backgroundColor: 'var(--bg)' }}>
          <div className="p-5 space-y-4">
            <div className="skeleton h-8 w-48 rounded-xl" />
            <div className="skeleton h-6 w-full rounded-xl" />
            <div className="flex gap-3 mt-4">
              {[0, 1, 2, 3].map(i => <div key={i} className="skeleton rounded-2xl w-44" style={{ minHeight: 140 }} />)}
            </div>
          </div>
        </div>
      </>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'transactions', label: 'Board' },
    { id: 'recurring',    label: 'Recurring' },
  ];

  return (
    <>
      <Navigation />
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />

      <main
        className="md:ml-60 flex flex-col overflow-hidden"
        style={{ height: '100dvh', backgroundColor: 'var(--bg)' }}
      >
        {/* ── Header ── */}
        <div className="shrink-0 flex items-center gap-2 md:gap-3 px-4 md:px-5 py-2.5 pr-14 border-b" style={{ borderColor: 'var(--line)' }}>

          {/* Tab switcher */}
          <div className="flex p-1 rounded-xl shrink-0" style={{ backgroundColor: 'var(--elev-1)' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="px-3 py-1.5 text-sm font-semibold rounded-lg transition-all"
                style={tab === t.id
                  ? { backgroundColor: 'var(--bg)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                  : { color: 'var(--muted)' }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Month pills */}
          {tab === 'transactions' && (
            <div className="flex-1 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {availableMonths.length === 0
                ? <p className="text-xs text-muted self-center">No transactions yet</p>
                : availableMonths.map(m => (
                  <button key={m} onClick={() => setSelectedMonth(m)}
                    className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all"
                    style={selectedMonth === m
                      ? { backgroundColor: 'var(--accent)', color: 'white' }
                      : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
                    {formatMonth(m)}
                  </button>
                ))}
            </div>
          )}

          {/* Hide-empty toggle — only on board tab */}
          {tab === 'transactions' && (
            <button
              onClick={() => setHideEmpty(h => !h)}
              className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-full transition-all"
              style={hideEmpty
                ? { backgroundColor: 'var(--elev-1)', color: 'var(--dim)', border: '1px solid var(--line)' }
                : { backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.2)' }}
              title={hideEmpty ? `${hiddenEmptyCount} empty categories hidden` : 'Hide empty categories'}
            >
              {hideEmpty ? `+${hiddenEmptyCount} empty` : 'Hide empty'}
            </button>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 ml-auto shrink-0">
            {tab === 'transactions' && (
              <>
                <button onClick={() => { setTxType('income'); setShowTx(true); }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.1)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.2)' }}>
                  + Income
                </button>
                <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>
                  + Expense
                </button>
                <button onClick={() => setShowTransfer(true)}
                  className="hidden lg:block text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.2)' }}>
                  Transfer
                </button>
              </>
            )}
            {tab === 'recurring' && dueFixed.length > 0 && (
              <button onClick={handleProcess} disabled={processing}
                className="text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-50"
                style={{ backgroundColor: 'var(--neg)', color: 'white' }}>
                {processing ? '…' : `Log ${dueFixed.length} fixed`}
              </button>
            )}
            {tab === 'recurring' && (
              <button onClick={() => setShowAddRecurring(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                + Add
              </button>
            )}
          </div>
        </div>

        {/* ── Board Tab ── */}
        {tab === 'transactions' && (
          availableMonths.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="font-semibold text-text mb-1">No transactions yet</p>
                <p className="text-sm text-muted mb-5">Add your first transaction to get started</p>
                <button onClick={() => { setTxType('expense'); setShowTx(true); }} className="btn-gradient px-6 py-2.5 text-sm">
                  Add First Transaction
                </button>
              </div>
            </div>
          ) : (
            <>
            {/* ── Desktop board (md+) ── */}
            <div className="hidden md:flex flex-1 overflow-hidden">

              {/* ── Inbox: uncategorized queue ── */}
              <div
                className="flex flex-col shrink-0 overflow-hidden"
                style={{ width: '192px', borderRight: '1px solid var(--line)' }}
              >
                {/* Inbox header */}
                <div className="px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--dim)' }}>Inbox</p>
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-full leading-none"
                      style={uncategorized.length > 0
                        ? { backgroundColor: 'oklch(70% 0.17 25 / 0.15)', color: 'var(--neg)' }
                        : { backgroundColor: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)' }}
                    >
                      {uncategorized.length}
                    </span>
                  </div>
                  <p className="text-[10px]" style={{ color: uncategorized.length === 0 ? 'var(--pos)' : 'var(--dim)' }}>
                    {uncategorized.length === 0 ? 'All categorized ✓' : `of ${monthTransactions.length} this month`}
                  </p>
                </div>

                {/* Inbox list — is also the drag-to-uncategorize drop zone */}
                <div
                  className="flex-1 overflow-y-auto"
                  style={{
                    scrollbarWidth: 'thin',
                    backgroundColor: dragOverTarget === 'uncategorized' ? 'oklch(70% 0.17 25 / 0.04)' : 'transparent',
                    transition: 'background-color 0.15s',
                  }}
                  onDragOver={handleDragOver('uncategorized')}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop(null)}
                >
                  {dragOverTarget === 'uncategorized' && (
                    <div className="mx-3 mt-2 mb-1 rounded-lg border border-dashed py-1.5 text-center"
                      style={{ borderColor: 'oklch(70% 0.17 25 / 0.5)' }}>
                      <p className="text-[9px] font-semibold" style={{ color: 'var(--neg)' }}>Remove category</p>
                    </div>
                  )}
                  {uncategorized.length === 0 && dragOverTarget !== 'uncategorized' ? (
                    <div className="py-12 text-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                        className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--pos)' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-[10px]" style={{ color: 'var(--pos)' }}>All done</p>
                    </div>
                  ) : (
                    uncategorized.map(tx => (
                      <TxCard key={tx.id} tx={tx} accounts={accounts}
                        isDragging={draggingTxId === tx.id} {...makeDragHandlers(tx)} />
                    ))
                  )}
                </div>
              </div>

              {/* ── Category grid ── */}
              <div
                ref={catScrollRef}
                className="flex-1 overflow-x-auto overflow-y-hidden"
                style={{ scrollbarWidth: 'thin' }}
              >
                {sortedCategories.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>No categories yet</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>Add categories in Settings first</p>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
                      gridAutoFlow: 'column',
                      gridAutoColumns: '192px',
                      height: '100%',
                      minWidth: 'max-content',
                      gap: '8px',
                      padding: '10px 12px',
                    }}
                  >
                    {visibleCategories.map(cat => {
                      const catTxs      = monthTransactions.filter(t => t.category_id === cat.id);
                      const total       = catTxs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
                      const isDragOver  = dragOverTarget === cat.id;
                      const isExpanded  = !!expandedCats[cat.id];
                      const shownTxs    = isExpanded ? catTxs : catTxs.slice(0, MAX_TX_SHOWN);
                      const hiddenCount = catTxs.length - shownTxs.length;

                      return (
                        <div
                          key={cat.id}
                          className="flex flex-col overflow-hidden"
                          style={{
                            borderRadius: '12px',
                            backgroundColor: isDragOver ? `${cat.color}10` : 'var(--elev-1)',
                            border: `1px solid ${isDragOver ? cat.color + '40' : 'var(--line)'}`,
                            borderLeft: `3px solid ${cat.color}`,
                            transition: 'background-color 0.12s, border-color 0.12s',
                          }}
                          onDragOver={handleDragOver(cat.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop(cat.id)}
                        >
                          {/* Column header */}
                          <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <p className="text-[10px] font-semibold uppercase tracking-wide truncate"
                                style={{ color: 'var(--muted)', letterSpacing: '0.04em' }}>
                                {cat.name}
                              </p>
                              <p className="text-[9px] shrink-0" style={{ color: 'var(--dim)' }}>
                                {catTxs.length}
                              </p>
                            </div>
                            <p className="text-[15px] font-bold leading-tight"
                              style={{ fontFamily: 'var(--font-mono)', color: cat.color, fontVariantNumeric: 'tabular-nums' }}>
                              ${fmt(total)}
                            </p>
                          </div>

                          {/* Transaction rows */}
                          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                            {shownTxs.map(tx => (
                              <TxCard key={tx.id} tx={tx} accounts={accounts} compact
                                isDragging={draggingTxId === tx.id} {...makeDragHandlers(tx)} />
                            ))}

                            {hiddenCount > 0 && !isExpanded && (
                              <button
                                onClick={() => setExpandedCats(p => ({ ...p, [cat.id]: true }))}
                                className="w-full py-1.5 text-[9px] font-semibold transition-colors"
                                style={{ color: cat.color, borderTop: '1px solid var(--line)' }}
                                onMouseEnter={e => (e.currentTarget.style.backgroundColor = `${cat.color}0d`)}
                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              >
                                +{hiddenCount} more
                              </button>
                            )}
                            {isExpanded && catTxs.length > MAX_TX_SHOWN && (
                              <button
                                onClick={() => setExpandedCats(p => ({ ...p, [cat.id]: false }))}
                                className="w-full py-1.5 text-[9px] font-semibold transition-colors"
                                style={{ color: 'var(--dim)', borderTop: '1px solid var(--line)' }}
                                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--elev-sub)')}
                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              >
                                Show less
                              </button>
                            )}

                            {isDragOver && (
                              <div className="mx-2 my-2 border border-dashed rounded-lg py-3 text-center"
                                style={{ borderColor: `${cat.color}50` }}>
                                <p className="text-[9px] font-semibold" style={{ color: cat.color }}>Drop here</p>
                              </div>
                            )}
                            {!isDragOver && catTxs.length === 0 && (
                              <div className="mx-2 my-2 border border-dashed rounded-lg py-3 text-center"
                                style={{ borderColor: 'var(--line)' }}>
                                <p className="text-[9px]" style={{ color: 'var(--dim)' }}>Drop to categorize</p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>

            {/* ── Mobile board (< md) — tap-to-categorize ── */}
            <div className="md:hidden flex-1 flex flex-col overflow-hidden">

              {/* View toggle */}
              <div className="flex gap-1.5 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
                <button
                  onClick={() => setMobileView('queue')}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={mobileView === 'queue'
                    ? { backgroundColor: 'var(--elev-1)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                    : { color: 'var(--muted)' }}>
                  Uncategorized{uncategorized.length > 0 ? ` (${uncategorized.length})` : ''}
                </button>
                <button
                  onClick={() => setMobileView('categories')}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={mobileView === 'categories'
                    ? { backgroundColor: 'var(--elev-1)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                    : { color: 'var(--muted)' }}>
                  By Category
                </button>
              </div>

              {/* Uncategorized queue */}
              {mobileView === 'queue' && (
                <div className="flex-1 overflow-y-auto p-3 space-y-2 pb-32">
                  {uncategorized.length === 0 ? (
                    <div className="py-16 text-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                        className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--pos)' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="font-semibold" style={{ color: 'var(--pos)' }}>All categorized!</p>
                      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Tap "By Category" to review</p>
                    </div>
                  ) : uncategorized.map(tx => (
                    <TxCard key={tx.id} tx={tx} accounts={accounts} isDragging={false}
                      onDragStart={() => {}} onDragEnd={() => {}}
                      onClick={() => setEditTx(tx)} onDelete={() => handleDelete(tx.id)} />
                  ))}
                </div>
              )}

              {/* By-category list */}
              {mobileView === 'categories' && (
                <div className="flex-1 overflow-y-auto p-3 pb-32 space-y-3">
                  {visibleCategories.map(cat => {
                    const catTxs = monthTransactions.filter(t => t.category_id === cat.id);
                    const total  = catTxs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
                    return (
                      <div key={cat.id} className="rounded-2xl overflow-hidden"
                        style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                        {/* Category header */}
                        <div className="flex items-center gap-2.5 px-4 py-3"
                          style={{ borderBottom: catTxs.length > 0 ? '1px solid var(--line)' : 'none' }}>
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          <p className="flex-1 text-sm font-semibold" style={{ color: 'var(--fg)' }}>{cat.name}</p>
                          <p className="text-xs mr-2" style={{ color: 'var(--dim)' }}>{catTxs.length} tx</p>
                          <p className="font-mono font-bold text-sm"
                            style={{ color: cat.color, fontVariantNumeric: 'tabular-nums' }}>
                            ${fmt(total)}
                          </p>
                        </div>
                        {/* Transactions */}
                        {catTxs.map((tx, i) => {
                          const pos = Number(tx.amount) >= 0;
                          const shortDate = new Date(tx.transaction_date + 'T00:00:00')
                            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          return (
                            <div key={tx.id}
                              onClick={() => setEditTx(tx)}
                              className="flex items-center gap-3 px-4 py-3 cursor-pointer active:opacity-60 transition-opacity"
                              style={{ borderBottom: i < catTxs.length - 1 ? '1px solid var(--line)' : 'none' }}>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
                                  {cleanDescription(tx.description)}
                                </p>
                                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{shortDate}</p>
                              </div>
                              <p className="font-mono font-bold text-sm shrink-0"
                                style={{ color: pos ? 'var(--pos)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                                {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </>
          )
        )}

        {/* ── Recurring Tab ── */}
        {tab === 'recurring' && (
          <div className="flex-1 overflow-y-auto pb-20 md:pb-10">
            <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-5 fade-in">
              <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Recurring</h1>

              {items.filter(i => i.is_active).length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                    <p className="label mb-1">Est. Income</p>
                    <p className="font-mono font-bold text-sm" style={{ color: 'var(--pos)', fontVariantNumeric: 'tabular-nums' }}>+${fmt(monthlyIncome)}</p>
                    <p className="text-[10px] text-muted mt-0.5">/month</p>
                  </div>
                  <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                    <p className="label mb-1">Est. Costs</p>
                    <p className="font-mono font-bold text-sm" style={{ color: 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>-${fmt(monthlyExpense)}</p>
                    <p className="text-[10px] text-muted mt-0.5">/month</p>
                  </div>
                  <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                    <p className="label mb-1">Net</p>
                    <p className="font-mono font-bold text-sm" style={{ color: monthlyNet >= 0 ? 'var(--pos)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                      {monthlyNet >= 0 ? '+' : '-'}${fmt(Math.abs(monthlyNet))}
                    </p>
                    <p className="text-[10px] text-muted mt-0.5">/month</p>
                  </div>
                </div>
              )}

              {items.length === 0 ? (
                <div className="card py-14 text-center">
                  <p className="text-4xl mb-3">🔄</p>
                  <p className="font-semibold text-text mb-1">No recurring transactions</p>
                  <p className="text-sm text-muted mb-5">Track rent, salary, subscriptions and more</p>
                  <button onClick={() => setShowAddRecurring(true)} className="btn-gradient px-6 py-2.5 text-sm">Add First Recurring</button>
                </div>
              ) : (
                <div className="space-y-5">
                  {dueNow.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neg)' }} />
                        <p className="label" style={{ color: 'var(--neg)' }}>Due Now</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.15)', color: 'var(--neg)' }}>{dueNow.length}</span>
                      </div>
                      <div className="card overflow-hidden">
                        {dueNow.map(item => <RecurringItem key={item.id} item={item} />)}
                      </div>
                      {dueFixed.length > 0 && (
                        <button onClick={handleProcess} disabled={processing}
                          className="mt-2 w-full py-3 text-sm font-semibold rounded-2xl transition-all active:scale-95 disabled:opacity-50"
                          style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.12)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>
                          {processing ? 'Processing…' : `Log all ${dueFixed.length} fixed transactions`}
                        </button>
                      )}
                      {dueBills.length > 0 && (
                        <p className="text-xs text-muted mt-2 text-center">{dueBills.length} variable bill{dueBills.length !== 1 ? 's' : ''} need a manual amount</p>
                      )}
                    </div>
                  )}
                  {upcoming.length > 0 && (
                    <div>
                      <p className="label mb-3">Upcoming</p>
                      <div className="card overflow-hidden">
                        {upcoming.map(item => <RecurringItem key={item.id} item={item} />)}
                      </div>
                    </div>
                  )}
                  {inactive.length > 0 && (
                    <div>
                      <p className="label mb-3 opacity-60">Paused</p>
                      <div className="card overflow-hidden opacity-60">
                        {inactive.map(item => <RecurringItem key={item.id} item={item} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={load} defaultType={txType} />
      <EditTransactionModal isOpen={!!editTx} onClose={() => setEditTx(null)} onSuccess={load} transaction={editTx} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
      <AddRecurringModal isOpen={showAddRecurring} onClose={() => setShowAddRecurring(false)} onSuccess={load} />
    </>
  );
};

export default Transactions;
