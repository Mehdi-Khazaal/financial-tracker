import React, { useEffect, useState, useRef, useCallback } from 'react';
import { localDateStr } from '../utils/date';
import { Transaction, Account, Category, RecurringTransaction } from '../types';
import {
  getTransactions, getAccounts, getCategories, deleteTransaction, cleanDescription,
  getRecurring, deleteRecurring, updateRecurring, processDueRecurring, logVariableRecurring,
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

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SWIPE_THRESHOLD = 80;
const SWIPE_MAX = 100;

const PERIOD_LABELS: Record<string, string> = { weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const PERIOD_COLORS: Record<string, string> = { weekly: '#a855f7', biweekly: 'var(--accent)', monthly: 'var(--pos)', quarterly: '#f59e0b', yearly: 'var(--neg)' };

interface SwipeRowProps {
  tx: Transaction; isLast: boolean; cat: Category | undefined;
  getAccountName: (id: number) => string;
  onEdit: (tx: Transaction) => void;
  onDelete: (id: number) => void;
}

const SwipeRow: React.FC<SwipeRowProps> = ({ tx, isLast, cat, getAccountName, onEdit, onDelete }) => {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const isDragging = useRef(false);
  const pos = Number(tx.amount) >= 0;

  const handleTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; isDragging.current = true; };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const dx = startX.current - e.touches[0].clientX;
    if (dx < 0) { setOffset(0); return; }
    setOffset(Math.min(dx, SWIPE_MAX));
  };
  const handleTouchEnd = () => { isDragging.current = false; setOffset(offset >= SWIPE_THRESHOLD ? SWIPE_MAX : 0); };
  const handleClick = () => { if (offset > 10) { setOffset(0); return; } onEdit(tx); };

  return (
    <div className={`swipe-row ${!isLast ? 'border-b border-border' : ''}`}
      onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="swipe-delete-bg">
        <button onClick={e => { e.stopPropagation(); onDelete(tx.id); setOffset(0); }} className="flex flex-col items-center gap-1">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Delete
        </button>
      </div>
      <div
        className="swipe-row-content flex items-center gap-3 px-4 py-3 hover:bg-surface2 transition-colors cursor-pointer"
        style={{ transform: `translateX(-${offset}px)`, backgroundColor: 'var(--elev-1)' }}
        onClick={handleClick}>
        <div className="w-1.5 h-10 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? (pos ? 'var(--pos)' : 'var(--neg)') }} />
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: pos ? 'oklch(78% 0.16 150 / 0.1)' : 'oklch(70% 0.17 25 / 0.1)', color: pos ? 'var(--pos)' : 'var(--neg)' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            {pos
              ? <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              : <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
            }
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text truncate">{cleanDescription(tx.description)}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>{getAccountName(tx.account_id)}</span>
            {cat && <><span>·</span><span>{cat.name}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <p className="font-semibold text-sm" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--neg)' }}>
            {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
          </p>
          <button onClick={e => { e.stopPropagation(); onDelete(tx.id); }}
            className="hidden md:flex opacity-0 group-hover:opacity-100 w-6 h-6 rounded-full items-center justify-center transition-all"
            style={{ color: 'var(--dim)' }}
            onMouseEnter={e => { (e.currentTarget).style.color = 'var(--neg)'; (e.currentTarget).style.backgroundColor = 'oklch(70% 0.17 25 / 0.1)'; }}
            onMouseLeave={e => { (e.currentTarget).style.color = 'var(--dim)'; (e.currentTarget).style.backgroundColor = 'transparent'; }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

const Transactions: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('transactions');

  // Transaction state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTx, setShowTx] = useState(false);
  const [txType, setTxType] = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterAccount, setFilterAccount] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterAmountMin, setFilterAmountMin] = useState('');
  const [filterAmountMax, setFilterAmountMax] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Recurring state
  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [billInputs, setBillInputs] = useState<Record<number, string>>({});
  const [loggingBill, setLoggingBill] = useState<number | null>(null);

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

  const handleDelete = async (id: number) => {
    const ok = await toast.confirm('Delete this transaction?', { danger: true });
    if (!ok) return;
    try { await deleteTransaction(id); load(); toast.success('Transaction deleted'); }
    catch { toast.error('Failed to delete transaction'); }
  };

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

  const getAccountName = (id: number) => accounts.find(a => a.id === id)?.name ?? 'Unknown';
  const getCategory    = (id: number | null) => categories.find(c => c.id === id);

  const activeFilterCount = [filterCategory !== 'all', filterDateFrom !== '', filterDateTo !== '', filterAmountMin !== '', filterAmountMax !== ''].filter(Boolean).length;

  const clearMoreFilters = () => { setFilterCategory('all'); setFilterDateFrom(''); setFilterDateTo(''); setFilterAmountMin(''); setFilterAmountMax(''); };

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  const filtered = transactions.filter(t => {
    if (!showAll && !filterDateFrom && t.transaction_date < cutoff) return false;
    if (filterAccount !== 'all' && t.account_id !== parseInt(filterAccount)) return false;
    if (filterType === 'income' && Number(t.amount) < 0) return false;
    if (filterType === 'expense' && Number(t.amount) >= 0) return false;
    if (filterCategory !== 'all' && t.category_id !== parseInt(filterCategory)) return false;
    if (filterDateFrom && t.transaction_date < filterDateFrom) return false;
    if (filterDateTo && t.transaction_date > filterDateTo) return false;
    if (filterAmountMin && Math.abs(Number(t.amount)) < parseFloat(filterAmountMin)) return false;
    if (filterAmountMax && Math.abs(Number(t.amount)) > parseFloat(filterAmountMax)) return false;
    if (search) {
      const q = search.toLowerCase();
      const descMatch = cleanDescription(t.description).toLowerCase().includes(q);
      const cat = categories.find(c => c.id === t.category_id);
      if (!descMatch && !cat?.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const grouped: Record<string, Transaction[]> = {};
  filtered.forEach(tx => { const k = tx.transaction_date; if (!grouped[k]) grouped[k] = []; grouped[k].push(tx); });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const formatDate = (d: string) => {
    const today = localDateStr();
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    if (d === today) return 'Today';
    if (d === yesterday) return 'Yesterday';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const totalIncome   = filtered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses = filtered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const net = totalIncome - totalExpenses;

  // Recurring derived
  const today = localDateStr();
  const dueNow   = items.filter(i => i.is_active && i.next_date <= today);
  const dueFixed = dueNow.filter(i => !i.is_variable);
  const dueBills = dueNow.filter(i => i.is_variable);
  const upcoming = items.filter(i => i.is_active && i.next_date > today);
  const inactive = items.filter(i => !i.is_active);

  const PERIOD_MULTIPLIERS: Record<string, number> = { weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 0.33, yearly: 0.083 };
  const monthlyNet     = items.filter(i => i.is_active).reduce((s, i) => s + Number(i.amount) * (PERIOD_MULTIPLIERS[i.period] ?? 1), 0);
  const monthlyIncome  = items.filter(i => i.is_active && Number(i.amount) > 0).reduce((s, i) => s + Number(i.amount) * (PERIOD_MULTIPLIERS[i.period] ?? 1), 0);
  const monthlyExpense = items.filter(i => i.is_active && Number(i.amount) < 0).reduce((s, i) => s + Math.abs(Number(i.amount)) * (PERIOD_MULTIPLIERS[i.period] ?? 1), 0);

  const formatNextDate = (d: string) => {
    const todayStr = localDateStr();
    if (d === todayStr) return 'Due today';
    if (d < todayStr) return 'Overdue';
    const days = Math.ceil((new Date(d).getTime() - new Date(todayStr).getTime()) / 86400000);
    if (days === 1) return 'Tomorrow';
    if (days <= 7) return `In ${days} days`;
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
          <div className="max-w-4xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-40 rounded-xl" />
            <div className="skeleton h-10 w-full rounded-xl" />
            <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
            <div className="skeleton h-28 rounded-2xl" />
          </div>
        </div>
      </>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'transactions', label: 'Transactions' },
    { id: 'recurring', label: 'Recurring' },
  ];

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
            <div className="text-right">
              <p className="font-mono font-bold text-sm" style={{ color: item.is_variable ? '#f59e0b' : (pos ? 'var(--pos)' : 'var(--neg)'), fontVariantNumeric: 'tabular-nums' }}>
                {item.is_variable ? '~' : (pos ? '+' : '-')}${fmt(Math.abs(Number(item.amount)))}
              </p>
            </div>
            <button onClick={() => handleToggle(item)}
              className="w-8 h-5 rounded-full transition-all relative shrink-0"
              style={{ backgroundColor: item.is_active ? 'var(--pos)' : 'var(--line)' }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: item.is_active ? '14px' : '2px' }} />
            </button>
            <button onClick={() => handleDeleteRecurring(item.id)}
              className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
              style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
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

  return (
    <>
      <Navigation />
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-4xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between pr-12 md:pr-0">
            <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>
              {tab === 'transactions' ? 'Transactions' : 'Recurring'}
            </h1>
            <div className="flex gap-2">
              {tab === 'transactions' && (
                <>
                  <button onClick={() => { setTxType('income'); setShowTx(true); }}
                    className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                    style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.1)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.2)' }}>
                    + Income
                  </button>
                  <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                    className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                    style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>
                    + Expense
                  </button>
                  <button onClick={() => setShowTransfer(true)}
                    className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                    style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.2)' }}>
                    Transfer
                  </button>
                </>
              )}
              {tab === 'recurring' && dueFixed.length > 0 && (
                <button onClick={handleProcess} disabled={processing}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all active:scale-95 disabled:opacity-50"
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

          {/* Tabs */}
          <div className="sticky top-0 z-20 py-2 -mx-4 px-4 md:-mx-6 md:px-6" style={{ backgroundColor: 'var(--bg)' }}>
            <div className="flex p-1 rounded-xl gap-0.5" style={{ backgroundColor: 'var(--elev-1)' }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-all"
                  style={tab === t.id
                    ? { backgroundColor: 'var(--bg)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                    : { color: 'var(--muted)' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── TRANSACTIONS TAB ── */}
          {tab === 'transactions' && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                  <p className="label mb-1">Income</p>
                  <p className="font-bold text-sm" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--pos)' }}>+${fmt(totalIncome)}</p>
                </div>
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                  <p className="label mb-1">Expenses</p>
                  <p className="font-bold text-sm" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--neg)' }}>-${fmt(totalExpenses)}</p>
                </div>
                <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                  <p className="label mb-1">Net</p>
                  <p className="font-bold text-sm" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: net >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {net >= 0 ? '+' : '-'}${fmt(Math.abs(net))}
                  </p>
                </div>
              </div>

              {/* Desktop layout: filters left, list right */}
              <div className="md:grid md:grid-cols-[260px_1fr] md:gap-6 md:items-start space-y-5 md:space-y-0">
                {/* Filters */}
                <div className="card p-4 space-y-3 md:sticky md:top-16">
                  <div className="relative">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--muted)' }}>
                      <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                    </svg>
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="Search transactions…" className="input-dark pl-9 text-sm" />
                    {search && (
                      <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors text-lg leading-none">×</button>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {(['all', 'income', 'expense'] as const).map(t => (
                      <button key={t} onClick={() => setFilterType(t)}
                        className="pill transition-all"
                        style={filterType === t
                          ? { backgroundColor: t === 'income' ? 'oklch(78% 0.16 150 / 0.15)' : t === 'expense' ? 'oklch(70% 0.17 25 / 0.15)' : 'var(--line)', color: t === 'income' ? 'var(--pos)' : t === 'expense' ? 'var(--neg)' : 'var(--fg)' }
                          : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                  <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} className="input-dark text-sm">
                    <option value="all">All Accounts</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button onClick={() => setShowMoreFilters(p => !p)}
                    className="flex items-center gap-1.5 text-xs font-semibold transition-colors"
                    style={{ color: activeFilterCount > 0 ? 'var(--accent)' : 'var(--muted)' }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
                    </svg>
                    {showMoreFilters ? 'Hide filters' : `More filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
                  </button>
                  {showMoreFilters && (
                    <div className="space-y-3 pt-1 border-t" style={{ borderColor: 'var(--line)' }}>
                      <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="input-dark text-sm">
                        <option value="all">All Categories</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <div><p className="label mb-1">From</p><input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="input-dark text-sm" /></div>
                        <div><p className="label mb-1">To</p><input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="input-dark text-sm" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><p className="label mb-1">Min $</p><input type="number" min="0" value={filterAmountMin} onChange={e => setFilterAmountMin(e.target.value)} placeholder="0" className="input-dark text-sm" /></div>
                        <div><p className="label mb-1">Max $</p><input type="number" min="0" value={filterAmountMax} onChange={e => setFilterAmountMax(e.target.value)} placeholder="∞" className="input-dark text-sm" /></div>
                      </div>
                      {activeFilterCount > 0 && (
                        <button onClick={clearMoreFilters} className="text-xs font-semibold" style={{ color: 'var(--neg)' }}>Clear filters</button>
                      )}
                    </div>
                  )}
                </div>

                {/* Transaction list */}
                <div className="space-y-4">
                  {sortedDates.length === 0 ? (
                    <div className="card py-12 text-center">
                      <p className="text-muted text-sm">No transactions found</p>
                      <button onClick={() => { setTxType('expense'); setShowTx(true); }} className="mt-3 text-xs font-semibold" style={{ color: 'var(--accent)' }}>Add one →</button>
                    </div>
                  ) : (
                    <>
                      {sortedDates.map(date => {
                        const dayTxs = grouped[date];
                        const dayNet = dayTxs.reduce((s, t) => s + Number(t.amount), 0);
                        return (
                          <div key={date}>
                            <div className="flex items-center justify-between mb-2">
                              <p className="label">{formatDate(date)}</p>
                              <p className="font-semibold text-xs" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: dayNet >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                                {dayNet >= 0 ? '+' : '-'}${fmt(Math.abs(dayNet))}
                              </p>
                            </div>
                            <div className="card overflow-hidden group">
                              {dayTxs.map((tx, i) => (
                                <SwipeRow key={tx.id} tx={tx} isLast={i === dayTxs.length - 1}
                                  cat={getCategory(tx.category_id)} getAccountName={getAccountName}
                                  onEdit={setEditTx} onDelete={handleDelete} />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {!showAll && !filterDateFrom && transactions.some(t => t.transaction_date < cutoff) && (
                        <button onClick={() => setShowAll(true)}
                          className="w-full py-3 text-sm font-semibold rounded-xl transition-all"
                          style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
                          Show all transactions
                        </button>
                      )}
                      {showAll && (
                        <button onClick={() => setShowAll(false)}
                          className="w-full py-3 text-sm font-semibold rounded-xl transition-all"
                          style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
                          Show recent only
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── RECURRING TAB ── */}
          {tab === 'recurring' && (
            <>
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
            </>
          )}

        </div>
      </main>

      {/* FAB */}
      <button
        onClick={() => tab === 'recurring' ? setShowAddRecurring(true) : (() => { setTxType('expense'); setShowTx(true); })()}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', backgroundColor: tab === 'recurring' ? 'var(--accent)' : 'var(--neg)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={load} defaultType={txType} />
      <EditTransactionModal isOpen={!!editTx} onClose={() => setEditTx(null)} onSuccess={load} transaction={editTx} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
      <AddRecurringModal isOpen={showAddRecurring} onClose={() => setShowAddRecurring(false)} onSuccess={load} />
    </>
  );
};

export default Transactions;
