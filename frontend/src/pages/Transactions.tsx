import React, { useEffect, useState, useRef, useCallback } from 'react';
import { localDateStr } from '../utils/date';
import { Transaction, Account, Category } from '../types';
import { getTransactions, getAccounts, getCategories, deleteTransaction } from '../utils/api';
import Navigation from '../components/Navigation';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import EditTransactionModal from '../components/modals/EditTransactionModal';
import TransferModal from '../components/modals/TransferModal';
import PullToRefresh from '../components/PullToRefresh';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SWIPE_THRESHOLD = 80;
const SWIPE_MAX = 100;

interface SwipeRowProps {
  tx: Transaction;
  isLast: boolean;
  cat: Category | undefined;
  getAccountName: (id: number) => string;
  onEdit: (tx: Transaction) => void;
  onDelete: (id: number) => void;
}

const SwipeRow: React.FC<SwipeRowProps> = ({ tx, isLast, cat, getAccountName, onEdit, onDelete }) => {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const isDragging = useRef(false);
  const pos = Number(tx.amount) >= 0;

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    isDragging.current = true;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const dx = startX.current - e.touches[0].clientX;
    if (dx < 0) { setOffset(0); return; }
    setOffset(Math.min(dx, SWIPE_MAX));
  };
  const handleTouchEnd = () => {
    isDragging.current = false;
    if (offset >= SWIPE_THRESHOLD) {
      setOffset(SWIPE_MAX);
    } else {
      setOffset(0);
    }
  };
  const handleClick = () => {
    if (offset > 10) { setOffset(0); return; }
    onEdit(tx);
  };

  return (
    <div className={`swipe-row ${!isLast ? 'border-b border-border' : ''}`}
      onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="swipe-delete-bg">
        <button
          onClick={e => { e.stopPropagation(); onDelete(tx.id); setOffset(0); }}
          className="flex flex-col items-center gap-1">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Delete
        </button>
      </div>
      <div
        className="swipe-row-content flex items-center gap-3 px-4 py-3 hover:bg-surface2 transition-colors cursor-pointer"
        style={{ transform: `translateX(-${offset}px)`, backgroundColor: '#0d1018' }}
        onClick={handleClick}>
        <div className="w-1.5 h-10 rounded-full shrink-0"
          style={{ backgroundColor: cat?.color ?? (pos ? '#10b981' : '#f43f5e') }} />
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: pos ? 'rgba(16,185,129,.1)' : 'rgba(244,63,94,.1)', color: pos ? '#10b981' : '#f43f5e' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            {pos
              ? <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              : <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
            }
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text truncate">{tx.description || 'No note'}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>{getAccountName(tx.account_id)}</span>
            {cat && <><span>·</span><span>{cat.name}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <p className="font-mono font-semibold text-sm" style={{ color: pos ? '#10b981' : '#f43f5e' }}>
            {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
          </p>
          <button
            onClick={e => { e.stopPropagation(); onDelete(tx.id); }}
            className="hidden md:flex opacity-0 group-hover:opacity-100 w-6 h-6 rounded-full items-center justify-center text-[10px] transition-all"
            style={{ color: '#363d56' }}
            onMouseEnter={e => { (e.currentTarget).style.color = '#f43f5e'; (e.currentTarget).style.backgroundColor = 'rgba(244,63,94,.1)'; }}
            onMouseLeave={e => { (e.currentTarget).style.color = '#363d56'; (e.currentTarget).style.backgroundColor = 'transparent'; }}>
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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTx, setShowTx] = useState(false);
  const [txType, setTxType] = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterAccount, setFilterAccount] = useState('all');

  const load = useCallback(async () => {
    try {
      const [txRes, accRes, catRes] = await Promise.all([getTransactions(), getAccounts(), getCategories()]);
      setTransactions(Array.isArray(txRes.data) ? txRes.data : []);
      setAccounts(Array.isArray(accRes.data) ? accRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
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

  const getAccountName = (id: number) => accounts.find(a => a.id === id)?.name ?? 'Unknown';
  const getCategory    = (id: number | null) => categories.find(c => c.id === id);

  const filtered = transactions.filter(t => {
    if (filterAccount !== 'all' && t.account_id !== parseInt(filterAccount)) return false;
    if (filterType === 'income'  && Number(t.amount) < 0) return false;
    if (filterType === 'expense' && Number(t.amount) >= 0) return false;
    return true;
  });

  // Group by date
  const grouped: Record<string, Transaction[]> = {};
  filtered.forEach(tx => {
    const key = tx.transaction_date;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(tx);
  });
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const formatDate = (d: string) => {
    const today     = localDateStr();
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    if (d === today) return 'Today';
    if (d === yesterday) return 'Yesterday';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const totalIncome   = filtered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses = filtered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const net = totalIncome - totalExpenses;

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#070810' }}>
          <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-40 rounded-xl" />
            <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
            <div className="skeleton h-28 rounded-2xl" />
            {[0,1,2].map(g => (
              <div key={g} className="space-y-2">
                <div className="skeleton h-3 w-20 rounded" />
                <div className="skeleton h-14 rounded-2xl" />
                <div className="skeleton h-14 rounded-2xl" />
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#070810' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-text">Transactions</h1>
              <p className="text-xs text-muted mt-0.5">Tap any transaction to edit</p>
            </div>
            <div className="hidden md:flex gap-2">
              <button onClick={() => { setTxType('income'); setShowTx(true); }}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ backgroundColor: 'rgba(16,185,129,.1)', color: '#10b981', border: '1px solid rgba(16,185,129,.2)' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                Income
              </button>
              <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ backgroundColor: 'rgba(244,63,94,.1)', color: '#f43f5e', border: '1px solid rgba(244,63,94,.2)' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                Expense
              </button>
              <button onClick={() => setShowTransfer(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ backgroundColor: 'rgba(99,102,241,.1)', color: '#6366f1', border: '1px solid rgba(99,102,241,.2)' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" /></svg>
                Transfer
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl p-4" style={{ backgroundColor: '#0d1018', border: '1px solid #1a1f2e' }}>
              <p className="label mb-1">Income</p>
              <p className="font-mono font-bold text-sm" style={{ color: '#10b981' }}>+${fmt(totalIncome)}</p>
            </div>
            <div className="rounded-2xl p-4" style={{ backgroundColor: '#0d1018', border: '1px solid #1a1f2e' }}>
              <p className="label mb-1">Expenses</p>
              <p className="font-mono font-bold text-sm" style={{ color: '#f43f5e' }}>-${fmt(totalExpenses)}</p>
            </div>
            <div className="rounded-2xl p-4" style={{ backgroundColor: '#0d1018', border: '1px solid #1a1f2e' }}>
              <p className="label mb-1">Net</p>
              <p className="font-mono font-bold text-sm" style={{ color: net >= 0 ? '#10b981' : '#f43f5e' }}>
                {net >= 0 ? '+' : '-'}${fmt(Math.abs(net))}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="card p-4 space-y-3">
            <div className="flex gap-2">
              {(['all', 'income', 'expense'] as const).map(t => (
                <button key={t} onClick={() => setFilterType(t)}
                  className="pill transition-all"
                  style={filterType === t
                    ? { backgroundColor: t === 'income' ? 'rgba(16,185,129,.15)' : t === 'expense' ? 'rgba(244,63,94,.15)' : '#1a1f2e',
                        color: t === 'income' ? '#10b981' : t === 'expense' ? '#f43f5e' : '#eef0f8' }
                    : { backgroundColor: '#0d1018', color: '#666e90' }}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} className="input-dark text-sm">
              <option value="all">All Accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          {/* Transaction list grouped by date */}
          {sortedDates.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-muted text-sm">No transactions found</p>
              <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                className="mt-3 text-xs font-semibold" style={{ color: '#6366f1' }}>Add one →</button>
            </div>
          ) : (
            <div className="space-y-4">
              {sortedDates.map(date => {
                const dayTxs   = grouped[date];
                const dayNet   = dayTxs.reduce((s, t) => s + Number(t.amount), 0);
                return (
                  <div key={date}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="label">{formatDate(date)}</p>
                      <p className="font-mono text-xs font-semibold" style={{ color: dayNet >= 0 ? '#10b981' : '#f43f5e' }}>
                        {dayNet >= 0 ? '+' : '-'}${fmt(Math.abs(dayNet))}
                      </p>
                    </div>
                    <div className="card overflow-hidden group">
                      {dayTxs.map((tx, i) => (
                        <SwipeRow
                          key={tx.id}
                          tx={tx}
                          isLast={i === dayTxs.length - 1}
                          cat={getCategory(tx.category_id)}
                          getAccountName={getAccountName}
                          onEdit={setEditTx}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* FAB */}
      <button onClick={() => { setTxType('expense'); setShowTx(true); }}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #f43f5e, #ff8e53)', boxShadow: '0 8px 32px rgba(244,63,94,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={load} defaultType={txType} />
      <EditTransactionModal isOpen={!!editTx} onClose={() => setEditTx(null)} onSuccess={load} transaction={editTx} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
    </>
  );
};

export default Transactions;
