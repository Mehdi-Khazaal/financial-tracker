import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Account, Transaction, Asset } from '../types';
import { getAccounts, getTransactions, getAssets } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import TransferModal from '../components/modals/TransferModal';
import AddAccountModal from '../components/modals/AddAccountModal';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ACCOUNT_ICONS: Record<string, string> = {
  checking: '🏦', savings: '💰', credit_card: '💳', investment: '📈', cash: '💵',
};

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTx, setShowTx] = useState(false);
  const [txType, setTxType] = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [aRes, tRes, asRes] = await Promise.all([getAccounts(), getTransactions(), getAssets()]);
      setAccounts(aRes.data); setTransactions(tRes.data); setAssets(asRes.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // ── Derived ──────────────────────────────────────────────────────
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const nonCCAccounts = accounts.filter(a => a.type !== 'credit_card');
  const ccAccounts    = accounts.filter(a => a.type === 'credit_card');
  const accountsTotal = accounts.reduce((s, a) => s + Number(a.balance), 0);
  const assetsTotal   = assets.reduce((s, a) => s + Number(a.total_value), 0);
  const netWorth      = accountsTotal + assetsTotal;
  const spendable     = nonCCAccounts
    .filter(a => a.type === 'checking' || a.type === 'cash')
    .reduce((s, a) => s + Number(a.balance), 0);

  const monthTx       = transactions.filter(t => t.transaction_date.startsWith(thisMonth));
  const monthIncome   = monthTx.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const monthExpenses = monthTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const savingsRate   = monthIncome > 0 ? ((monthIncome - monthExpenses) / monthIncome) * 100 : 0;

  const recent = transactions.slice(0, 8);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#0b0d12' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent spin-slow" style={{ borderColor: '#5b8fff', borderTopColor: 'transparent' }} />
          <p className="text-xs text-muted font-medium">Loading…</p>
        </div>
      </div>
    );
  }

  const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#0b0d12' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* ── Greeting ── */}
          <div className="flex items-center justify-between">
            <div>
              <p className="label">{monthLabel}</p>
              <h1 className="text-xl font-bold text-text mt-0.5">Hey, {user?.username} 👋</h1>
            </div>
            <button onClick={() => setShowAddAccount(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: '#181c28', border: '1px solid #252a3a', color: '#7880a0' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = '#5b8fff'; (e.target as HTMLElement).style.borderColor = '#5b8fff'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = '#7880a0'; (e.target as HTMLElement).style.borderColor = '#252a3a'; }}>
              + Account
            </button>
          </div>

          {/* ── Net Worth Hero ── */}
          <div className="relative overflow-hidden rounded-3xl p-6"
            style={{ background: 'linear-gradient(145deg, #11141c 0%, #181c28 100%)', border: '1px solid #252a3a' }}>
            {/* Glow orbs */}
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-20 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #5b8fff, transparent)' }} />
            <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full opacity-10 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #a78bfa, transparent)' }} />

            <div className="relative">
              <p className="label mb-1">Net Worth</p>
              <p className="font-mono font-bold text-text mb-4" style={{ fontSize: '2.5rem', letterSpacing: '-1px' }}>
                ${fmt(netWorth)}
              </p>
              <div className="flex gap-6">
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#5b8fff' }}>Accounts</p>
                  <p className="font-mono font-semibold text-sm text-text">${fmt(accountsTotal)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#a78bfa' }}>Assets</p>
                  <p className="font-mono font-semibold text-sm text-text">${fmt(assetsTotal)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#2ecc8a' }}>Spendable</p>
                  <p className="font-mono font-semibold text-sm text-text">${fmt(spendable)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Month stats ── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Income', value: `+$${fmt(monthIncome)}`, color: '#2ecc8a', glow: 'rgba(46,204,138,.1)' },
              { label: 'Expenses', value: `-$${fmt(monthExpenses)}`, color: '#ff5f6d', glow: 'rgba(255,95,109,.1)' },
              { label: 'Saved', value: `${savingsRate.toFixed(0)}%`, color: savingsRate >= 0 ? '#2ecc8a' : '#ff5f6d', glow: 'rgba(91,143,255,.1)' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4" style={{ backgroundColor: '#11141c', border: '1px solid #252a3a', boxShadow: `0 0 20px ${s.glow}` }}>
                <p className="label mb-1.5">{s.label}</p>
                <p className="font-mono font-bold text-sm" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* ── Quick Actions ── */}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => { setTxType('expense'); setShowTx(true); }}
              className="flex items-center justify-center gap-1.5 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(255,95,109,.12)', color: '#ff5f6d', border: '1px solid rgba(255,95,109,.2)' }}>
              ↓ Expense
            </button>
            <button onClick={() => { setTxType('income'); setShowTx(true); }}
              className="flex items-center justify-center gap-1.5 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(46,204,138,.12)', color: '#2ecc8a', border: '1px solid rgba(46,204,138,.2)' }}>
              ↑ Income
            </button>
            <button onClick={() => setShowTransfer(true)}
              className="flex items-center justify-center gap-1.5 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(91,143,255,.12)', color: '#5b8fff', border: '1px solid rgba(91,143,255,.2)' }}>
              ⇄ Transfer
            </button>
          </div>

          {/* ── Accounts preview ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Accounts</p>
              <Link to="/wallet" className="text-xs font-semibold transition-colors" style={{ color: '#5b8fff' }}>View all →</Link>
            </div>
            {accounts.length === 0 ? (
              <button onClick={() => setShowAddAccount(true)}
                className="w-full card py-8 text-center text-muted text-sm hover:border-border2 transition-all">
                + Add your first account
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {accounts.slice(0, 4).map(a => (
                  <div key={a.id} className="card card-hover p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">{ACCOUNT_ICONS[a.type] ?? '💰'}</span>
                      <p className="text-xs text-muted capitalize">{a.type.replace('_', ' ')}</p>
                    </div>
                    <p className="text-xs text-muted truncate mb-0.5">{a.name}</p>
                    <p className="font-mono font-bold text-lg" style={{ color: Number(a.balance) < 0 ? '#ff5f6d' : '#e8eaf2' }}>
                      {Number(a.balance) < 0 ? '-' : ''}${fmt(Number(a.balance))}
                    </p>
                    {a.type === 'credit_card' && a.credit_limit && (
                      <p className="text-[10px] text-muted mt-0.5">
                        Limit: ${fmt(Number(a.credit_limit))}
                      </p>
                    )}
                  </div>
                ))}
                {accounts.length > 4 && (
                  <Link to="/wallet" className="card card-hover p-4 flex items-center justify-center text-muted text-sm hover:text-accent">
                    +{accounts.length - 4} more
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* ── Credit cards preview ── */}
          {ccAccounts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="label">Credit Cards</p>
                <Link to="/cards" className="text-xs font-semibold" style={{ color: '#5b8fff' }}>Manage →</Link>
              </div>
              <div className="space-y-3">
                {ccAccounts.slice(0, 2).map(card => {
                  const owed = Math.abs(Number(card.balance));
                  const limit = Number(card.credit_limit) || 0;
                  const used = limit > 0 ? (owed / limit) * 100 : 0;
                  return (
                    <div key={card.id} className="card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-semibold text-sm text-text">{card.name}</p>
                          {limit > 0 && <p className="text-xs text-muted mt-0.5">Limit: ${fmt(limit)}</p>}
                        </div>
                        <p className="font-mono font-bold text-lg" style={{ color: '#ff5f6d' }}>${fmt(owed)}</p>
                      </div>
                      {limit > 0 && (
                        <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: '#252a3a' }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${Math.min(used, 100)}%`, backgroundColor: used > 70 ? '#ff5f6d' : used > 30 ? '#f5a623' : '#2ecc8a' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Recent Transactions ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Recent</p>
              <Link to="/transactions" className="text-xs font-semibold" style={{ color: '#5b8fff' }}>View all →</Link>
            </div>
            {recent.length === 0 ? (
              <div className="card py-10 text-center">
                <p className="text-muted text-sm">No transactions yet</p>
                <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                  className="mt-3 text-xs font-semibold" style={{ color: '#5b8fff' }}>
                  Add one →
                </button>
              </div>
            ) : (
              <div className="card overflow-hidden">
                {recent.map((tx, i) => {
                  const pos = Number(tx.amount) >= 0;
                  return (
                    <div key={tx.id}
                      className={`flex items-center gap-3 px-4 py-3 ${i !== recent.length - 1 ? 'border-b border-border' : ''}`}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: pos ? 'rgba(46,204,138,.15)' : 'rgba(255,95,109,.15)', color: pos ? '#2ecc8a' : '#ff5f6d' }}>
                        {pos ? '↑' : '↓'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text truncate">{tx.description || 'No note'}</p>
                        <p className="text-xs text-muted">{tx.transaction_date}</p>
                      </div>
                      <p className="font-mono font-semibold text-sm shrink-0" style={{ color: pos ? '#2ecc8a' : '#ff5f6d' }}>
                        {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </main>

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={loadAll} defaultType={txType} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={loadAll} />
      <AddAccountModal isOpen={showAddAccount} onClose={() => setShowAddAccount(false)} onSuccess={loadAll} />
    </>
  );
};

export default Dashboard;
