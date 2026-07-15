import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouteTab } from '../context/TabContext';
import { localDateStr } from '../utils/date';
import { Transaction, Account, Category, RecurringTransaction } from '../types';
import {
  getTransactions, getAccounts, getCategories, deleteTransaction, cleanDescription,
  getRecurring, deleteRecurring, updateRecurring, processDueRecurring, logVariableRecurring,
  updateTransaction,
} from '../utils/api';
import { downloadCSV, printPDF } from '../utils/export';
import { AppShell, PageLayout } from '../components/layout/AppShell';
import BottomSheet from '../components/BottomSheet';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import EditTransactionModal from '../components/modals/EditTransactionModal';
import TransferModal from '../components/modals/TransferModal';
import AddRecurringModal from '../components/modals/AddRecurringModal';
import TransactionCard from '../components/transactions/TransactionCard';
import PullToRefresh from '../components/PullToRefresh';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import LoadErrorBanner from '../components/LoadErrorBanner';

type Tab = 'transactions' | 'list' | 'recurring';

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
  noDrag?: boolean;
  mobileCard?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onDelete: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TxCard: React.FC<TxCardProps> = ({
  tx, accounts, isDragging, compact = false, noDrag = false, mobileCard = false, onDragStart, onDragEnd, onClick, onDelete,
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
        draggable={!noDrag}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onClick}
        className={`group flex items-center gap-2 px-3 py-2.5 select-none transition-colors ${noDrag ? 'cursor-pointer active:opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          borderBottom: '1px solid var(--line)',
          opacity: isDragging ? 0.25 : 1,
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium truncate leading-snug" style={{ color: 'var(--fg)' }}>
            {cleanDescription(tx.description)}
          </p>
          <p className="text-[11px] mt-0.5 leading-none" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{shortDate}</p>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <p className="text-[11px] font-bold"
            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--neg)' }}>
            {amountStr}
          </p>
          {!noDrag && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="text-[8px] font-semibold mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: 'var(--neg)' }}
            >
              del
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Full row for the uncategorized inbox ──
  return (
    <div
      draggable={!noDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group flex items-start gap-2.5 select-none transition-colors ${mobileCard ? 'px-4 py-4 rounded-lg' : 'px-3 py-2.5'} ${noDrag ? 'cursor-pointer active:opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
      style={mobileCard ? {
        borderRadius: 14,
        backgroundColor: 'var(--elev-1)',
        border: '1px solid var(--line)',
        opacity: isDragging ? 0.25 : 1,
      } : {
        borderBottom: '1px solid var(--line)',
        opacity: isDragging ? 0.25 : 1,
      }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--elev-sub)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = mobileCard ? 'var(--elev-1)' : 'transparent')}
    >
      {/* Drag handle — hidden on mobile card */}
      {!mobileCard && (
        <div className="mt-[3px] shrink-0 opacity-0 group-hover:opacity-30 transition-opacity" style={{ color: 'var(--muted)' }}>
          <svg width="8" height="13" viewBox="0 0 8 13" fill="currentColor">
            <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
            <circle cx="2" cy="6.5" r="1.2"/><circle cx="6" cy="6.5" r="1.2"/>
            <circle cx="2" cy="11" r="1.2"/><circle cx="6" cy="11" r="1.2"/>
          </svg>
        </div>
      )}

      {/* Color accent dot — mobile card only */}
      {mobileCard && (
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{ backgroundColor: pos ? 'oklch(78% 0.16 150 / 0.12)' : 'oklch(70% 0.17 25 / 0.1)' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"
            style={{ color: pos ? 'var(--pos)' : 'var(--neg)' }}>
            {pos
              ? <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              : <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
            }
          </svg>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className={`${mobileCard ? 'text-sm' : 'text-[11px]'} font-semibold leading-snug truncate`} style={{ color: 'var(--fg)' }}>
          {cleanDescription(tx.description)}
        </p>
        <p className={`${mobileCard ? 'text-xs' : 'text-[9px]'} mt-0.5 truncate`} style={{ color: 'var(--dim)' }}>
          {accountName} · {shortDate}
        </p>
        {mobileCard && (
          <p className="text-[10px] mt-1.5 font-medium" style={{ color: 'var(--accent)' }}>
            Tap to categorize →
          </p>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end">
        <p className={`${mobileCard ? 'text-base' : 'text-[11px]'} font-bold`}
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--neg)' }}>
          {amountStr}
        </p>
        {!noDrag && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="text-[8px] font-semibold mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--neg)' }}
          >
            delete
          </button>
        )}
      </div>
    </div>
  );
};

// ── Category detail modal ─────────────────────────────────────────────────────
interface CatDetailProps {
  cat: Category | null;
  allTransactions: Transaction[];
  accounts: Account[];
  onClose: () => void;
  onEditTx: (tx: Transaction) => void;
  defaultMonth?: string;
}
const CategoryDetailModal: React.FC<CatDetailProps> = ({ cat, allTransactions, accounts, onClose, onEditTx, defaultMonth }) => {
  const [localMonth, setLocalMonth] = useState(defaultMonth ?? '');

  // Reset to the board's selected month each time a (new) category is opened
  useEffect(() => {
    if (cat) setLocalMonth(defaultMonth ?? '');
  }, [cat, defaultMonth]);

  // All transactions for this category (all time)
  const allCatTxs = cat
    ? allTransactions.filter(t => t.category_id === cat.id)
    : [];

  // Months that have at least one transaction in this category, newest first
  const catMonths = Array.from(
    new Set(allCatTxs.map(t => t.transaction_date.slice(0, 7)))
  ).sort().reverse();

  // Active month: honour the local pick if valid, otherwise fall back to most recent
  const effectiveMonth = catMonths.includes(localMonth) ? localMonth : (catMonths[0] ?? '');

  // Displayed list: filtered by month, sorted newest first
  const catTxs = allCatTxs
    .filter(t => !effectiveMonth || t.transaction_date.startsWith(effectiveMonth))
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));

  const spent  = catTxs.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const income = catTxs.filter(t => Number(t.amount) >= 0).reduce((s, t) => s + Number(t.amount), 0);

  return (
    <BottomSheet isOpen={!!cat} onClose={onClose}>
      {cat && (
        <>
          {/* Modal header */}
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${cat.color}15`, border: `1px solid ${cat.color}25` }}>
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
              </div>
              <div>
                <h2 className="font-bold text-[15px]" style={{ color: 'var(--fg)' }}>{cat.name}</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
                  {catTxs.length} transaction{catTxs.length !== 1 ? 's' : ''}
                  {spent > 0 && <> · <span style={{ color: 'var(--neg)' }}>-${fmt(spent)}</span></>}
                  {income > 0 && <> · <span style={{ color: 'var(--pos)' }}>+${fmt(income)}</span></>}
                </p>
              </div>
            </div>
            <button onClick={onClose}
              className="w-11 h-11 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Month pills */}
          {catMonths.length > 0 && (
            <div
              className="flex gap-1.5 px-5 py-3 overflow-x-auto hide-scrollbar shrink-0"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              {catMonths.map(m => (
                <button
                  key={m}
                  onClick={() => setLocalMonth(m)}
                  className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all"
                  style={effectiveMonth === m
                    ? { backgroundColor: cat.color, color: 'white' }
                    : { backgroundColor: 'var(--elev-sub)', color: 'var(--muted)', border: '1px solid var(--line)' }}
                >
                  {formatMonth(m)}
                </button>
              ))}
            </div>
          )}

          {/* Transaction list */}
          {catTxs.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-sm" style={{ color: 'var(--muted)' }}>No transactions this month</p>
            </div>
          ) : (
            <div className="pb-6">
              {catTxs.map((tx, i) => {
                const pos = Number(tx.amount) >= 0;
                const accName = accounts.find(a => a.id === tx.account_id)?.name ?? '';
                const dateStr = new Date(tx.transaction_date + 'T00:00:00').toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                });
                return (
                  <div key={tx.id}
                    onClick={() => { onClose(); onEditTx(tx); }}
                    className="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors"
                    style={{ borderBottom: i < catTxs.length - 1 ? '1px solid var(--line)' : 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--elev-sub)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
                        {cleanDescription(tx.description)}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        {accName} · {dateStr}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="font-mono font-bold text-sm"
                        style={{ color: pos ? 'var(--pos)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                        {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
                      </p>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
                        className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--dim)' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </BottomSheet>
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
  const [loadError, setLoadError]       = useState(false);

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
  const [detailCat, setDetailCat]           = useState<Category | null>(null);
  const [mobileView, setMobileView]         = useState<'queue' | 'categories'>('queue');
  const [categorizeTx, setCategorizeTx]     = useState<Transaction | null>(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showAddMenu, setShowAddMenu]         = useState(false);
  const [showExportMenu, setShowExportMenu]   = useState(false);
  const [showFilters, setShowFilters]         = useState(false);

  // List tab — pending (form inputs) + applied (what filteredList uses)
  const [pendingDateFrom, setPendingDateFrom] = useState('');
  const [pendingDateTo, setPendingDateTo]     = useState('');
  const [pendingAccount, setPendingAccount]   = useState('');
  const [pendingCategory, setPendingCategory] = useState('');
  const [pendingType, setPendingType]         = useState<'all' | 'income' | 'expense'>('all');
  const [pendingAmountMin, setPendingAmountMin] = useState('');
  const [pendingAmountMax, setPendingAmountMax] = useState('');
  const [appliedFilters, setAppliedFilters]   = useState({
    dateFrom: '', dateTo: '', account: '', category: '',
    type: 'all' as 'all' | 'income' | 'expense', amountMin: '', amountMax: '',
  });

  const MAX_TX_SHOWN = 3;

  // refs for the scrollable category grid and the mirrored top scrollbar
  const catScrollRef    = useRef<HTMLDivElement>(null);
  const topScrollRef    = useRef<HTMLDivElement>(null);
  const isSyncing       = useRef(false);
  const monthPickerRef  = useRef<HTMLDivElement>(null);
  const addMenuRef      = useRef<HTMLDivElement>(null);
  const exportMenuRef   = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [txRes, accRes, catRes, recRes] = await Promise.all([
        getTransactions(), getAccounts(), getCategories(), getRecurring(),
      ]);
      setTransactions(Array.isArray(txRes.data) ? txRes.data : []);
      setAccounts(Array.isArray(accRes.data) ? accRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      setItems(Array.isArray(recRes.data) ? recRes.data : []);
    } catch { setLoadError(true); }
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

  useEffect(() => {
    if (!showMonthPicker && !showAddMenu && !showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) setShowMonthPicker(false);
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setShowAddMenu(false);
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMonthPicker, showAddMenu, showExportMenu]);

  const monthTransactions = useMemo(() =>
    transactions.filter(t => selectedMonth && t.transaction_date.startsWith(selectedMonth)),
    [transactions, selectedMonth],
  );

  const uncategorized = useMemo(() =>
    monthTransactions.filter(t => !t.category_id),
    [monthTransactions],
  );

  const monthIncome = monthTransactions.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const monthExpenses = monthTransactions.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const monthNet = monthIncome - monthExpenses;
  const reviewedCount = Math.max(0, monthTransactions.length - uncategorized.length);
  const reviewRate = monthTransactions.length > 0 ? Math.round((reviewedCount / monthTransactions.length) * 100) : 100;
  const filteredList = useMemo(() => {
    const f = appliedFilters;
    return transactions.filter(t => {
      if (f.dateFrom  && t.transaction_date < f.dateFrom) return false;
      if (f.dateTo    && t.transaction_date > f.dateTo)   return false;
      if (f.account   && t.account_id !== parseInt(f.account)) return false;
      if (f.category) {
        if (f.category === 'none') { if (t.category_id !== null) return false; }
        else if (t.category_id !== parseInt(f.category)) return false;
      }
      if (f.type === 'income'  && Number(t.amount) <= 0) return false;
      if (f.type === 'expense' && Number(t.amount) >= 0) return false;
      if (f.amountMin && Math.abs(Number(t.amount)) < parseFloat(f.amountMin)) return false;
      if (f.amountMax && Math.abs(Number(t.amount)) > parseFloat(f.amountMax)) return false;
      return true;
    }).sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  }, [transactions, appliedFilters]);

  // Sort categories alphabetically A → Z
  const sortedCategories = useMemo(() =>
    [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  const topCategories = useMemo(() => sortedCategories
    .map(cat => {
      const txs = monthTransactions.filter(t => t.category_id === cat.id);
      return {
        ...cat,
        count: txs.length,
        total: txs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0),
      };
    })
    .filter(cat => cat.count > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4),
    [monthTransactions, sortedCategories],
  );

  const visibleCategories = sortedCategories;

  // Width of the top scroll mirror — matches the CSS grid maths:
  // gridAutoColumns: 240px, gap: 8px, padding: 12px each side → 248*cols + 16
  // 3 rows → ceil(cats/3) columns
  const numGridCols     = Math.max(1, Math.ceil(visibleCategories.length / 3));
  const catContentWidth = 248 * numGridCols + 16;

  // Keep top scrollbar ↔ category grid in perfect sync
  const handleTopScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncing.current) return;
    if (catScrollRef.current) {
      isSyncing.current = true;
      catScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
      requestAnimationFrame(() => { isSyncing.current = false; });
    }
  }, []);

  const handleCatScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncing.current) return;
    if (topScrollRef.current) {
      isSyncing.current = true;
      topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
      requestAnimationFrame(() => { isSyncing.current = false; });
    }
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    const ok = await toast.confirm('Delete this transaction?', { danger: true });
    if (!ok) return;
    try { await deleteTransaction(id); load(); toast.success('Transaction deleted'); }
    catch { toast.error('Failed to delete transaction'); }
  };

  const handleCategorize = async (txId: number, categoryId: number | null) => {
    const previousTx = transactions.find(t => t.id === txId);
    if (!previousTx) return;

    setTransactions(prev => prev.map(t => t.id === txId ? { ...t, category_id: categoryId } : t));
    try {
      const res = await updateTransaction(txId, { category_id: categoryId });
      setTransactions(prev => prev.map(t => t.id === txId ? { ...t, ...res.data } : t));
    } catch {
      setTransactions(prev => prev.map(t => t.id === txId ? previousTx : t));
      load();
      toast.error('Failed to update category');
    }
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

  const exportCurrentView = (format: 'csv' | 'pdf') => {
    const txs = tab === 'list' ? filteredList : monthTransactions;
    const { dateFrom, dateTo } = appliedFilters;
    const title = tab === 'list'
      ? `Transactions${dateFrom || dateTo ? ` (${dateFrom}${dateFrom && dateTo ? ' – ' : ''}${dateTo})` : ' — All'}`
      : `Transactions — ${formatMonth(selectedMonth)}`;
    const headers = ['Date', 'Description', 'Account', 'Category', 'Amount', 'Type'];
    const rows = txs.map(t => [
      t.transaction_date,
      cleanDescription(t.description),
      accounts.find(a => a.id === t.account_id)?.name ?? '',
      categories.find(c => c.id === t.category_id)?.name ?? 'Uncategorized',
      Number(t.amount).toFixed(2),
      Number(t.amount) >= 0 ? 'Income' : 'Expense',
    ]);
    if (format === 'csv') downloadCSV(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    else printPDF(title, headers, rows);
    setShowExportMenu(false);
  };

  const hasActiveFilters =
    appliedFilters.dateFrom !== '' || appliedFilters.dateTo !== '' ||
    appliedFilters.account !== '' || appliedFilters.category !== '' ||
    appliedFilters.type !== 'all' || appliedFilters.amountMin !== '' || appliedFilters.amountMax !== '';

  const activeFilterCount = [
    appliedFilters.dateFrom, appliedFilters.dateTo, appliedFilters.account,
    appliedFilters.category, appliedFilters.amountMin, appliedFilters.amountMax,
  ].filter(Boolean).length + (appliedFilters.type !== 'all' ? 1 : 0);

  const applyFilters = () => setAppliedFilters({
    dateFrom: pendingDateFrom, dateTo: pendingDateTo,
    account: pendingAccount, category: pendingCategory,
    type: pendingType, amountMin: pendingAmountMin, amountMax: pendingAmountMax,
  });

  const clearFilters = () => {
    setPendingDateFrom(''); setPendingDateTo(''); setPendingAccount('');
    setPendingCategory(''); setPendingType('all'); setPendingAmountMin(''); setPendingAmountMax('');
    setAppliedFilters({ dateFrom: '', dateTo: '', account: '', category: '', type: 'all', amountMin: '', amountMax: '' });
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
              className="w-11 h-11 rounded-full transition-all relative shrink-0"
              role="switch" aria-checked={item.is_active} aria-label={`${item.description || 'Recurring transaction'} active`}
              style={{ backgroundColor: item.is_active ? 'var(--pos)' : 'var(--line)' }}>
              <div className="absolute top-3 w-5 h-5 rounded-full bg-white shadow transition-all" style={{ left: item.is_active ? '21px' : '3px' }} />
            </button>
            <button onClick={() => handleDeleteRecurring(item.id)}
              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all"
              aria-label={`Delete ${item.description || 'recurring transaction'}`}
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
              <label className="sr-only" htmlFor={`recurring-amount-${item.id}`}>Amount for {item.description || 'recurring transaction'}</label>
              <input id={`recurring-amount-${item.id}`} type="number" inputMode="decimal" step="0.01" min="0.01" value={billInputs[item.id] ?? ''}
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
      // Defer so React's re-render (which changes visibleCategories)
      // doesn't fire mid-dragstart and cancel the gesture in some browsers.
      setTimeout(() => setDraggingTxId(tx.id), 0);
    },
    onDragEnd: () => { setDraggingTxId(null); setDragOverTarget(null); },
    onClick: () => setEditTx(tx),
    onDelete: () => handleDelete(tx.id),
  });

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppShell>
        <PageLayout>
          <div className="p-5 space-y-4">
            <div className="skeleton h-8 w-48 rounded-xl" />
            <div className="skeleton h-6 w-full rounded-xl" />
            <div className="flex gap-3 mt-4">
              {[0, 1, 2, 3].map(i => <div key={i} className="skeleton rounded-2xl w-44" style={{ minHeight: 140 }} />)}
            </div>
          </div>
        </PageLayout>
      </AppShell>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'transactions', label: 'Board' },
    { id: 'list',         label: 'List' },
    { id: 'recurring',    label: 'Recurring' },
  ];

  return (
    <AppShell>
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />

      <PageLayout scrollRegion="contained">
        {/* ── Header ── */}
        <div className="product-page-header topbar-safe shrink-0 flex-wrap justify-start gap-2 md:gap-3 px-4 md:px-5 py-2.5 border-b" style={{ borderColor: 'var(--line)' }}>

          {/* Tab switcher — desktop only; mobile uses the context tab bar in Navigation */}
          <div className="hidden md:flex p-1 rounded-xl shrink-0" style={{ backgroundColor: 'var(--elev-1)' }}>
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

          {/* Month dropdown */}
          {tab === 'transactions' && (
            <div ref={monthPickerRef} className="relative">
              <button
                onClick={() => setShowMonthPicker(v => !v)}
                className="header-action text-sm"
                aria-haspopup="listbox" aria-expanded={showMonthPicker}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M13.25 3v2.25M3 8.25h14M5.25 3.75h9.5A2.25 2.25 0 0117 6v10.5A2.25 2.25 0 0114.75 18.75H5.25A2.25 2.25 0 013 16.5V6A2.25 2.25 0 015.25 3.75z" />
                </svg>
                <span>{selectedMonth ? formatMonth(selectedMonth) : 'Month'}</span>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0" style={{ color: 'var(--dim)', transform: showMonthPicker ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {showMonthPicker && availableMonths.length > 0 && (
                <div className="menu-surface absolute top-full left-0 mt-1.5 min-w-[170px] py-1" role="listbox" aria-label="Transaction month">
                  {availableMonths.map(m => (
                    <button key={m}
                      onClick={() => { setSelectedMonth(m); setShowMonthPicker(false); }}
                      className="menu-item justify-between text-sm font-medium"
                      role="option" aria-selected={m === selectedMonth}
                      style={m === selectedMonth
                        ? { backgroundColor: 'oklch(72% 0.17 55 / 0.12)', color: 'var(--accent)' }
                        : { color: 'var(--fg)' }}
                    >
                      {formatMonth(m)}
                      {m === selectedMonth && (
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Filters button (list tab) */}
          {tab === 'list' && (
            <button
              onClick={() => setShowFilters(v => !v)}
              className="header-action text-sm"
              style={{
                backgroundColor: showFilters || hasActiveFilters ? 'oklch(72% 0.17 55 / 0.15)' : 'var(--elev-1)',
                color: showFilters || hasActiveFilters ? 'var(--accent)' : 'var(--fg)',
                border: `1px solid ${showFilters || hasActiveFilters ? 'oklch(72% 0.17 55 / 0.3)' : 'var(--line)'}`,
              }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
              </svg>
              <span>Filters</span>
              {hasActiveFilters && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                  style={{ backgroundColor: 'var(--accent)', color: 'white' }}>
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Export dropdown */}
          {(tab === 'transactions' || tab === 'list') && (
            <div ref={exportMenuRef} className="relative shrink-0">
              <button
                onClick={() => setShowExportMenu(v => !v)}
                className="header-action text-sm"
                aria-haspopup="menu" aria-expanded={showExportMenu}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }}>
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                <span>Export</span>
              </button>
              {showExportMenu && (
                <div className="menu-surface absolute top-full right-0 mt-1.5 min-w-[156px] py-1" role="menu">
                  {[
                    {
                      label: 'CSV', hint: 'Spreadsheet', color: 'var(--pos)',
                      icon: <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />,
                      action: () => exportCurrentView('csv'),
                    },
                    {
                      label: 'PDF', hint: 'Print / Save', color: 'var(--neg)',
                      icon: <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />,
                      action: () => exportCurrentView('pdf'),
                    },
                  ].map(item => (
                    <button key={item.label} onClick={item.action}
                      className="menu-item"
                      role="menuitem"
                    >
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: item.color === 'var(--pos)' ? 'oklch(78% 0.16 150 / 0.15)' : 'oklch(70% 0.17 25 / 0.15)' }}>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" style={{ color: item.color }}>{item.icon}</svg>
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--fg)' }}>{item.label}</p>
                        <p className="text-[10px] leading-none mt-0.5" style={{ color: 'var(--dim)' }}>{item.hint}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add dropdown (transactions / list tab) */}
          {(tab === 'transactions' || tab === 'list') && (
            <div ref={addMenuRef} className="relative shrink-0">
              <button
                onClick={() => setShowAddMenu(v => !v)}
                className="header-action header-action--primary text-sm"
                aria-haspopup="menu" aria-expanded={showAddMenu}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }}>
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                <span>Add</span>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0" style={{ color: 'var(--dim)', transform: showAddMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {showAddMenu && (
                <div className="menu-surface absolute top-full right-0 mt-1.5 min-w-[168px] py-1" role="menu">
                  {[
                    {
                      label: 'Income', hint: 'Money in',
                      bg: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)',
                      icon: <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />,
                      action: () => { setTxType('income'); setShowTx(true); setShowAddMenu(false); },
                    },
                    {
                      label: 'Expense', hint: 'Money out',
                      bg: 'oklch(70% 0.17 25 / 0.15)', color: 'var(--neg)',
                      icon: <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />,
                      action: () => { setTxType('expense'); setShowTx(true); setShowAddMenu(false); },
                    },
                  ].map(item => (
                    <button key={item.label} onClick={item.action}
                      className="menu-item"
                      role="menuitem"
                    >
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: item.bg }}>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" style={{ color: item.color }}>{item.icon}</svg>
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--fg)' }}>{item.label}</p>
                        <p className="text-[10px] leading-none mt-0.5" style={{ color: 'var(--dim)' }}>{item.hint}</p>
                      </div>
                    </button>
                  ))}
                  <div className="mx-3.5 my-1" style={{ height: 1, backgroundColor: 'var(--line)' }} />
                  <button
                    onClick={() => { setShowTransfer(true); setShowAddMenu(false); }}
                    className="menu-item"
                    role="menuitem"
                  >
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.15)' }}>
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }}>
                        <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--fg)' }}>Transfer</p>
                      <p className="text-[10px] leading-none mt-0.5" style={{ color: 'var(--dim)' }}>Between accounts</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Recurring tab actions */}
          {tab === 'recurring' && (
            <div className="flex gap-2 ml-auto shrink-0">
              {dueFixed.length > 0 && (
                <button onClick={handleProcess} disabled={processing}
                  className="text-xs font-semibold h-11 px-3 rounded-lg disabled:opacity-50 transition-all"
                  style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.12)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>
                  {processing ? '…' : `Log ${dueFixed.length} fixed`}
                </button>
              )}
              <button onClick={() => setShowAddRecurring(true)}
                className="text-xs font-semibold h-11 px-3 rounded-lg transition-all"
                style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                + Add
              </button>
            </div>
          )}
        </div>

        {/* ── Board Tab ── */}
        {loadError && (
          <div className="shrink-0 px-3 pt-3 md:px-4">
            <LoadErrorBanner onRetry={() => void load()} />
          </div>
        )}

        {tab === 'transactions' && (
          loadError && transactions.length === 0 ? (
            <div className="flex-1" />
          ) : availableMonths.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="font-semibold text-text mb-1">No imported transactions yet</p>
                <p className="text-sm text-muted mb-5">Connect or sync accounts first. Manual entry stays available for rare cash corrections.</p>
                <button onClick={() => setShowTransfer(true)} className="btn-ghost px-6 py-2.5 text-sm">
                  Rare manual action
                </button>
              </div>
            </div>
          ) : (
            <>
            {/* ── Desktop board (md+) ── */}
            <div className="ledger-panel mx-3 md:mx-4 mt-3 mb-3 p-3 md:p-4 shrink-0">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <p className="label mb-1">Import Review</p>
                      <p className="text-sm md:text-base font-semibold" style={{ color: 'var(--fg)' }}>
                        {uncategorized.length > 0 ? `${uncategorized.length} uncategorized this month` : 'Month is fully categorized'}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-bold" style={{ color: uncategorized.length > 0 ? 'var(--accent)' : 'var(--pos)' }}>
                      {reviewRate}%
                    </span>
                  </div>
                  <div className="review-meter"><span style={{ width: `${reviewRate}%` }} /></div>
                </div>
                <div className="grid grid-cols-3 gap-2 md:w-[420px]">
                  {[
                    { label: 'In', value: `+$${fmt(monthIncome)}`, color: 'var(--pos)' },
                    { label: 'Out', value: `-$${fmt(monthExpenses)}`, color: 'var(--neg)' },
                    { label: 'Net', value: `${monthNet >= 0 ? '+' : '-'}$${fmt(Math.abs(monthNet))}`, color: monthNet >= 0 ? 'var(--pos)' : 'var(--neg)' },
                  ].map(item => (
                    <div key={item.label} className="ledger-cell px-3 py-2">
                      <p className="label mb-1">{item.label}</p>
                      <p className="font-mono text-xs font-bold truncate" style={{ color: item.color, fontVariantNumeric: 'tabular-nums' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="hidden md:flex flex-1 overflow-hidden">

              {/* ── Inbox: uncategorized queue ── */}
              <div
                className="flex flex-col shrink-0 overflow-hidden"
                style={{ width: '240px', borderRight: '1px solid var(--line)' }}
              >
                {/* Inbox header */}
                <div className="px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {uncategorized.length > 0 && (
                        <div className="w-1.5 h-1.5 rounded-full pulse-dot shrink-0" style={{ backgroundColor: 'var(--neg)' }} />
                      )}
                      <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--dim)' }}>Inbox</p>
                    </div>
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
                  {monthTransactions.length > 0 && (
                    <div className="mt-2 rounded-full overflow-hidden" style={{ height: '2px', backgroundColor: 'var(--line)' }}>
                      <div style={{
                        height: '100%',
                        borderRadius: 9999,
                        width: `${Math.round(((monthTransactions.length - uncategorized.length) / monthTransactions.length) * 100)}%`,
                        backgroundColor: uncategorized.length === 0 ? 'var(--pos)' : 'var(--accent)',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  )}
                </div>

                {/* Inbox list — is also the drag-to-uncategorize drop zone */}
                <div
                  className="app-scrollbar flex-1 overflow-y-auto"
                  style={{
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
                      <TransactionCard key={tx.id} tx={tx} accounts={accounts}
                        isDragging={draggingTxId === tx.id} {...makeDragHandlers(tx)} />
                    ))
                  )}
                </div>
              </div>

              {/* ── Category area: top scrollbar + grid ── */}
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* Scrollbar track — sits above the grid, aligned to category columns only */}
                {sortedCategories.length > 0 && (
                  <div
                    ref={topScrollRef}
                    className="app-scrollbar shrink-0 overflow-x-scroll overflow-y-hidden"
                    style={{ height: '10px', borderBottom: '1px solid var(--line)' }}
                    onScroll={handleTopScroll}
                  >
                    <div style={{ width: catContentWidth, height: '1px' }} />
                  </div>
                )}

                {/* Grid clip wrapper */}
                <div className="flex-1 overflow-hidden">
                <div
                  ref={catScrollRef}
                  className="overflow-y-hidden"
                  style={{ overflowX: 'scroll', height: 'calc(100% + 20px)' }}
                  onScroll={handleCatScroll}
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
                      gridTemplateRows: 'repeat(3, auto)',
                      gridAutoFlow: 'column',
                      gridAutoColumns: '240px',
                      alignItems: 'start',
                      minWidth: 'max-content',
                      gap: '8px',
                      padding: '10px 12px 30px',
                    }}
                  >
                    {visibleCategories.map(cat => {
                      const catTxs      = monthTransactions.filter(t => t.category_id === cat.id);
                      const total       = catTxs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
                      const isDragOver  = dragOverTarget === cat.id;
                      const shownTxs    = catTxs.slice(0, MAX_TX_SHOWN);
                      const hiddenCount = catTxs.length - shownTxs.length;

                      return (
                        <div
                          key={cat.id}
                          className="flex flex-col overflow-hidden"
                          style={{
                            borderRadius: '12px',
                            backgroundColor: isDragOver ? `${cat.color}14` : `${cat.color}07`,
                            border: `1px solid ${isDragOver ? cat.color + '50' : cat.color + '28'}`,
                            transition: 'background-color 0.12s, border-color 0.12s',
                          }}
                          onDragOver={handleDragOver(cat.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop(cat.id)}
                        >
                          {/* Column header — click to open full detail modal */}
                          <button
                            type="button"
                            className="w-full cursor-pointer text-left transition-colors"
                            style={{
                              borderBottom: `1px solid ${cat.color}20`,
                              padding: '10px 12px',
                            }}
                            onClick={() => setDetailCat(cat)}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = `${cat.color}0d`)}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
                                <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--fg)' }}>
                                  {cat.name}
                                </p>
                              </div>
                              {catTxs.length > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0"
                                  style={{ backgroundColor: `${cat.color}22`, color: cat.color }}>
                                  {catTxs.length}
                                </span>
                              )}
                            </div>
                            <p className="text-[16px] font-bold leading-tight"
                              style={{ fontFamily: 'var(--font-mono)', color: cat.color, fontVariantNumeric: 'tabular-nums' }}>
                              ${fmt(total)}
                            </p>
                          </button>

                          {/* Transaction rows — natural height, no scroll */}
                          <div>
                            {shownTxs.map(tx => (
                              <TransactionCard key={tx.id} tx={tx} accounts={accounts} compact
                                isDragging={draggingTxId === tx.id} {...makeDragHandlers(tx)} />
                            ))}
                            {catTxs.length === 0 && !isDragOver && (
                              <div className="mx-2.5 my-3 border border-dashed rounded-xl py-4 text-center"
                                style={{ borderColor: `${cat.color}30` }}>
                                <p className="text-[10px] font-medium" style={{ color: `${cat.color}` , opacity: 0.5 }}>Drop to categorize</p>
                              </div>
                            )}
                            {isDragOver && (
                              <div className="mx-2.5 my-2 rounded-xl py-4 text-center"
                                style={{ border: `2px dashed ${cat.color}80`, backgroundColor: `${cat.color}0a` }}>
                                <p className="text-[10px] font-bold" style={{ color: cat.color }}>Drop here</p>
                              </div>
                            )}
                          </div>

                          {/* Footer: "view more" or color accent */}
                          {hiddenCount > 0 ? (
                            <button
                              onClick={() => setDetailCat(cat)}
                              className="w-full py-2.5 text-[10px] font-semibold transition-colors"
                              style={{ color: cat.color, borderTop: `1px solid ${cat.color}25`, backgroundColor: `${cat.color}08` }}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = `${cat.color}14`)}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = `${cat.color}08`)}
                            >
                              +{hiddenCount} more →
                            </button>
                          ) : catTxs.length > 0 ? (
                            <div style={{ height: '2px', backgroundColor: cat.color, opacity: 0.25 }} />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              </div> {/* /grid clip */}
              </div> {/* /category area */}

            </div>

            {/* ── Mobile board (< md) — tap-to-categorize ── */}
            <div className="md:hidden flex-1 flex flex-col overflow-hidden">

              {/* View toggle */}
              <div className="flex gap-1.5 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
                <button
                  onClick={() => setMobileView('queue')}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                  style={mobileView === 'queue'
                    ? { backgroundColor: 'var(--elev-1)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                    : { color: 'var(--muted)' }}>
                  Uncategorized
                  {uncategorized.length > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                      style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.15)', color: 'var(--neg)' }}>
                      {uncategorized.length}
                    </span>
                  )}
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
                <div className="app-scrollbar flex-1 overflow-y-auto p-3 space-y-2 mobile-tabs-spacer md:pb-4">
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
                    <TransactionCard key={tx.id} tx={tx} accounts={accounts} isDragging={false} noDrag mobileCard
                      onDragStart={() => {}} onDragEnd={() => {}}
                      onClick={() => setCategorizeTx(tx)}
                      onDelete={() => handleDelete(tx.id)} />
                  ))}
                </div>
              )}

              {/* By-category list */}
              {mobileView === 'categories' && (
                <div className="app-scrollbar flex-1 overflow-y-auto p-3 mobile-tabs-spacer md:pb-4">
                  <div className="grid grid-cols-2 gap-2.5">
                  {visibleCategories.map(cat => {
                    const catTxs = monthTransactions.filter(t => t.category_id === cat.id);
                    const total  = catTxs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
                    const shown  = catTxs.slice(0, MAX_TX_SHOWN);
                    const hidden = catTxs.length - shown.length;
                    return (
                      <div key={cat.id} className="rounded-lg overflow-hidden"
                        style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                        {/* Category header — taps open detail modal */}
                        <div
                          className="px-3 py-2.5 cursor-pointer active:opacity-70 transition-opacity"
                          style={{ borderBottom: catTxs.length > 0 ? '1px solid var(--line)' : 'none' }}
                          onClick={() => setDetailCat(cat)}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                            <p className="text-xs font-semibold truncate" style={{ color: 'var(--muted)' }}>{cat.name}</p>
                          </div>
                          <p className="font-mono font-bold text-base leading-tight"
                            style={{ color: cat.color, fontVariantNumeric: 'tabular-nums' }}>
                            ${fmt(total)}
                          </p>
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>{catTxs.length} transactions</p>
                        </div>
                        {/* Preview: first MAX_TX_SHOWN transactions */}
                        {shown.map((tx, i) => {
                          const pos = Number(tx.amount) >= 0;
                          const shortDate = new Date(tx.transaction_date + 'T00:00:00')
                            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          return (
                            <div key={tx.id}
                              onClick={() => setEditTx(tx)}
                              className="flex items-center gap-2 px-3 py-2 cursor-pointer active:opacity-60 transition-opacity"
                              style={{ borderBottom: (i < shown.length - 1 || hidden > 0) ? '1px solid var(--line)' : 'none' }}>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>
                                  {cleanDescription(tx.description)}
                                </p>
                                <p className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{shortDate}</p>
                              </div>
                              <p className="font-mono font-bold text-xs shrink-0"
                                style={{ color: pos ? 'var(--pos)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                                {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
                              </p>
                            </div>
                          );
                        })}
                        {hidden > 0 && (
                          <button
                            onClick={() => setDetailCat(cat)}
                            className="w-full py-2.5 text-xs font-semibold transition-colors active:opacity-70"
                            style={{ color: cat.color, backgroundColor: `${cat.color}08` }}
                          >
                            +{hidden} more transactions
                          </button>
                        )}
                      </div>
                    );
                  })}
                  </div> {/* /grid */}
                </div>
              )}
            </div>

            </>
          )
        )}

        {/* ── List Tab ── */}
        {tab === 'list' && (
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Collapsible filter panel */}
            {showFilters && (
              <div className="shrink-0 p-3 space-y-3" style={{ borderBottom: '1px solid var(--line)', backgroundColor: 'var(--elev-1)' }}>
                <div className="grid grid-cols-2 gap-2.5">

                  {/* Type */}
                  <div className="col-span-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--dim)' }}>Type</p>
                    <div className="flex p-0.5 rounded-xl" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)' }}>
                      {(['all', 'income', 'expense'] as const).map(t => (
                        <button key={t} onClick={() => setPendingType(t)}
                          className="flex-1 py-2 text-xs font-semibold rounded-lg capitalize transition-all"
                          style={pendingType === t
                            ? {
                                backgroundColor: t === 'income' ? 'oklch(78% 0.16 150 / 0.2)' : t === 'expense' ? 'oklch(70% 0.17 25 / 0.2)' : 'var(--elev-1)',
                                color: t === 'income' ? 'var(--pos)' : t === 'expense' ? 'var(--neg)' : 'var(--fg)',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                              }
                            : { color: 'var(--muted)' }}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* From */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--dim)' }}>From</p>
                    <input type="date" value={pendingDateFrom} onChange={e => setPendingDateFrom(e.target.value)}
                      className="w-full text-xs px-2.5 py-2.5 rounded-xl"
                      style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)', color: pendingDateFrom ? 'var(--fg)' : 'var(--dim)', outline: 'none' }} />
                  </div>

                  {/* To */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--dim)' }}>To</p>
                    <input type="date" value={pendingDateTo} onChange={e => setPendingDateTo(e.target.value)}
                      className="w-full text-xs px-2.5 py-2.5 rounded-xl"
                      style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)', color: pendingDateTo ? 'var(--fg)' : 'var(--dim)', outline: 'none' }} />
                  </div>

                  {/* Account */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--dim)' }}>Account</p>
                    <select value={pendingAccount} onChange={e => setPendingAccount(e.target.value)}
                      className="w-full text-xs px-2.5 py-2.5 rounded-xl"
                      style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--fg)', outline: 'none' }}>
                      <option value="">All accounts</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>

                  {/* Category */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--dim)' }}>Category</p>
                    <select value={pendingCategory} onChange={e => setPendingCategory(e.target.value)}
                      className="w-full text-xs px-2.5 py-2.5 rounded-xl"
                      style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--fg)', outline: 'none' }}>
                      <option value="">All categories</option>
                      <option value="none">Uncategorized</option>
                      {sortedCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  {/* Min $ */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--dim)' }}>Min $</p>
                    <input type="number" min="0" step="0.01" value={pendingAmountMin}
                      onChange={e => setPendingAmountMin(e.target.value)} placeholder="0.00"
                      className="w-full text-xs px-2.5 py-2.5 rounded-xl"
                      style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--fg)', outline: 'none' }} />
                  </div>

                  {/* Max $ */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--dim)' }}>Max $</p>
                    <input type="number" min="0" step="0.01" value={pendingAmountMax}
                      onChange={e => setPendingAmountMax(e.target.value)} placeholder="Any"
                      className="w-full text-xs px-2.5 py-2.5 rounded-xl"
                      style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--fg)', outline: 'none' }} />
                  </div>

                </div>

                {/* Apply + Clear */}
                <div className="flex gap-2">
                  <button onClick={() => { applyFilters(); setShowFilters(false); }}
                    className="flex-1 py-2.5 text-sm font-bold rounded-xl transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--accent)', color: 'white' }}>
                    Apply Filters
                  </button>
                  <button onClick={clearFilters}
                    className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
                    style={{ color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.25)', backgroundColor: 'oklch(70% 0.17 25 / 0.07)' }}>
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Summary strip */}
            {filteredList.length > 0 && (
              <div className="shrink-0 flex items-center gap-4 px-4 py-2 text-[11px]"
                style={{ borderBottom: '1px solid var(--line)', backgroundColor: 'var(--elev-1)' }}>
                <span style={{ color: 'var(--muted)' }}>{filteredList.length} transaction{filteredList.length !== 1 ? 's' : ''}</span>
                {filteredList.some(t => Number(t.amount) > 0) && (
                  <span className="font-mono font-semibold" style={{ color: 'var(--pos)', fontVariantNumeric: 'tabular-nums' }}>
                    +${fmt(filteredList.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0))}
                  </span>
                )}
                {filteredList.some(t => Number(t.amount) < 0) && (
                  <span className="font-mono font-semibold" style={{ color: 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                    −${fmt(filteredList.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0))}
                  </span>
                )}
              </div>
            )}

            {/* Transaction list */}
            <div className="flex-1 overflow-y-auto app-scrollbar mobile-tabs-spacer md:pb-4">
              {filteredList.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
                    {hasActiveFilters ? 'No transactions match' : 'No transactions yet'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
                    {hasActiveFilters
                      ? 'Try adjusting your filters'
                      : transactions.length === 0
                        ? 'Add your first transaction to get started'
                        : 'Tap Filters to search your transactions'}
                  </p>
                </div>
              ) : (
                filteredList.map(tx => (
                  <TransactionCard key={tx.id} tx={tx} accounts={accounts}
                    isDragging={false} noDrag
                    onDragStart={() => {}} onDragEnd={() => {}}
                    onClick={() => setEditTx(tx)}
                    onDelete={() => handleDelete(tx.id)} />
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Recurring Tab ── */}
        {tab === 'recurring' && (
          <div className="flex-1 overflow-y-auto mobile-tabs-spacer md:pb-10">
            <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-5 fade-in">
              <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Recurring</h1>

              {items.filter(i => i.is_active).length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                    <p className="label mb-1">Est. Income</p>
                    <p className="font-mono font-bold text-sm" style={{ color: 'var(--pos)', fontVariantNumeric: 'tabular-nums' }}>+${fmt(monthlyIncome)}</p>
                    <p className="text-[10px] text-muted mt-0.5">/month</p>
                  </div>
                  <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                    <p className="label mb-1">Est. Costs</p>
                    <p className="font-mono font-bold text-sm" style={{ color: 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>-${fmt(monthlyExpense)}</p>
                    <p className="text-[10px] text-muted mt-0.5">/month</p>
                  </div>
                  <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
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
                          className="mt-2 w-full py-3 text-sm font-semibold rounded-lg transition-all active:scale-95 disabled:opacity-50"
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

      </PageLayout>

      {/* ── Categorize picker (mobile) ── */}
      {categorizeTx && (() => {
        const pos = Number(categorizeTx.amount) >= 0;
        return (
          <BottomSheet isOpen={!!categorizeTx} onClose={() => setCategorizeTx(null)}>
            <div>
              {/* Transaction summary */}
              <div className="px-5 pt-5 pb-4 text-center" style={{ borderBottom: '1px solid var(--line)' }}>
                <p className="text-3xl font-bold"
                  style={{ color: pos ? 'var(--pos)' : 'var(--neg)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  {pos ? '+' : '-'}${fmt(Math.abs(Number(categorizeTx.amount)))}
                </p>
                <p className="text-sm font-medium mt-1.5 truncate" style={{ color: 'var(--muted)' }}>
                  {cleanDescription(categorizeTx.description)}
                </p>
              </div>

              {/* Category grid */}
              <div className="px-4 pt-4 pb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--dim)' }}>
                  Assign category
                </p>
                {topCategories.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>
                      Common this month
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {topCategories.map(cat => (
                        <button
                          key={cat.id}
                          onClick={async () => { await handleCategorize(categorizeTx.id, cat.id); setCategorizeTx(null); }}
                          className="flex items-center justify-between gap-2 px-3.5 py-3 rounded-lg text-left transition-all active:scale-[0.97]"
                          style={{ backgroundColor: `${cat.color}12`, border: `1px solid ${cat.color}38` }}>
                          <span className="text-sm font-semibold truncate" style={{ color: cat.color }}>{cat.name}</span>
                          <span className="font-mono text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>{cat.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {sortedCategories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={async () => { await handleCategorize(categorizeTx.id, cat.id); setCategorizeTx(null); }}
                      className="flex items-center gap-2.5 px-3.5 py-3 rounded-lg text-left transition-all active:scale-[0.97]"
                      style={{ backgroundColor: `${cat.color}12`, border: `1px solid ${cat.color}28` }}>
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      <p className="text-sm font-semibold truncate" style={{ color: cat.color }}>{cat.name}</p>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-3 mb-1">
                  <button
                    onClick={() => { const t = categorizeTx; setCategorizeTx(null); handleDelete(t.id); }}
                    className="flex-1 py-3 text-sm font-semibold rounded-xl transition-all active:scale-95"
                    style={{ color: 'var(--neg)', backgroundColor: 'oklch(70% 0.17 25 / 0.1)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>
                    Delete
                  </button>
                  <button
                    onClick={() => { setCategorizeTx(null); setEditTx(categorizeTx); }}
                    className="flex-1 py-3 text-sm font-semibold rounded-xl transition-all active:scale-95"
                    style={{ color: 'var(--muted)', backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
                    Edit details
                  </button>
                </div>
              </div>
            </div>
          </BottomSheet>
        );
      })()}

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={load} defaultType={txType} />
      <EditTransactionModal isOpen={!!editTx} onClose={() => setEditTx(null)} onSuccess={load} transaction={editTx} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
      <AddRecurringModal isOpen={showAddRecurring} onClose={() => setShowAddRecurring(false)} onSuccess={load} />
      <CategoryDetailModal
        cat={detailCat}
        allTransactions={transactions}
        accounts={accounts}
        onClose={() => setDetailCat(null)}
        onEditTx={tx => setEditTx(tx)}
        defaultMonth={selectedMonth}
      />
    </AppShell>
  );
};

export default Transactions;
