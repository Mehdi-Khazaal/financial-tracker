import React, { useEffect, useMemo, useState } from 'react';
import { useRouteTab } from '../context/TabContext';
import { Link } from 'react-router-dom';
import { Account, Transaction, SavingsGoal, Category, MonthSnapshot, Asset, RecurringTransaction } from '../types';
import {
  fetchAllTransactions, getAccounts, getSavingsGoals, getCategories,
  getNetWorthHistory, getAssets, getRecurring,
} from '../utils/api';
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
import AnalyticsTab from '../features/analytics/AnalyticsTab';
import AnalyticsSkeleton from '../features/analytics/components/AnalyticsSkeleton';
import { buildClassificationContext } from '../features/analytics/calculations/transactions';
import { calculatePeriodMetrics } from '../features/analytics/calculations/metrics';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Tab = 'overview' | 'analytics';

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [accounts, setAccounts]               = useState<Account[]>([]);
  const [transactions, setTransactions]       = useState<Transaction[]>([]);
  const [savingsGoals, setSavingsGoals]       = useState<SavingsGoal[]>([]);
  const [categories, setCategories]           = useState<Category[]>([]);
  const [netWorthSnapshots, setNetWorthSnapshots] = useState<MonthSnapshot[]>([]);
  const [assetsList, setAssetsList]           = useState<Asset[]>([]);
  const [recurring, setRecurring]             = useState<RecurringTransaction[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [loadError, setLoadError]             = useState(false);
  const [failedSources, setFailedSources]     = useState<string[]>([]);
  const [tab, setTab]                         = useRouteTab('/');
  const [showTx, setShowTx]                   = useState(false);
  const [txType, setTxType]                   = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer]       = useState(false);
  const [showWithdraw, setShowWithdraw]       = useState(false);
  const [showDeposit, setShowDeposit]         = useState(false);

  const SOURCES = ['accounts', 'transactions', 'savings goals', 'categories', 'net worth history', 'assets', 'recurring'];

  const loadAll = async () => {
    setLoadError(false);
    setFailedSources([]);
    try {
      // Analytics averages transactions over up to twelve months, so the full
      // history is paged in rather than the API's default first 500 rows.
      // 24 months of net-worth snapshots feeds the chart's range selector.
      const results = await Promise.allSettled([
        getAccounts(), fetchAllTransactions(), getSavingsGoals(), getCategories(),
        getNetWorthHistory(24), getAssets(), getRecurring(),
      ]);
      const failed = SOURCES.filter((_, index) => results[index].status === 'rejected');
      const apply = <T,>(index: number, setter: React.Dispatch<React.SetStateAction<T[]>>) => {
        const result = results[index];
        if (result.status !== 'fulfilled') return;
        // `fetchAllTransactions` resolves to an array; the others to an Axios response.
        const value = result.value as { data?: unknown } | unknown[];
        const payload = Array.isArray(value) ? value : value?.data;
        setter(Array.isArray(payload) ? payload as T[] : []);
      };
      apply<Account>(0, setAccounts);
      apply<Transaction>(1, setTransactions);
      apply<SavingsGoal>(2, setSavingsGoals);
      apply<Category>(3, setCategories);
      apply<MonthSnapshot>(4, setNetWorthSnapshots);
      apply<Asset>(5, setAssetsList);
      apply<RecurringTransaction>(6, setRecurring);
      setFailedSources(failed);
      setLoadError(failed.length > 0);
    } catch {
      setFailedSources(SOURCES);
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

  // The same classifier the Analytics tab uses, so both tabs agree on what
  // counts as income and expense — transfers out, refunds netted, card
  // payments excluded.
  const classification = useMemo(
    () => buildClassificationContext(accounts, categories),
    [accounts, categories],
  );

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
  const monthMetrics   = useMemo(
    () => calculatePeriodMetrics(monthTx, classification),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, thisMonth, classification],
  );
  const monthIncome    = monthMetrics.income;
  const monthExpenses  = monthMetrics.expenses;
  const monthNet       = monthMetrics.net;
  const uncategorizedMonth = monthMetrics.uncategorizedCount;
  const reviewRate = monthTx.length > 0
    ? Math.round((Math.max(0, monthTx.length - uncategorizedMonth) / monthTx.length) * 100)
    : 100;
  const savingsRate = monthIncome > 0 ? Math.round((monthNet / monthIncome) * 100) : 0;

  const lastMonthDate  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth      = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthMetrics = useMemo(
    () => calculatePeriodMetrics(
      transactions.filter(t => t.transaction_date.startsWith(lastMonth)),
      classification,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, lastMonth, classification],
  );
  const lastMonthExpenses = lastMonthMetrics.expenses;
  const expenseDiff    = lastMonthExpenses > 0 ? monthExpenses - lastMonthExpenses : null;

  const topSpendCategory = useMemo(() => {
    const totals = new Map<number, number>();
    monthTx.forEach(t => {
      const amount = Number(t.amount);
      if (amount >= 0 || t.category_id == null) return;
      totals.set(t.category_id, (totals.get(t.category_id) ?? 0) + Math.abs(amount));
    });
    let best: { name: string; value: number } | null = null;
    totals.forEach((value, id) => {
      const category = categories.find(c => c.id === id);
      if (category && (!best || value > best.value)) best = { name: category.name, value };
    });
    return best as { name: string; value: number } | null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, thisMonth, categories]);

  const activeGoals    = savingsGoals.slice(0, 4).map(g => {
    const current  = Number(g.current_amount);
    const progress = Math.min((current / Number(g.target_amount)) * 100, 100);
    return { ...g, current, progress };
  });

  const netWorthTrend = netWorthSnapshots
    .slice(-12)
    .map(snap => ({
      month: new Date(snap.month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      Value: snap.net_worth ?? 0,
    }));

  const nwChange = netWorthTrend.length >= 2
    ? netWorthTrend[netWorthTrend.length - 1].Value - netWorthTrend[0].Value
    : 0;

  const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const sparkValues = netWorthTrend.map(d => d.Value);

  if (loading) {
    return (
      <AppShell>
        <PageLayout>
          {tab === 'analytics'
            ? (
              <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8">
                <AnalyticsSkeleton />
              </div>
            )
            : <DashboardSkeleton />}
        </PageLayout>
      </AppShell>
    );
  }

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
          {tab === 'analytics' && (
            <AnalyticsTab
              transactions={transactions}
              categories={categories}
              accounts={accounts}
              goals={savingsGoals}
              recurring={recurring}
              snapshots={netWorthSnapshots}
              assets={assetsList}
              failedSources={failedSources}
            />
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
