import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Account, Transaction, Asset, SavingsGoal } from '../types';
import { getAccounts, getTransactions, getAssets, getSavingsGoals } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import TransferModal from '../components/modals/TransferModal';
import AddAccountModal from '../components/modals/AddAccountModal';
import WithdrawModal from '../components/modals/WithdrawModal';
import DepositModal from '../components/modals/DepositModal';
import ProgressBar from '../components/ProgressBar';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// SVG path data for account type icons
const ACCOUNT_ICON_PATHS: Record<string, { path: string; color: string }> = {
  checking:    { path: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z', color: '#6366f1' },
  savings:     { path: 'M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267zm4-4.849a3 3 0 11-6 0 3 3 0 016 0z M10 18a8 8 0 100-16 8 8 0 000 16z', color: '#10b981' },
  credit_card: { path: 'M2 5a2 2 0 012-2h12a2 2 0 012 2v2H2V5zm0 4h16v7a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm3 3a1 1 0 000 2h.01a1 1 0 000-2H5zm2 0a1 1 0 000 2h3a1 1 0 000-2H7z', color: '#f43f5e' },
  investment:  { path: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z', color: '#a855f7' },
  cash:        { path: 'M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z', color: '#f59e0b' },
};
const defaultAcctIcon = { path: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z', color: '#6366f1' };

const AccountIcon: React.FC<{ type: string }> = ({ type }) => {
  const { path, color } = ACCOUNT_ICON_PATHS[type] ?? defaultAcctIcon;
  return (
    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
      style={{ backgroundColor: color + '18' }}>
      <svg viewBox="0 0 20 20" fill={color} className="w-4 h-4">
        <path d={path} />
      </svg>
    </div>
  );
};

// Dashboard skeleton
const DashboardSkeleton: React.FC = () => (
  <div className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#070810' }}>
    <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-2"><div className="skeleton h-3 w-24" /><div className="skeleton h-6 w-40" /></div>
        <div className="skeleton h-7 w-24 rounded-full" />
      </div>
      <div className="skeleton h-36 w-full rounded-3xl" />
      <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
      <div className="grid grid-cols-3 gap-2">{[0,1,2].map(i => <div key={i} className="skeleton h-14 rounded-2xl" />)}</div>
      <div className="space-y-3">
        <div className="skeleton h-3 w-20" />
        <div className="grid grid-cols-2 gap-3">{[0,1,2,3].map(i => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
      </div>
    </div>
  </div>
);

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTx, setShowTx] = useState(false);
  const [txType, setTxType] = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [aRes, tRes, asRes, gRes] = await Promise.all([getAccounts(), getTransactions(), getAssets(), getSavingsGoals()]);
      setAccounts(Array.isArray(aRes.data) ? aRes.data : []);
      setTransactions(Array.isArray(tRes.data) ? tRes.data : []);
      setAssets(Array.isArray(asRes.data) ? asRes.data : []);
      setSavingsGoals(Array.isArray(gRes.data) ? gRes.data : []);
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

  // Last month comparison
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthTx = transactions.filter(t => t.transaction_date.startsWith(lastMonth));
  const lastMonthExpenses = lastMonthTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const expenseDiff = lastMonthExpenses > 0 ? monthExpenses - lastMonthExpenses : null;

  // Savings goals progress
  const activeGoals = savingsGoals.slice(0, 3).map(g => {
    const current = Number(g.current_amount);
    const progress = Math.min((current / Number(g.target_amount)) * 100, 100);
    return { ...g, current, progress };
  });

  const recent = transactions.slice(0, 8);

  if (loading) {
    return (
      <>
        <Navigation />
        <DashboardSkeleton />
      </>
    );
  }

  const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#070810' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* ── Greeting ── */}
          <div className="flex items-center justify-between">
            <div>
              <p className="label">{monthLabel}</p>
              <h1 className="text-xl font-bold text-text mt-0.5">Hey, {user?.username}</h1>
            </div>
            <button onClick={() => setShowAddAccount(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: '#121620', border: '1px solid #1a1f2e', color: '#666e90' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = '#6366f1'; (e.target as HTMLElement).style.borderColor = '#6366f1'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = '#666e90'; (e.target as HTMLElement).style.borderColor = '#1a1f2e'; }}>
              + Account
            </button>
          </div>

          {/* ── Net Worth Hero ── */}
          <div className="relative overflow-hidden rounded-3xl p-6"
            style={{ background: 'linear-gradient(145deg, #0d1018 0%, #121620 100%)', border: '1px solid #1a1f2e' }}>
            {/* Glow orbs */}
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-20 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
            <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full opacity-10 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #a855f7, transparent)' }} />

            <div className="relative">
              <p className="label mb-1">Net Worth</p>
              <p className="font-mono font-bold text-text mb-4" style={{ fontSize: '2.5rem', letterSpacing: '-1px' }}>
                ${fmt(netWorth)}
              </p>
              <div className="flex gap-6">
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#6366f1' }}>Accounts</p>
                  <p className="font-mono font-semibold text-sm text-text">${fmt(accountsTotal)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#a855f7' }}>Assets</p>
                  <p className="font-mono font-semibold text-sm text-text">${fmt(assetsTotal)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#10b981' }}>Spendable</p>
                  <p className="font-mono font-semibold text-sm text-text">${fmt(spendable)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Month stats ── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Income', value: `+$${fmt(monthIncome)}`, color: '#10b981', glow: 'rgba(16,185,129,.1)' },
              { label: 'Expenses', value: `-$${fmt(monthExpenses)}`, color: '#f43f5e', glow: 'rgba(244,63,94,.1)' },
              { label: 'Saved', value: `${savingsRate.toFixed(0)}%`, color: savingsRate >= 0 ? '#10b981' : '#f43f5e', glow: 'rgba(99,102,241,.1)' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4" style={{ backgroundColor: '#0d1018', border: '1px solid #1a1f2e', boxShadow: `0 0 20px ${s.glow}` }}>
                <p className="label mb-1.5">{s.label}</p>
                <p className="font-mono font-bold text-sm" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* ── Month-over-month ── */}
          {expenseDiff !== null && (
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{
                backgroundColor: expenseDiff > 0 ? 'rgba(244,63,94,.06)' : 'rgba(16,185,129,.06)',
                border: `1px solid ${expenseDiff > 0 ? 'rgba(244,63,94,.15)' : 'rgba(16,185,129,.15)'}`,
              }}>
              <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: expenseDiff > 0 ? 'rgba(244,63,94,.12)' : 'rgba(16,185,129,.12)' }}>
                <svg viewBox="0 0 20 20" fill={expenseDiff > 0 ? '#f43f5e' : '#10b981'} className="w-3.5 h-3.5">
                  {expenseDiff > 0
                    ? <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    : <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  }
                </svg>
              </div>
              <p className="text-xs" style={{ color: expenseDiff > 0 ? '#f43f5e' : '#10b981' }}>
                <span className="font-semibold">
                  {expenseDiff > 0 ? '+' : '-'}${fmt(Math.abs(expenseDiff))} spending
                </span>
                <span className="text-muted" style={{ color: '#666e90' }}>
                  {' '}vs last month
                </span>
              </p>
            </div>
          )}

          {/* ── Quick Actions ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <button onClick={() => { setTxType('expense'); setShowTx(true); }}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(244,63,94,.12)', color: '#f43f5e', border: '1px solid rgba(244,63,94,.2)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              Expense
            </button>
            <button onClick={() => { setTxType('income'); setShowTx(true); }}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(16,185,129,.12)', color: '#10b981', border: '1px solid rgba(16,185,129,.2)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
              Income
            </button>
            <button onClick={() => setShowTransfer(true)}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(99,102,241,.12)', color: '#6366f1', border: '1px solid rgba(99,102,241,.2)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" /></svg>
              Transfer
            </button>
            <button onClick={() => setShowWithdraw(true)}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(245,158,11,.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,.2)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
              Withdraw
            </button>
            <button onClick={() => setShowDeposit(true)}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95 col-span-2 sm:col-span-1"
              style={{ backgroundColor: 'rgba(16,185,129,.12)', color: '#10b981', border: '1px solid rgba(16,185,129,.2)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Deposit
            </button>
          </div>

          {/* ── Accounts preview ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Accounts</p>
              <Link to="/wallet" className="text-xs font-semibold transition-colors" style={{ color: '#6366f1' }}>View all →</Link>
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
                      <AccountIcon type={a.type} />
                      <p className="text-xs text-muted capitalize">{a.type.replace('_', ' ')}</p>
                    </div>
                    <p className="text-xs text-muted truncate mb-0.5">{a.name}</p>
                    <p className="font-mono font-bold text-lg" style={{ color: Number(a.balance) < 0 ? '#f43f5e' : '#eef0f8' }}>
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
                <Link to="/cards" className="text-xs font-semibold" style={{ color: '#6366f1' }}>Manage →</Link>
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
                        <p className="font-mono font-bold text-lg" style={{ color: '#f43f5e' }}>${fmt(owed)}</p>
                      </div>
                      {limit > 0 && (
                        <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: '#1a1f2e' }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${Math.min(used, 100)}%`, backgroundColor: used > 70 ? '#f43f5e' : used > 30 ? '#f59e0b' : '#10b981' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Savings Goals ── */}
          {activeGoals.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="label">Savings Goals</p>
                <Link to="/savings" className="text-xs font-semibold" style={{ color: '#6366f1' }}>View all →</Link>
              </div>
              <div className="space-y-2">
                {activeGoals.map(goal => (
                  <div key={goal.id} className="card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-text">{goal.name}</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-xs text-muted">${fmt(goal.current)}<span className="text-dim"> / ${fmt(Number(goal.target_amount))}</span></p>
                        <p className="font-mono text-xs font-bold" style={{ color: goal.progress >= 100 ? '#10b981' : '#6366f1' }}>
                          {goal.progress.toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    <ProgressBar value={goal.progress} colorAuto height={5} showLabel={false} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Recent Transactions ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Recent</p>
              <Link to="/transactions" className="text-xs font-semibold" style={{ color: '#6366f1' }}>View all →</Link>
            </div>
            {recent.length === 0 ? (
              <div className="card py-10 text-center">
                <p className="text-muted text-sm">No transactions yet</p>
                <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                  className="mt-3 text-xs font-semibold" style={{ color: '#6366f1' }}>
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
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: pos ? 'rgba(16,185,129,.12)' : 'rgba(244,63,94,.12)', color: pos ? '#10b981' : '#f43f5e' }}>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          {pos
                            ? <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            : <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          }
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text truncate">{tx.description || 'No note'}</p>
                        <p className="text-xs text-muted">{tx.transaction_date}</p>
                      </div>
                      <p className="font-mono font-semibold text-sm shrink-0" style={{ color: pos ? '#10b981' : '#f43f5e' }}>
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
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} onSuccess={loadAll} />
      <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} onSuccess={loadAll} />
    </>
  );
};

export default Dashboard;
