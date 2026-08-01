import React, { useEffect, useRef, useMemo, useState } from 'react';
import { useRouteTab } from '../context/TabContext';
import { Link } from 'react-router-dom';
import {
  PieChart, Pie, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Account, Transaction, SavingsGoal, Category, MonthSnapshot, Asset } from '../types';
import { getAccounts, getTransactions, getSavingsGoals, getCategories, getNetWorthHistory, getAssets } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { AppShell, PageLayout } from '../components/layout/AppShell';
import PullToRefresh from '../components/PullToRefresh';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import TransferModal from '../components/modals/TransferModal';
import WithdrawModal from '../components/modals/WithdrawModal';
import DepositModal from '../components/modals/DepositModal';
import ProgressBar from '../components/ProgressBar';
import CountUp from '../components/CountUp';
import Sparkline from '../components/Sparkline';
import { ACCOUNT_TYPE_META, AccountTypeIcon, DashboardSkeleton } from '../components/dashboard/DashboardPrimitives';
import { consumeQuickAction } from '../context/UIContext';
import LoadErrorBanner from '../components/LoadErrorBanner';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
const previousMonthKey = (ym: string) => {
  const [year, month] = ym.split('-').map(Number);
  const d = new Date(year, month - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const AVG_WINDOW_MONTHS = 12;

const PERIODS = ['This month', 'Last 3 months', 'Last 6 months', 'All time', 'Custom'] as const;
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
  const [assetsList, setAssetsList]           = useState<Asset[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [loadError, setLoadError]             = useState(false);
  const [failedSources, setFailedSources]     = useState<string[]>([]);
  const [tab, setTab]                         = useRouteTab('/');
  const [period, setPeriod]                   = useState<Period>('This month');
  const [customMonth, setCustomMonth]         = useState<string>(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const [showTx, setShowTx]                   = useState(false);
  const [txType, setTxType]                   = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer]       = useState(false);
  const [showWithdraw, setShowWithdraw]       = useState(false);
  const [showDeposit, setShowDeposit]         = useState(false);

  const loadAll = async () => {
    setLoadError(false);
    setFailedSources([]);
    try {
      const results = await Promise.allSettled([
        getAccounts(), getTransactions(), getSavingsGoals(), getCategories(), getNetWorthHistory(12), getAssets(),
      ]);
      const labels = ['accounts', 'transactions', 'savings goals', 'categories', 'net worth history', 'assets'];
      const failed = labels.filter((_, index) => results[index].status === 'rejected');
      const apply = <T,>(index: number, setter: React.Dispatch<React.SetStateAction<T[]>>) => {
        const result = results[index];
        if (result.status === 'fulfilled') setter(Array.isArray(result.value.data) ? result.value.data : []);
      };
      apply<Account>(0, setAccounts);
      apply<Transaction>(1, setTransactions);
      apply<SavingsGoal>(2, setSavingsGoals);
      apply<Category>(3, setCategories);
      apply<MonthSnapshot>(4, setNetWorthSnapshots);
      apply<Asset>(5, setAssetsList);
      setFailedSources(failed);
      setLoadError(failed.length > 0);
    } catch {
      setFailedSources(['accounts', 'transactions', 'savings goals', 'categories', 'net worth history', 'assets']);
      setLoadError(true);
    }
    finally { setLoading(false); }
  };

  const { pulling, refreshing, pullDistance } = usePullToRefresh(loadAll);

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Quick actions requested from the command palette (⌘K)
  useEffect(() => {
    const apply = () => {
      const a = consumeQuickAction();
      if (!a) return;
      if (a === 'transfer') { setShowTransfer(true); }
      else { setTxType(a); setShowTx(true); }
    };
    apply();
    window.addEventListener('ft:quick-action', apply);
    return () => window.removeEventListener('ft:quick-action', apply);
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const nonCCAccounts  = accounts.filter(a => a.type !== 'credit_card');
  const accountsTotal  = accounts.filter(a => a.type !== 'investment').reduce((s, a) => s + Number(a.balance), 0);
  const netWorth       = accountsTotal;
  const spendable      = nonCCAccounts
    .filter(a => a.type === 'checking' || a.type === 'cash')
    .reduce((s, a) => s + Number(a.balance), 0);
  const totalAssets      = assetsList
    .filter(a => a.asset_class === 'physical')
    .reduce((s, a) => s + Number(a.total_value), 0);
  const totalInvestments = assetsList
    .filter(a => a.asset_class === 'investment')
    .reduce((s, a) => s + Number(a.total_value), 0);

  const monthTx        = transactions.filter(t => t.transaction_date.startsWith(thisMonth));
  const monthIncome    = monthTx.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const monthExpenses  = monthTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const monthNet       = monthIncome - monthExpenses;
  const uncategorizedMonth = monthTx.filter(t => !t.category_id).length;
  const categorizedMonth = Math.max(0, monthTx.length - uncategorizedMonth);
  const reviewRate = monthTx.length > 0 ? Math.round((categorizedMonth / monthTx.length) * 100) : 100;
  const savingsRate = monthIncome > 0 ? Math.round((monthNet / monthIncome) * 100) : 0;

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

  // ── Analytics derived ────────────────────────────────────────────────────────
  const availableMonths = useMemo(() => {
    const s = new Set(transactions.map(t => t.transaction_date.slice(0, 7)));
    return Array.from(s).sort().reverse();
  }, [transactions]);

  useEffect(() => {
    if (!showMonthPicker) return;
    const handler = (e: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) setShowMonthPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMonthPicker]);

  const filterByPeriod = (txs: Transaction[]) => {
    const n = new Date();
    let from: Date;
    if (period === 'This month') {
      from = new Date(n.getFullYear(), n.getMonth(), 1);
    } else if (period === 'Last 3 months') {
      from = new Date(n.getFullYear(), n.getMonth() - 2, 1);
    } else if (period === 'Last 6 months') {
      from = new Date(n.getFullYear(), n.getMonth() - 5, 1);
    } else if (period === 'Custom') {
      return txs.filter(t => t.transaction_date.startsWith(customMonth));
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
      id: c.id,
      name: c.name,
      value: filtered.filter(t => t.category_id === c.id && Number(t.amount) < 0)
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0),
      color: c.color,
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const topSpendCategory = spendingByCategory[0];
  const insightMonthKey = period === 'Custom' ? customMonth : thisMonth;
  const previousInsightMonthKey = previousMonthKey(insightMonthKey);
  const insightMonthTxs = transactions.filter(t => t.transaction_date.startsWith(insightMonthKey));
  const previousInsightTxs = transactions.filter(t => t.transaction_date.startsWith(previousInsightMonthKey));
  const categoryInsights = categories
    .filter(c => c.type === 'expense')
    .map(c => {
      const current = insightMonthTxs
        .filter(t => t.category_id === c.id && Number(t.amount) < 0)
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const previous = previousInsightTxs
        .filter(t => t.category_id === c.id && Number(t.amount) < 0)
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      return { ...c, current, previous, delta: current - previous };
    })
    .filter(c => c.current > 0 || c.previous > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const movementRows = categoryInsights.filter(c => c.delta !== 0);
  const biggestIncrease = movementRows
    .filter(c => c.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0] ?? null;
  const biggestDrop = movementRows
    .filter(c => c.delta < 0)
    .sort((a, b) => a.delta - b.delta)[0] ?? null;
  const lowerSpendCount = categoryInsights.filter(c => c.delta < 0).length;
  const higherSpendCount = categoryInsights.filter(c => c.delta > 0).length;
  const improvedSpend = categoryInsights.filter(c => c.delta < 0).reduce((s, c) => s + Math.abs(c.delta), 0);
  const worsenedSpend = categoryInsights.filter(c => c.delta > 0).reduce((s, c) => s + c.delta, 0);
  const netCategoryDelta = worsenedSpend - improvedSpend;
  const previousCategorySpend = categoryInsights.reduce((s, c) => s + c.previous, 0);
  const spendChangePct = previousCategorySpend > 0 ? (netCategoryDelta / previousCategorySpend) * 100 : null;
  const movementBalance = higherSpendCount + lowerSpendCount > 0
    ? Math.round((lowerSpendCount / (higherSpendCount + lowerSpendCount)) * 100)
    : 0;

  // Baseline for "month vs average": up to 12 months of history before the selected month
  const baselineMonths = useMemo(() => {
    const months = new Set<string>();
    transactions.forEach(t => {
      const m = t.transaction_date.slice(0, 7);
      if (m < insightMonthKey) months.add(m);
    });
    return Array.from(months).sort().slice(-AVG_WINDOW_MONTHS);
  }, [transactions, insightMonthKey]);

  const monthVsAvgRows = useMemo(() => {
    if (baselineMonths.length === 0) return [];
    const baseline = new Set(baselineMonths);
    const spend = new Map<number, { current: number; previous: number; past: number }>();
    transactions.forEach(t => {
      const amount = Number(t.amount);
      if (amount >= 0 || !t.category_id) return;
      const m = t.transaction_date.slice(0, 7);
      const isCurrent = m === insightMonthKey;
      if (!isCurrent && !baseline.has(m)) return;
      const rec = spend.get(t.category_id) ?? { current: 0, previous: 0, past: 0 };
      if (isCurrent) rec.current += Math.abs(amount);
      else {
        rec.past += Math.abs(amount);
        if (m === previousInsightMonthKey) rec.previous += Math.abs(amount);
      }
      spend.set(t.category_id, rec);
    });
    return categories
      .filter(c => c.type === 'expense')
      .map(c => {
        const rec = spend.get(c.id) ?? { current: 0, previous: 0, past: 0 };
        const average = rec.past / baselineMonths.length;
        return {
          id: c.id, name: c.name, color: c.color,
          current: rec.current, previous: rec.previous, average,
          delta: rec.current - average,
        };
      })
      .filter(r => (r.current > 0 || r.previous > 0 || r.average > 0) && Math.abs(r.delta) >= 0.01)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 8);
  }, [transactions, categories, insightMonthKey, previousInsightMonthKey, baselineMonths]);

  const monthVsAvgScale = Math.max(...monthVsAvgRows.map(r => Math.max(r.current, r.previous, r.average)), 1);
  const monthVsAvgCurrentTotal = monthVsAvgRows.reduce((s, r) => s + r.current, 0);
  const monthVsAvgPreviousTotal = monthVsAvgRows.reduce((s, r) => s + r.previous, 0);
  const monthVsAvgAverageTotal = monthVsAvgRows.reduce((s, r) => s + r.average, 0);
  const monthVsAvgTotalDelta = monthVsAvgCurrentTotal - monthVsAvgAverageTotal;

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
    wrapperStyle: { zIndex: 80, pointerEvents: 'none' as const },
    allowEscapeViewBox: { x: true, y: true },
  };

  if (loading) {
    return (
      <AppShell>
        <PageLayout>
          <DashboardSkeleton />
        </PageLayout>
      </AppShell>
    );
  }

  const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const sparkValues = netWorthTrend.map(d => d.Value);

  return (
    <AppShell>
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <PageLayout>
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5 md:space-y-6 stagger-in">

          {/* ── Greeting ── */}
          <div className="product-page-header topbar-safe">
            <div>
              <p className="label mb-1">{monthLabel}</p>
              <h1 className="product-page-title mt-0.5">
                {greeting}, {user?.username}
              </h1>
            </div>
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
          {loadError && <LoadErrorBanner message={`Some data could not be refreshed: ${failedSources.join(', ')}. Available sections are still shown.`} onRetry={() => void loadAll()} />}

          {tab === 'overview' && !failedSources.some(source => source === 'accounts' || source === 'transactions') && (
            <>
              {/* ── Hero: Net Worth + Month Stats ── */}
              <div className="hero-card rounded-xl p-6 md:p-8"
                style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', boxShadow: 'var(--edge-light), var(--shadow-card)' }}>
                <div className="relative flex flex-col md:flex-row md:items-start md:gap-12" style={{ zIndex: 1 }}>

                  {/* Left: net worth number + 12-month trajectory */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <p className="label">Net Worth</p>
                      {nwChange !== 0 && netWorthTrend.length > 1 && (
                        <span className="font-mono tabular-nums text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            color: nwChange >= 0 ? 'var(--pos)' : 'var(--neg)',
                            backgroundColor: nwChange >= 0 ? 'var(--pos-dim)' : 'var(--neg-dim)',
                          }}>
                          {nwChange >= 0 ? '↑' : '↓'} ${fmt(Math.abs(nwChange))} / 12mo
                        </span>
                      )}
                    </div>
                    <p className="value-display" style={{ fontSize: 'clamp(2.25rem, 5vw, 4rem)' }}>
                      $<CountUp value={netWorth} duration={1100} />
                    </p>

                    {sparkValues.length > 1 && (
                      <div className="blurrable mt-5 -mx-1" style={{ height: 52 }}>
                        <Sparkline data={sparkValues} height={52} color="#F97316" />
                      </div>
                    )}

                    <div className="flex flex-wrap gap-8 md:gap-12 mt-5 pt-5" style={{ borderTop: '1px solid var(--line)' }}>
                      <div>
                        <p className="label mb-1.5">Spendable</p>
                        <p className="font-mono tabular-nums text-sm font-medium" style={{ color: 'var(--pos)' }}>${fmt(spendable)}</p>
                      </div>
                      {expenseDiff !== null && (
                        <div>
                          <p className="label mb-1.5">vs Last Month</p>
                          <p className="font-mono tabular-nums text-sm font-medium"
                            style={{ color: expenseDiff > 0 ? 'var(--neg)' : 'var(--pos)' }}>
                            {expenseDiff > 0 ? '+' : '−'}${fmt(Math.abs(expenseDiff))} spending
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: 2×2 stat grid */}
                  <div className="grid grid-cols-2 gap-2.5 mt-5 md:mt-0 md:min-w-[280px]">
                    {[
                      { label: 'Income',      value: `+$${fmt(monthIncome)}`,     color: 'var(--pos)',  dot: '#22C55E' },
                      { label: 'Expenses',    value: `-$${fmt(monthExpenses)}`,   color: 'var(--neg)',  dot: '#EF4444' },
                      ...(failedSources.includes('assets') ? [] : [
                        { label: 'Assets', value: `$${fmt(totalAssets)}`, color: 'var(--fg)', dot: 'rgba(241,241,243,0.45)' },
                        { label: 'Investments', value: `$${fmt(totalInvestments)}`, color: '#a855f7', dot: '#a855f7' },
                      ]),
                    ].map(s => (
                      <div key={s.label} className="rounded-lg"
                        style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', boxShadow: 'var(--edge-light)', padding: '10px 12px' }}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: s.dot, boxShadow: `0 0 5px ${s.dot}` }} />
                          <p className="label">{s.label}</p>
                        </div>
                        <p className="font-mono tabular-nums text-sm font-semibold" style={{ color: s.color }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Quick Actions ── */}
              <div className="ledger-panel p-3 md:p-4">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <Link to="/transactions" className="flex-1 min-w-0 rounded-lg px-4 py-3 transition-colors"
                    style={{ backgroundColor: uncategorizedMonth > 0 ? 'oklch(72% 0.17 55 / 0.12)' : 'var(--elev-sub)', border: '1px solid var(--line)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="label mb-1">Imported Transaction Review</p>
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>
                          {uncategorizedMonth > 0 ? `${uncategorizedMonth} transactions need categories` : 'All imports categorized'}
                        </p>
                      </div>
                      <span className="font-mono text-xs font-bold shrink-0" style={{ color: uncategorizedMonth > 0 ? 'var(--accent)' : 'var(--pos)' }}>
                        {reviewRate}%
                      </span>
                    </div>
                    <div className="review-meter mt-3"><span style={{ width: `${reviewRate}%` }} /></div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--dim)' }}>
                      <span>Savings {savingsRate}%</span>
                      <span className="truncate">Top {failedSources.includes('categories') ? 'unavailable' : topSpendCategory ? topSpendCategory.name : 'None'}</span>
                    </div>
                  </Link>
                  <div className="grid grid-cols-3 gap-2 md:w-[360px]">
                    {[
                      { label: 'Transfer', action: () => setShowTransfer(true) },
                      { label: 'Withdraw', action: () => setShowWithdraw(true) },
                      { label: 'Deposit', action: () => setShowDeposit(true) },
                    ].map(item => (
                      <button key={item.label} onClick={item.action} className="qa-btn min-h-11 text-xs">
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="hidden">
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
                  <button key={label} onClick={action} className="qa-btn">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">{icon}</svg>
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Two-column grid (desktop) ── */}
              <div className="grid md:grid-cols-[3fr_2fr] gap-6 items-start">

                {/* LEFT: Accounts */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="label">Accounts</p>
                    <Link to="/accounts" className="text-xs font-medium transition-colors" style={{ color: 'var(--accent)' }}>View all →</Link>
                  </div>
                  {accounts.length === 0 ? (
                    <Link to="/accounts"
                      className="block w-full rounded-lg py-10 text-center text-sm transition-all"
                      style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px dashed var(--line)' }}>
                      Add accounts in Wallet
                    </Link>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-2 md:gap-3">
                      {accounts.slice(0, 6).map(a => {
                        const meta = ACCOUNT_TYPE_META[a.type] ?? ACCOUNT_TYPE_META.checking;
                        return (
                        <div key={a.id} className="rounded-lg p-3 md:p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
                          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-3">
                            <AccountTypeIcon type={a.type} />
                            <p className="label truncate text-[10px] md:text-xs">{meta.label}</p>
                          </div>
                          <p className="text-xs truncate mb-0.5 md:mb-1" style={{ color: 'var(--muted)' }}>{a.name}</p>
                          <p className="font-mono tabular-nums text-base md:text-lg font-medium leading-tight" style={{ color: Number(a.balance) < 0 ? 'var(--neg)' : 'var(--fg)' }}>
                            {Number(a.balance) < 0 ? '−' : ''}${fmt(Number(a.balance))}
                          </p>
                          {a.type === 'credit_card' && a.credit_limit && (
                            <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>Limit ${fmt(Number(a.credit_limit))}</p>
                          )}
                        </div>
                      );})}
                      {accounts.length > 6 && (
                        <Link to="/accounts"
                          className="rounded-lg p-3 md:p-4 flex items-center justify-center text-sm transition-colors"
                          style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                          +{accounts.length - 6} more
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                {/* RIGHT: Savings Goals */}
                <div className="space-y-6">

                  {/* Savings Goals */}
                  {!failedSources.includes('savings goals') && activeGoals.length > 0 && (
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
                  {!failedSources.includes('savings goals') && activeGoals.length === 0 && (
                    <div className="rounded-lg py-10 text-center hidden md:flex flex-col items-center justify-center gap-2"
                      style={{ backgroundColor: 'var(--elev-1)', border: '1px dashed var(--line)' }}>
                      <p className="text-sm" style={{ color: 'var(--muted)' }}>No savings goals yet</p>
                      <Link to="/portfolio" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Add a goal →</Link>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ══════════════════ ANALYTICS ══════════════════ */}
          {tab === 'analytics' && !failedSources.some(source => source === 'transactions' || source === 'categories') && (
            <div className="space-y-6">

              {/* Period selector */}
              <div className="space-y-2">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {PERIODS.map(p => (
                    <button key={p} onClick={() => setPeriod(p)}
                      className="pill min-h-[44px] shrink-0 transition-all"
                      style={period === p
                        ? { backgroundColor: 'oklch(72% 0.17 55 / 0.15)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.3)' }
                        : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                      {p === 'Custom' && period === 'Custom'
                        ? new Date(customMonth + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                        : p}
                    </button>
                  ))}
                </div>
                {period === 'Custom' && (
                  <div ref={monthPickerRef} className="relative inline-block">
                    <button
                      onClick={() => setShowMonthPicker(v => !v)}
                      className="header-action text-sm"
                      aria-haspopup="listbox" aria-expanded={showMonthPicker}
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M13.25 3v2.25M3 8.25h14M5.25 3.75h9.5A2.25 2.25 0 0117 6v10.5A2.25 2.25 0 0114.75 18.75H5.25A2.25 2.25 0 013 16.5V6A2.25 2.25 0 015.25 3.75z" />
                      </svg>
                      <span>{formatMonth(customMonth)}</span>
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0" style={{ color: 'var(--dim)', transform: showMonthPicker ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    {showMonthPicker && availableMonths.length > 0 && (
                      <div className="menu-surface absolute top-full left-0 mt-1.5 min-w-[170px] py-1" role="listbox" aria-label="Analytics month">
                        {availableMonths.map(m => (
                          <button key={m}
                            onClick={() => { setCustomMonth(m); setShowMonthPicker(false); }}
                            className="menu-item justify-between text-sm font-medium"
                            role="option" aria-selected={m === customMonth}
                            style={m === customMonth
                              ? { backgroundColor: 'oklch(72% 0.17 55 / 0.12)', color: 'var(--accent)' }
                              : { color: 'var(--fg)' }}
                          >
                            {formatMonth(m)}
                            {m === customMonth && (
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
              </div>

              {/* Stats row — 4 across on desktop */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Net Worth',    value: `$${fmt(netWorth)}`,           color: 'var(--fg)',  topBorder: 'rgba(241,241,243,0.25)' },
                  { label: 'Income',       value: `+$${fmt(totalIncome)}`,       color: 'var(--pos)', topBorder: '#22C55E' },
                  { label: 'Expenses',     value: `-$${fmt(totalExpenses)}`,     color: 'var(--neg)', topBorder: '#EF4444' },
                  { label: 'Savings Rate', value: `${aSavingsRate.toFixed(1)}%`, color: aSavingsRate >= 20 ? 'var(--pos)' : aSavingsRate >= 0 ? '#f59e0b' : 'var(--neg)', topBorder: '#f59e0b' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4 md:p-5"
                    style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', borderTop: `2px solid ${s.topBorder}` }}>
                    <p className="label mb-2">{s.label}</p>
                    <p className="font-mono font-bold text-sm md:text-base" style={{ color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Charts row — 2 columns on desktop */}
              <div className="ledger-panel p-4 md:p-5 overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-5">
                  <div>
                    <p className="label mb-1">What changed</p>
                    <p className="text-base font-semibold" style={{ color: 'var(--fg)' }}>
                      {formatMonth(insightMonthKey)} vs {formatMonth(previousInsightMonthKey)}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                      Category spend is {netCategoryDelta <= 0 ? 'lower' : 'higher'} by{' '}
                      <span className="font-mono" style={{ color: netCategoryDelta <= 0 ? 'var(--pos)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                        ${fmt(Math.abs(netCategoryDelta))}
                      </span>
                      {spendChangePct !== null && (
                        <span> ({spendChangePct >= 0 ? '+' : ''}{spendChangePct.toFixed(1)}%)</span>
                      )}
                    </p>
                  </div>
                  <div className="font-mono text-[10px] px-2.5 py-1 rounded-full self-start"
                    style={{
                      color: netCategoryDelta <= 0 ? 'var(--pos)' : 'var(--neg)',
                      backgroundColor: netCategoryDelta <= 0 ? 'var(--pos-dim)' : 'var(--neg-dim)',
                    }}>
                    {netCategoryDelta <= 0 ? 'spending improved' : 'needs attention'}
                  </div>
                </div>
                <div className="grid lg:grid-cols-[1.15fr_1fr] gap-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[
                      { label: 'Biggest increase', item: biggestIncrease, empty: 'No category increased', tone: 'var(--neg)' },
                      { label: 'Biggest drop', item: biggestDrop, empty: 'No category decreased', tone: 'var(--pos)' },
                    ].map(card => (
                      <div key={card.label} className="ledger-cell p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <p className="label">{card.label}</p>
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: card.item?.color ?? 'var(--dim)' }} />
                        </div>
                        {card.item ? (
                          <>
                            <p className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>{card.item.name}</p>
                            <div className="flex items-end justify-between gap-3 mt-2">
                              <p className="font-mono text-xl font-bold" style={{ color: card.tone, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                                {card.item.delta > 0 ? '+' : '-'}${fmt(Math.abs(card.item.delta))}
                              </p>
                              <p className="text-[10px] text-right" style={{ color: 'var(--muted)' }}>
                                was ${fmt(card.item.previous)}<br />now ${fmt(card.item.current)}
                              </p>
                            </div>
                          </>
                        ) : (
                          <p className="text-sm" style={{ color: 'var(--muted)' }}>{card.empty}</p>
                        )}
                      </div>
                    ))}
                    <div className="ledger-cell p-4 sm:col-span-2">
                      <div className="flex items-center justify-between gap-4 mb-3">
                        <div>
                          <p className="label mb-1">Category balance</p>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>{lowerSpendCount} improved, {higherSpendCount} higher</p>
                        </div>
                        <p className="font-mono text-lg font-bold" style={{ color: movementBalance >= 60 ? 'var(--pos)' : movementBalance >= 40 ? 'var(--accent)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                          {movementBalance}%
                        </p>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--line)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${movementBalance}%`,
                            backgroundColor: movementBalance >= 60 ? 'var(--pos)' : movementBalance >= 40 ? 'var(--accent)' : 'var(--neg)',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="ledger-cell p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <p className="label">Movement detail</p>
                      <p className="font-mono text-[10px]" style={{ color: 'var(--muted)' }}>{movementRows.length} changed</p>
                    </div>
                    {movementRows.length > 0 ? (
                      <div className="space-y-2.5">
                        {movementRows.slice(0, 5).map(item => {
                          const isUp = item.delta > 0;
                          const maxMove = Math.max(...movementRows.map(c => Math.abs(c.delta)), 1);
                          return (
                            <div key={item.id} className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                <p className="text-xs font-medium truncate flex-1" style={{ color: 'var(--fg)' }}>{item.name}</p>
                                <p className="font-mono text-xs font-semibold shrink-0" style={{ color: isUp ? 'var(--neg)' : 'var(--pos)', fontVariantNumeric: 'tabular-nums' }}>
                                  {isUp ? '+' : '-'}${fmt(Math.abs(item.delta))}
                                </p>
                              </div>
                              <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--line)' }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.max(6, (Math.abs(item.delta) / maxMove) * 100)}%`,
                                    backgroundColor: isUp ? 'var(--neg)' : 'var(--pos)',
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm" style={{ color: 'var(--muted)' }}>No category changes to compare yet</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Month vs average spending by category */}
              <div className="ledger-panel p-4 md:p-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                  <div>
                    <p className="label mb-1">Month vs average</p>
                    <p className="text-base font-semibold" style={{ color: 'var(--fg)' }}>
                      {formatMonth(insightMonthKey)} against your usual month
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                      {baselineMonths.length > 0
                        ? `Average across the ${baselineMonths.length} month${baselineMonths.length === 1 ? '' : 's'} before it`
                        : 'No earlier months to average yet'}
                    </p>
                  </div>
                  {monthVsAvgRows.length > 0 && (
                    <div className="font-mono text-[10px] px-2.5 py-1 rounded-full self-start tabular-nums"
                      style={{
                        color: monthVsAvgTotalDelta <= 0 ? 'var(--pos)' : 'var(--neg)',
                        backgroundColor: monthVsAvgTotalDelta <= 0 ? 'var(--pos-dim)' : 'var(--neg-dim)',
                      }}>
                      {monthVsAvgTotalDelta <= 0 ? '−' : '+'}${fmt(Math.abs(monthVsAvgTotalDelta))} vs average
                    </div>
                  )}
                </div>

                {monthVsAvgRows.length > 0 ? (
                  <div className="overflow-x-auto -mx-1 px-1">
                    <table className="w-full min-w-[420px] border-collapse">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)' }}>
                          <th className="label text-left font-normal pb-2">Category</th>
                          <th className="label text-right font-normal pb-2 pl-3">{formatMonth(insightMonthKey)}</th>
                          <th className="label text-right font-normal pb-2 pl-3">{formatMonth(previousInsightMonthKey)}</th>
                          <th className="label text-right font-normal pb-2 pl-3">Avg / mo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthVsAvgRows.map(row => {
                          const isUp = row.delta > 0;
                          const currentPct = Math.min((row.current / monthVsAvgScale) * 100, 100);
                          const averagePct = Math.min((row.average / monthVsAvgScale) * 100, 100);
                          return (
                            <tr key={row.id} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td className="py-2.5 pr-3 align-middle" style={{ minWidth: 132 }}>
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                                  <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>{row.name}</p>
                                </div>
                                <div className="relative h-1 mt-1.5 ml-4 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--line)' }}>
                                  <div className="h-full rounded-full" style={{ width: `${currentPct}%`, backgroundColor: row.color }} />
                                  <span className="absolute top-0 h-full"
                                    style={{ left: `${averagePct}%`, width: 2, backgroundColor: 'var(--muted)', transform: 'translateX(-1px)' }}
                                    aria-hidden="true" />
                                </div>
                              </td>
                              <td className="py-2.5 pl-3 text-right align-middle">
                                <p className="font-mono text-xs font-semibold" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                                  ${fmt(row.current)}
                                </p>
                                <p className="font-mono text-[10px] mt-0.5" style={{ color: isUp ? 'var(--neg)' : 'var(--pos)', fontVariantNumeric: 'tabular-nums' }}>
                                  {isUp ? '+' : '−'}${fmt(Math.abs(row.delta))}
                                  {row.average > 0 && ` (${isUp ? '+' : '−'}${Math.abs((row.delta / row.average) * 100).toFixed(0)}%)`}
                                </p>
                              </td>
                              <td className="py-2.5 pl-3 text-right align-middle">
                                <p className="font-mono text-xs" style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                                  ${fmt(row.previous)}
                                </p>
                              </td>
                              <td className="py-2.5 pl-3 text-right align-middle">
                                <p className="font-mono text-xs" style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                                  ${fmt(row.average)}
                                </p>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td className="pt-2.5">
                            <p className="label">Total shown</p>
                          </td>
                          <td className="pt-2.5 pl-3 text-right">
                            <p className="font-mono text-xs font-bold" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>${fmt(monthVsAvgCurrentTotal)}</p>
                          </td>
                          <td className="pt-2.5 pl-3 text-right">
                            <p className="font-mono text-xs font-bold" style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>${fmt(monthVsAvgPreviousTotal)}</p>
                          </td>
                          <td className="pt-2.5 pl-3 text-right">
                            <p className="font-mono text-xs font-bold" style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>${fmt(monthVsAvgAverageTotal)}</p>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    <p className="text-[10px] mt-3" style={{ color: 'var(--dim)' }}>
                      Bar shows {formatMonth(insightMonthKey)}; the tick marks the monthly average.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm py-6 text-center" style={{ color: 'var(--muted)' }}>
                    {baselineMonths.length === 0
                      ? 'Not enough history yet — come back after another month of transactions.'
                      : 'No category is meaningfully off its average this month.'}
                  </p>
                )}
              </div>

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
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>Spending by Category</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{spendingByCategory.length} active categories</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="label mb-0.5">Total</p>
                      <p className="font-mono text-sm font-bold" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>${fmt(totalExpenses)}</p>
                    </div>
                  </div>
                  {spendingByCategory.length > 0 ? (
                    <div className="grid gap-5 sm:grid-cols-[176px_1fr] items-center">
                      <div className="relative shrink-0 mx-auto" style={{ width: 176, height: 176 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={spendingByCategory} cx="50%" cy="50%" innerRadius={56} outerRadius={78}
                              dataKey="value" paddingAngle={2} cornerRadius={5}>
                              {spendingByCategory.map((e, i) => (
                                <Cell key={i} fill={e.color} stroke="transparent" strokeWidth={0} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12, color: 'var(--fg)' }}
                              wrapperStyle={{ zIndex: 80, pointerEvents: 'none' }}
                              allowEscapeViewBox={{ x: true, y: true }}
                              formatter={(v: any) => `$${fmt(Number(v))}`}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 2 }}>largest</p>
                          <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--fg)', textAlign: 'center', lineHeight: 1.15, maxWidth: 68 }}>{spendingByCategory[0].name.slice(0, 12)}</p>
                          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: spendingByCategory[0].color, fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>
                            {totalExpenses > 0 ? ((spendingByCategory[0].value / totalExpenses) * 100).toFixed(0) : 0}%
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2.5 min-w-0">
                        {spendingByCategory.slice(0, 7).map((cat, i) => (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] shrink-0" style={{ color: 'var(--dim)', width: 16 }}>{String(i + 1).padStart(2, '0')}</span>
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                              <p className="text-xs flex-1 truncate" style={{ color: 'var(--fg)' }}>{cat.name}</p>
                              <p className="font-mono text-xs font-semibold shrink-0" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>${fmt(cat.value)}</p>
                              <p className="text-[10px] text-right shrink-0" style={{ color: 'var(--muted)', width: 30 }}>{totalExpenses > 0 ? ((cat.value / totalExpenses) * 100).toFixed(0) : 0}%</p>
                            </div>
                            <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--line)' }}>
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${totalExpenses > 0 ? Math.min((cat.value / totalExpenses) * 100, 100) : 0}%`,
                                  backgroundColor: cat.color,
                                }}
                              />
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
                    <AreaChart data={netWorthTrend}>
                      <defs>
                        <linearGradient id="nwGradDash" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#F97316" stopOpacity={0.22} />
                          <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip {...tooltipStyle} formatter={(v: any) => [`$${fmt(Number(v))}`, 'Net Worth']} />
                      <Area type="monotone" dataKey="Value" stroke="#F97316" strokeWidth={2}
                        fill="url(#nwGradDash)" dot={false}
                        activeDot={{ r: 4, fill: '#F97316', stroke: 'var(--bg)', strokeWidth: 2 }} />
                    </AreaChart>
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
      </PageLayout>

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={loadAll} defaultType={txType} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={loadAll} />
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} onSuccess={loadAll} />
      <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} onSuccess={loadAll} />
    </AppShell>
  );
};

export default Dashboard;
