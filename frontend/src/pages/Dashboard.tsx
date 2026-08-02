import React, { useEffect, useState } from 'react';
import { useRouteTab } from '../context/TabContext';
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
import { DashboardSkeleton } from '../components/dashboard/DashboardPrimitives';
import { consumeQuickAction } from '../context/UIContext';
import LoadErrorBanner from '../components/LoadErrorBanner';
import AnalyticsTab from '../features/analytics/AnalyticsTab';
import AnalyticsSkeleton from '../features/analytics/components/AnalyticsSkeleton';
import OverviewTab from '../features/overview/OverviewTab';
import { useToday } from '../features/overview/useOverviewModel';
import { useDeepLinkParams } from '../hooks/useDeepLinkParams';
import { DEEP_LINK_KEYS, parseIdParam } from '../lib/deepLinks';

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
  const [initialCategoryId, setInitialCategoryId] = useState<number | null>(null);

  const today = useToday();

  // Arriving from a category elsewhere in the app: open Analytics with that
  // category's drawer already showing, rather than the top of the page.
  useDeepLinkParams(params => {
    if (params.get(DEEP_LINK_KEYS.tab) === 'analytics') setTab('analytics');
    else if (params.get(DEEP_LINK_KEYS.tab) === 'overview') setTab('overview');
    setInitialCategoryId(parseIdParam(params.get(DEEP_LINK_KEYS.category)));
  });

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

  // Quick actions requested from the command palette (⌘K). The Transfer modal
  // has no button on this page any more — Fintrack imports activity rather than
  // having it typed in — but the palette command still routes here, so it stays
  // mounted and reachable.
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

  const monthLabel = today.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // Overview leans on accounts and transactions for every number it prints.
  // Without them there is nothing honest to render, so the banner stands alone.
  const overviewUnavailable = failedSources.includes('accounts') || failedSources.includes('transactions');

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

          {loadError && (
            <LoadErrorBanner
              message={`Some data could not be refreshed: ${failedSources.join(', ')}. Available sections are still shown.`}
              onRetry={() => void loadAll()}
            />
          )}

          {/* ══════════════════ OVERVIEW ══════════════════ */}
          {tab === 'overview' && !overviewUnavailable && (
            <OverviewTab
              accounts={accounts}
              transactions={transactions}
              categories={categories}
              goals={savingsGoals}
              recurring={recurring}
              snapshots={netWorthSnapshots}
              assets={assetsList}
              failedSources={failedSources}
              today={today}
            />
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
              initialCategoryId={initialCategoryId}
            />
          )}

          {/* Clears the mobile context tabs and dock on the last card. */}
          <div className="h-2 md:hidden" aria-hidden="true" />
        </div>
      </PageLayout>

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={loadAll} defaultType={txType} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={loadAll} />
    </AppShell>
  );
};

export default Dashboard;
