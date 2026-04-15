import React, { useEffect, useState } from 'react';
import { Transaction, Account, Category } from '../types';
import { getTransactions, getAccounts, getCategories, deleteTransaction } from '../utils/api';
import Navigation from '../components/Navigation';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import TransferModal from '../components/modals/TransferModal';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTx, setShowTx] = useState(false);
  const [txType, setTxType] = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterAccount, setFilterAccount] = useState('all');

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [txRes, accRes, catRes] = await Promise.all([getTransactions(), getAccounts(), getCategories()]);
      setTransactions(txRes.data); setAccounts(accRes.data); setCategories(catRes.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this transaction?')) return;
    try { await deleteTransaction(id); load(); }
    catch { alert('Failed to delete'); }
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
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (d === today) return 'Today';
    if (d === yesterday) return 'Yesterday';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const totalIncome   = filtered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses = filtered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const net = totalIncome - totalExpenses;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#0b0d12' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: '#5b8fff', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#0b0d12' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-text">Transactions</h1>
            <div className="hidden md:flex gap-2">
              <button onClick={() => { setTxType('income'); setShowTx(true); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ backgroundColor: 'rgba(46,204,138,.1)', color: '#2ecc8a', border: '1px solid rgba(46,204,138,.2)' }}>
                ↑ Income
              </button>
              <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ backgroundColor: 'rgba(255,95,109,.1)', color: '#ff5f6d', border: '1px solid rgba(255,95,109,.2)' }}>
                ↓ Expense
              </button>
              <button onClick={() => setShowTransfer(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ backgroundColor: 'rgba(91,143,255,.1)', color: '#5b8fff', border: '1px solid rgba(91,143,255,.2)' }}>
                ⇄ Transfer
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl p-4" style={{ backgroundColor: '#11141c', border: '1px solid #252a3a' }}>
              <p className="label mb-1">Income</p>
              <p className="font-mono font-bold text-sm" style={{ color: '#2ecc8a' }}>+${fmt(totalIncome)}</p>
            </div>
            <div className="rounded-2xl p-4" style={{ backgroundColor: '#11141c', border: '1px solid #252a3a' }}>
              <p className="label mb-1">Expenses</p>
              <p className="font-mono font-bold text-sm" style={{ color: '#ff5f6d' }}>-${fmt(totalExpenses)}</p>
            </div>
            <div className="rounded-2xl p-4" style={{ backgroundColor: '#11141c', border: '1px solid #252a3a' }}>
              <p className="label mb-1">Net</p>
              <p className="font-mono font-bold text-sm" style={{ color: net >= 0 ? '#2ecc8a' : '#ff5f6d' }}>
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
                    ? { backgroundColor: t === 'income' ? 'rgba(46,204,138,.15)' : t === 'expense' ? 'rgba(255,95,109,.15)' : '#252a3a',
                        color: t === 'income' ? '#2ecc8a' : t === 'expense' ? '#ff5f6d' : '#e8eaf2' }
                    : { backgroundColor: '#11141c', color: '#7880a0' }}>
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
                className="mt-3 text-xs font-semibold" style={{ color: '#5b8fff' }}>Add one →</button>
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
                      <p className="font-mono text-xs font-semibold" style={{ color: dayNet >= 0 ? '#2ecc8a' : '#ff5f6d' }}>
                        {dayNet >= 0 ? '+' : '-'}${fmt(Math.abs(dayNet))}
                      </p>
                    </div>
                    <div className="card overflow-hidden">
                      {dayTxs.map((tx, i) => {
                        const cat = getCategory(tx.category_id);
                        const pos = Number(tx.amount) >= 0;
                        return (
                          <div key={tx.id}
                            className={`flex items-center gap-3 px-4 py-3 group hover:bg-surface2 transition-colors ${i !== dayTxs.length - 1 ? 'border-b border-border' : ''}`}>
                            <div className="w-1.5 h-10 rounded-full shrink-0"
                              style={{ backgroundColor: cat?.color ?? (pos ? '#2ecc8a' : '#ff5f6d') }} />
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                              style={{ backgroundColor: pos ? 'rgba(46,204,138,.1)' : 'rgba(255,95,109,.1)', color: pos ? '#2ecc8a' : '#ff5f6d' }}>
                              {pos ? '↑' : '↓'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-text truncate">{tx.description || 'No note'}</p>
                              <div className="flex items-center gap-1.5 text-xs text-muted">
                                <span>{getAccountName(tx.account_id)}</span>
                                {cat && <><span>·</span><span>{cat.name}</span></>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <p className="font-mono font-semibold text-sm" style={{ color: pos ? '#2ecc8a' : '#ff5f6d' }}>
                                {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
                              </p>
                              <button onClick={() => handleDelete(tx.id)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] transition-all"
                                style={{ color: '#3e4460' }}
                                onMouseEnter={e => (e.target as HTMLElement).style.color = '#ff5f6d'}
                                onMouseLeave={e => (e.target as HTMLElement).style.color = '#3e4460'}>
                                ✕
                              </button>
                            </div>
                          </div>
                        );
                      })}
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
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #ff5f6d, #ff8e53)', boxShadow: '0 8px 32px rgba(255,95,109,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={load} defaultType={txType} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
    </>
  );
};

export default Transactions;
