import React, { useEffect, useState } from 'react';
import { useRouteTab } from '../context/TabContext';
import { Link } from 'react-router-dom';
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Account, Transaction, SavingsGoal, Category, MonthSnapshot } from '../types';
import { getAccounts, getTransactions, getSavingsGoals, getCategories, getNetWorthHistory, cleanDescription } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import TransferModal from '../components/modals/TransferModal';
import AddAccountModal from '../components/modals/AddAccountModal';
import WithdrawModal from '../components/modals/WithdrawModal';
import DepositModal from '../components/modals/DepositModal';
import ProgressBar from '../components/ProgressBar';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ACCOUNT_ICON_COLORS: Record<string, string> = {
  checking:    'var(--accent)',
  savings:     'var(--pos)',
  credit_card: 'var(--neg)',
  investment:  '#a855f7',
  cash:        '#f59e0b',
};

const AccountIcon: React.FC<{ type: string }> = ({ type }) => {
  const color = ACCOUNT_ICON_COLORS[type] ?? 'var(--accent)';
  const initials = type.replace('_', ' ').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 font-mono text-[10px] font-bold"
      style={{ backgroundColor: 'var(--elev-sub)', color }}>
      {initials}
    </div>
  );
};

const DashboardSkeleton: React.FC = () => (
  <div className="md:ml-60 min-h-screen pb-44 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
    <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5">
      <div className="skeleton h-48 w-full rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">{[0,1,2,3,4].map(i => <div key={i} className="skeleton h-12" />)}</div>
      <div className="grid md:grid-cols-[3fr_2fr] gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">{[0,1,2,3,4,5].map(i => <div key={i} className="skeleton h-28" />)}</div>
          <div className="skeleton h-64 w-full" />
        </div>
        <div className="space-y-4">
          <div className="skeleton h-32 w-full" />
          <div className="skeleton h-48 w-full" />
        </div>
      </div>
    </div>
  </div>
);

const PERIODS = ['This month', 'Last 3 months', 'Last 6 months', 'All time'] as const;
type Period = typeof PERIODS[number];

const pct = (curr: number, prev: number) => {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
};
const fmtPct = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;

type Tab = 'overview' | 'analytics';

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [accounts, setAccounts]               = useState<Account[]>([]);
  const [transactions, setTransactions]       = useState<Transaction[]>([]);
  const [savingsGoals, setSavingsGoals]       = useState<SavingsGoal[]>([]);
  const [categories, setCategories]           = useState<Category[]>([]);
  const [netWorthSnapshots, setNetWorthSnapshots] = useState<MonthSnapshot[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [tab, setTab]                         = useRouteTab('/');
  const [period, setPeriod]                   = useState<Period>('This month');
  const [showTx, setShowTx]                   = useState(false);
  const [txType, setTxType]                   = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer]       = useState(false);
  const [showAddAccount, setShowAddAccount]   = useState(false);
  const [showWithdraw, setShowWithdraw]       = useState(false);
  const [showDeposit, setShowDeposit]         = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [aRes, tRes, gRes, catRes, nwRes] = await Promise.all([
        getAccounts(), getTransactions(), getSavingsGoals(), getCategories(), getNetWorthHistory(12),
      ]);
      setAccounts(Array.isArray(aRes.data) ? aRes.data : []);
      setTransactions(Array.isArray(tRes.data) ? tRes.data : []);
      setSavingsGoals(Array.isArray(gRes.data) ? gRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      setNetWorthSnapshots(Array.isArray(nwRes.data) ? nwRes.data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const nonCCAccounts  = accounts.filter(a => a.type !== 'credit_card');
  const ccAccounts     = accounts.filter(a => a.type === 'credit_card');
  const accountsTotal  = accounts.filter(a => a.type !== 'investment').reduce((s, a) => s + Number(a.balance), 0);
  const netWorth       = accountsTotal;
  const spendable      = nonCCAccounts
    .filter(a => a.type === 'checking' || a.type === 'cash')
    .reduce((s, a) => s + Number(a.balance), 0);

  const monthTx        = transactions.filter(t => t.transaction_date.startsWith(thisMonth));
  const monthIncome    = monthTx.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const monthExpenses  = monthTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const savingsRate    = monthIncome > 0 ? ((monthIncome - monthExpenses) / monthIncome) * 100 : 0;

  const lastMonthDate  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth      = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthTx    = transactions.filter(t => t.transaction_date.startsWith(lastMonth));
  const lastMonthExpenses = lastMonthTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const expenseDiff    = lastMonthExpenses > 0 ? monthExpenses - lastMonthExpenses : null;

  const activeGoals    = savingsGoals.slice(0, 4).map(g => {
    const current  = Number(g.current_amount);
    const progress = Math.min((current / Number(g.target_amount)) * 100, 100);
    return { ...g, current, progress };
  });

  const recent = transactions.slice(0, 15);

  // ── Analytics derived ────────────────────────────────────────────────────────
  const filterByPeriod = (txs: Transaction[]) => {
    const n = new Date();
    let from: Date;
    if (period === 'This month') {
      from = new Date(n.getFullYear(), n.getMonth(), 1);
    } else if (period === 'Last 3 months') {
      from = new Date(n.getFullYear(), n.getMonth() - 2, 1);
    } else if (period === 'Last 6 months') {
      from = new Date(n.getFullYear(), n.getMonth() - 5, 1);
    } else {
      return txs;
    }
    return txs.filter(t => new Date(t.transaction_date + 'T00:00:00') >= from);
  };

  const filtered       = filterByPeriod(transactions);
  const totalIncome    = filtered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses  = filtered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const net            = totalIncome - totalExpenses;
  const aSavingsRate   = totalIncome > 0 ? (net / totalIncome) * 100 : 0;

  const spendingByCategory = categories
    .filter(c => c.type === 'expense')
    .map(c => ({
      name: c.name,
      value: filtered.filter(t => t.category_id === c.id && Number(t.amount) < 0)
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0),
      color: c.color,
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const monthlyData = (() => {
    const months: Record<string, { income: number; expenses: number }> = {};
    filtered.forEach(t => {
      const m = t.transaction_date.substring(0, 7);
      if (!months[m]) months[m] = { income: 0, expenses: 0 };
      if (Number(t.amount) > 0) months[m].income += Number(t.amount);
      else months[m].expenses += Math.abs(Number(t.amount));
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month: new Date(month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' }),
        Income: data.income,
        Expenses: data.expenses,
      }));
  })();

  const netWorthTrend = netWorthSnapshots
    .slice(-12)
    .map(snap => ({
      month: new Date(snap.month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      Value: snap.net_worth ?? 0,
    }));

  const nwChange = netWorthTrend.length >= 2
    ? netWorthTrend[netWorthTrend.length - 1].Value - netWorthTrend[0].Value
    : 0;

  const thisMonthKey     = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastYearMonthKey = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthTxs     = transactions.filter(t => t.transaction_date.startsWith(thisMonthKey));
  const lastYearMonthTxs = transactions.filter(t => t.transaction_date.startsWith(lastYearMonthKey));
  const yoyThisIncome    = thisMonthTxs.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const yoyLastIncome    = lastYearMonthTxs.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const yoyThisExpenses  = thisMonthTxs.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const yoyLastExpenses  = lastYearMonthTxs.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const incomeChange     = pct(yoyThisIncome, yoyLastIncome);
  const expensesChange   = pct(yoyThisExpenses, yoyLastExpenses);
  const yoyMonthLabel    = now.toLocaleDateString('en-US', { month: 'long' });
  const yoyBarData = [
    { name: String(now.getFullYear() - 1), Income: yoyLastIncome, Expenses: yoyLastExpenses },
    { name: String(now.getFullYear()),      Income: yoyThisIncome,  Expenses: yoyThisExpenses },
  ];

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: 'var(--elev-sub)',
      border: '1px solid var(--line)',
      borderRadius: 12,
      fontSize: 12,
      color: 'var(--fg)',
    },
    cursor: { fill: 'oklch(72% 0.17 55 / 0.05)' },
  };

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
      <main className="md:ml-60 min-h-screen pb-44 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5 md:space-y-6 fade-in">

          {/* ── Greeting ── */}
          <div className="flex items-center justify-between pr-12 md:pr-0">
            <div>
              <p className="label mb-1">{monthLabel}</p>
              <h1 className="font-serif text-xl font-medium mt-0.5" style={{ color: 'var(--fg)', letterSpacing: '-0.02em' }}>
                Hey, {user?.username}
              </h1>
            </div>
            {tab === 'overview' && (
              <button onClick={() => setShowAddAccount(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-md transition-all"
                style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', color: 'var(--muted)' }}
                onMouseEnter={e => { (e.currentTarget.style.color = 'var(--fg)'); (e.currentTarget.style.borderColor = 'var(--line-strong)'); }}
                onMouseLeave={e => { (e.currentTarget.style.color = 'var(--muted)'); (e.currentTarget.style.borderColor = 'var(--line)'); }}>
                + Account
              </button>
            )}
          </div>

          {/* ── Desktop tab bar ── */}
          <div className="hidden md:block sticky z-20 py-2 -mx-8 px-8" style={{ top: 0, backgroundColor: 'var(--bg)' }}>
            <div className="flex p-1 rounded-xl gap-0.5 max-w-xs" style={{ backgroundColor: 'var(--elev-1)' }}>
              {(['overview', 'analytics'] as Tab[]).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all"
                  style={tab === t
                    ? { backgroundColor: 'var(--bg)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                    : { color: 'var(--muted)' }}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* ══════════════════ OVERVIEW ══════════════════ */}
          {tab === 'overview' && (
            <>
              {/* ── Hero: Net Worth + Month Stats ── */}
              <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--elev-1)' }}>
                <div className="flex flex-col md:flex-row md:items-start md:gap-12">

                  {/* Left: net worth number */}
                  <div className="flex-1 min-w-0">
                    <p className="label mb-3">Net Worth</p>
                    <p className="font-mono font-medium tabular-nums"
                      style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', letterSpacing: '-0.03em', color: 'var(--fg)' }}>
                      ${fmt(netWorth)}
                    </p>
                    <div className="flex flex-wrap gap-6 md:gap-10 mt-5 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
                      <div>
                        <p className="label mb-1">Accounts</p>
                        <p className="font-mono tabular-nums text-sm font-medium" style={{ color: 'var(--fg)' }}>${fmt(accountsTotal)}</p>
                      </div>
                      <div>
                        <p className="label mb-1">Spendable</p>
                        <p className="font-mono tabular-nums text-sm font-medium" style={{ color: 'var(--pos)' }}>${fmt(spendable)}</p>
                      </div>
                      {expenseDiff !== null && (
                        <div>
                          <p className="label mb-1">vs Last Month</p>
                          <p className="font-mono tabular-nums text-sm font-medium"
                            style={{ color: expenseDiff > 0 ? 'var(--neg)' : 'var(--pos)' }}>
                            {expenseDiff > 0 ? '+' : '−'}${fmt(Math.abs(expenseDiff))} spending
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: month stats — horizontal on mobile, vertical stack on desktop */}
                  <div className="grid grid-cols-3 md:grid-cols-1 gap-3 mt-5 md:mt-0 md:min-w-[160px]">
                    {[
                      { label: 'Income',   value: `+$${fmt(monthIncome)}`,     color: 'var(--pos)' },
                      { label: 'Expenses', value: `-$${fmt(monthExpenses)}`,    color: 'var(--neg)' },
                      { label: 'Saved',    value: `${savingsRate.toFixed(0)}%`, color: savingsRate >= 0 ? 'var(--pos)' : 'var(--neg)' },
                    ].map(s => (
                      <div key={s.label} className="rounded-lg p-3 md:p-4" style={{ backgroundColor: 'var(--elev-sub)' }}>
                        <p className="label mb-1.5">{s.label}</p>
                        <p className="font-mono tabular-nums text-sm font-semibold" style={{ color: s.color }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Quick Actions ── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {[
                  { label: 'Expense',  action: () => { setTxType('expense'); setShowTx(true); },
                    icon: <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" /> },
                  { label: 'Income',   action: () => { setTxType('income'); setShowTx(true); },
                    icon: <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" /> },
                  { label: 'Transfer', action: () => setShowTransfer(true),
                    icon: <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" /> },
                  { label: 'Withdraw', action: () => setShowWithdraw(true),
                    icon: <path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" /> },
                  { label: 'Deposit',  action: () => setShowDeposit(true),
                    icon: <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /> },
                ].map(({ label, action, icon }) => (
                  <button key={label} onClick={action}
                    className="flex items-center justify-center gap-2 py-3 rounded-md text-sm font-medium transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px solid var(--line)' }}
                    onMouseEnter={e => { (e.currentTarget.style.color = 'var(--fg)'); (e.currentTarget.style.borderColor = 'var(--line-strong)'); }}
                    onMouseLeave={e => { (e.currentTarget.style.color = 'var(--muted)'); (e.currentTarget.style.borderColor = 'var(--line)'); }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">{icon}</svg>
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Two-column grid (desktop) ── */}
              <div className="grid md:grid-cols-[3fr_2fr] gap-6 items-start">

                {/* LEFT: Accounts + Recent Transactions */}
                <div className="space-y-6">

                  {/* Accounts */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="label">Accounts</p>
                      <Link to="/accounts" className="text-xs font-medium transition-colors" style={{ color: 'var(--accent)' }}>View all →</Link>
                    </div>
                    {accounts.length === 0 ? (
                      <button onClick={() => setShowAddAccount(true)}
                        className="w-full rounded-lg py-10 text-center text-sm transition-all"
                        style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px dashed var(--line)' }}>
                        + Add your first account
                      </button>
                    ) : (
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                        {accounts.slice(0, 6).map(a => (
                          <div key={a.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
                            <div className="flex items-center gap-2 mb-3">
                              <AccountIcon type={a.type} />
                              <p className="label truncate">{a.type.replace('_', ' ')}</p>
                            </div>
                            <p className="text-xs truncate mb-1" style={{ color: 'var(--muted)' }}>{a.name}</p>
                            <p className="font-mono tabular-nums text-lg font-medium" style={{ color: Number(a.balance) < 0 ? 'var(--neg)' : 'var(--fg)' }}>
                              {Number(a.balance) < 0 ? '−' : ''}${fmt(Number(a.balance))}
                            </p>
                            {a.type === 'credit_card' && a.credit_limit && (
                              <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>Limit ${fmt(Number(a.credit_limit))}</p>
                            )}
                          </div>
                        ))}
                        {accounts.length > 6 && (
                          <Link to="/accounts"
                            className="rounded-lg p-4 flex items-center justify-center text-sm transition-colors"
                            style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                            +{accounts.length - 6} more
                          </Link>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Recent Transactions */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="label">Recent</p>
                      <Link to="/transactions" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all →</Link>
                    </div>
                    {recent.length === 0 ? (
                      <div className="rounded-lg py-10 text-center" style={{ backgroundColor: 'var(--elev-1)' }}>
                        <p className="text-sm" style={{ color: 'var(--muted)' }}>No transactions yet</p>
                        <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                          className="mt-3 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                          Add one →
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--elev-1)' }}>
                        {recent.map((tx, i) => {
                          const pos  = Number(tx.amount) >= 0;
                          const desc = cleanDescription(tx.description);
                          const initials = desc.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '??';
                          return (
                            <div key={tx.id}
                              className="flex items-center gap-3 px-4 py-3 transition-colors"
                              style={{
                                borderBottom: i !== recent.length - 1 ? '1px solid var(--line)' : 'none',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--elev-sub)')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}>
                              <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 font-mono text-[10px] font-bold"
                                style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>
                                {initials.slice(0, 2)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{desc}</p>
                                <p className="text-xs" style={{ color: 'var(--muted)' }}>{tx.transaction_date}</p>
                              </div>
                              <p className="font-mono tabular-nums text-sm shrink-0 font-medium" style={{ color: pos ? 'var(--pos)' : 'var(--neg)' }}>
                                {pos ? '+' : '−'}${fmt(Math.abs(Number(tx.amount)))}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* RIGHT: Credit Cards + Savings Goals */}
                <div className="space-y-6">

                  {/* Credit Cards */}
                  {ccAccounts.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="label">Credit Cards</p>
                        <Link to="/accounts" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Manage →</Link>
                      </div>
                      <div className="space-y-3">
                        {ccAccounts.map(card => {
                          const owed  = Math.abs(Number(card.balance));
                          const limit = Number(card.credit_limit) || 0;
                          const used  = limit > 0 ? (owed / limit) * 100 : 0;
                          return (
                            <div key={card.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
                              <div className="flex items-center justify-between mb-3">
                                <div>
                                  <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{card.name}</p>
                                  {limit > 0 && <p className="label mt-0.5">Limit ${fmt(limit)}</p>}
                                </div>
                                <p className="font-mono tabular-nums text-lg font-medium" style={{ color: 'var(--neg)' }}>${fmt(owed)}</p>
                              </div>
                              {limit > 0 && (
                                <>
                                  <div className="w-full h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--elev-sub)' }}>
                                    <div className="h-full rounded-full transition-all"
                                      style={{ width: `${Math.min(used, 100)}%`, backgroundColor: used > 70 ? 'var(--neg)' : used > 30 ? '#f59e0b' : 'var(--pos)' }} />
                                  </div>
                                  <p className="text-[10px] mt-1.5 text-right" style={{ color: 'var(--dim)' }}>{used.toFixed(0)}% used</p>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Savings Goals */}
                  {activeGoals.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="label">Savings Goals</p>
                        <Link to="/portfolio" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all →</Link>
                      </div>
                      <div className="space-y-2">
                        {activeGoals.map(goal => (
                          <div key={goal.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-medium truncate pr-4" style={{ color: 'var(--fg)' }}>{goal.name}</p>
                              <div className="flex items-center gap-2 shrink-0">
                                <p className="font-mono tabular-nums text-xs" style={{ color: 'var(--muted)' }}>
                                  ${fmt(goal.current)}<span style={{ color: 'var(--dim)' }}> / ${fmt(Number(goal.target_amount))}</span>
                                </p>
                                <p className="font-mono tabular-nums text-xs font-bold" style={{ color: goal.progress >= 100 ? 'var(--pos)' : 'var(--accent)' }}>
                                  {goal.progress.toFixed(0)}%
                                </p>
                              </div>
                            </div>
                            <ProgressBar value={goal.progress} colorAuto height={4} showLabel={false} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty right column hint */}
                  {ccAccounts.length === 0 && activeGoals.length === 0 && (
                    <div className="rounded-lg py-10 text-center hidden md:flex flex-col items-center justify-center gap-2"
                      style={{ backgroundColor: 'var(--elev-1)', border: '1px dashed var(--line)' }}>
                      <p className="text-sm" style={{ color: 'var(--muted)' }}>No cards or goals yet</p>
                      <Link to="/accounts" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Add a card →</Link>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ══════════════════ ANALYTICS ══════════════════ */}
          {tab === 'analytics' && (
            <div className="space-y-6">

              {/* Period selector */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {PERIODS.map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className="pill shrink-0 transition-all"
                    style={period === p
                      ? { backgroundColor: 'oklch(72% 0.17 55 / 0.15)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.3)' }
                      : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                    {p}
                  </button>
                ))}
              </div>

              {/* Stats row — 4 across on desktop */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Net Worth',    value: `$${fmt(netWorth)}`,                color: 'var(--fg)' },
                  { label: 'Income',       value: `+$${fmt(totalIncome)}`,            color: 'var(--pos)' },
                  { label: 'Expenses',     value: `-$${fmt(totalExpenses)}`,          color: 'var(--neg)' },
                  { label: 'Savings Rate', value: `${aSavingsRate.toFixed(1)}%`,      color: aSavingsRate >= 20 ? 'var(--pos)' : aSavingsRate >= 0 ? '#f59e0b' : 'var(--neg)' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4 md:p-5" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                    <p className="label mb-2">{s.label}</p>
                    <p className="font-mono font-bold text-sm md:text-base" style={{ color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Charts row — 2 columns on desktop */}
              <div className="grid md:grid-cols-2 gap-6">

                {/* Bar chart */}
                <div className="card p-5">
                  <p className="font-semibold text-sm mb-4" style={{ color: 'var(--fg)' }}>Income vs Expenses</p>
                  {monthlyData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={monthlyData} barCategoryGap="35%">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip {...tooltipStyle} formatter={(v: any) => `$${fmt(Number(v))}`} />
                        <Bar dataKey="Income"   fill="var(--pos)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Expenses" fill="var(--neg)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-center py-10" style={{ color: 'var(--muted)' }}>No data for this period</p>
                  )}
                  <div className="flex gap-4 mt-3">
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--pos)' }} /><span className="text-[11px]" style={{ color: 'var(--muted)' }}>Income</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--neg)' }} /><span className="text-[11px]" style={{ color: 'var(--muted)' }}>Expenses</span></div>
                  </div>
                </div>

                {/* Spending by category */}
                <div className="card p-5">
                  <p className="font-semibold text-sm mb-4" style={{ color: 'var(--fg)' }}>Spending by Category</p>
                  {spendingByCategory.length > 0 ? (
                    <div className="flex gap-4 items-center">
                      <ResponsiveContainer width={150} height={150}>
                        <PieChart>
                          <Pie data={spendingByCategory} cx="50%" cy="50%" innerRadius={42} outerRadius={66}
                            dataKey="value" paddingAngle={3}>
                            {spendingByCategory.map((e, i) => <Cell key={i} fill={e.color} />)}
                          </Pie>
                          <Tooltip
                            contentStyle={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12, color: 'var(--fg)' }}
                            formatter={(v: any) => `$${fmt(Number(v))}`}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-2 min-w-0">
                        {spendingByCategory.slice(0, 7).map((cat, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                            <p className="text-xs flex-1 truncate" style={{ color: 'var(--fg)' }}>{cat.name}</p>
                            <div className="text-right shrink-0">
                              <p className="font-mono text-xs font-semibold" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>${fmt(cat.value)}</p>
                              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{totalExpenses > 0 ? ((cat.value / totalExpenses) * 100).toFixed(0) : 0}%</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-center py-10" style={{ color: 'var(--muted)' }}>No expense data for this period</p>
                  )}
                </div>
              </div>

              {/* Net worth history — full width */}
              {netWorthTrend.length > 1 && (
                <div className="card p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>Net Worth Over Time</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>12-month history</p>
                    </div>
                    {nwChange !== 0 && (
                      <div className="text-right">
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>Change</p>
                        <p className="font-mono font-bold text-sm" style={{ color: nwChange >= 0 ? 'var(--pos)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                          {nwChange >= 0 ? '+' : '-'}${fmt(Math.abs(nwChange))}
                        </p>
                      </div>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={netWorthTrend}>
                      <defs>
                        <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip {...tooltipStyle} formatter={(v: any) => [`$${fmt(Number(v))}`, 'Net Worth']} />
                      <Line type="monotone" dataKey="Value" stroke="var(--accent)" strokeWidth={2.5}
                        dot={false} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Year-over-Year + transaction count — 2 columns */}
              {(yoyThisIncome > 0 || yoyThisExpenses > 0 || yoyLastIncome > 0 || yoyLastExpenses > 0) && (
                <div className="grid md:grid-cols-[2fr_1fr] gap-6 items-start">
                  <div className="card p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>Year over Year</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{yoyMonthLabel} this year vs last year</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      {[
                        { label: 'Income',   curr: yoyThisIncome,  change: incomeChange,   positive: true },
                        { label: 'Expenses', curr: yoyThisExpenses, change: expensesChange, positive: false },
                      ].map(({ label, curr, change, positive }) => (
                        <div key={label} className="rounded-xl p-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)' }}>
                          <p className="label mb-1">{label}</p>
                          <p className="font-mono font-bold text-sm" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>${fmt(curr)}</p>
                          {change !== null && (
                            <p className="text-xs font-semibold mt-1"
                              style={{ color: (positive ? change >= 0 : change <= 0) ? 'var(--pos)' : 'var(--neg)' }}>
                              {fmtPct(change)} vs last year
                            </p>
                          )}
                          {change === null && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>No data last year</p>}
                        </div>
                      ))}
                    </div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={yoyBarData} barCategoryGap="40%">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip {...tooltipStyle} formatter={(v: any) => `$${fmt(Number(v))}`} />
                        <Bar dataKey="Income"   fill="var(--pos)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Expenses" fill="var(--neg)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 mt-2">
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--pos)' }} /><span className="text-[11px]" style={{ color: 'var(--muted)' }}>Income</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--neg)' }} /><span className="text-[11px]" style={{ color: 'var(--muted)' }}>Expenses</span></div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="card p-5 flex items-center justify-between">
                      <p className="text-sm" style={{ color: 'var(--muted)' }}>Transactions this period</p>
                      <p className="font-mono font-bold text-lg" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{filtered.length}</p>
                    </div>
                    <div className="card p-5">
                      <p className="label mb-3">Net this period</p>
                      <p className="font-mono font-bold text-2xl" style={{ color: net >= 0 ? 'var(--pos)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                        {net >= 0 ? '+' : '-'}${fmt(Math.abs(net))}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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
