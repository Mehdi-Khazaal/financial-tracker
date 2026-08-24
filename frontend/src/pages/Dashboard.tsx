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
import AnalyticsSkeleton from '../features/analytics/components/AnalyticsSkeleton';
import OverviewTab from '../features/overview/OverviewTab';
import { useToday } from '../features/overview/useOverviewModel';
import { useDeepLinkParams } from '../hooks/useDeepLinkParams';
import { DEEP_LINK_KEYS, parseIdParam } from '../lib/deepLinks';

// Split out on its own: this subtree owns the charting library, the largest
// dependency in the app, and the dashboard opens on the Overview tab. Someone
// who never opens Analytics never downloads it.
const AnalyticsTab = React.lazy(() => import('../features/analytics/AnalyticsTab'));

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
        // Three shapes reach this helper: `fetchAllTransactions` resolves to
        // a page object with a `transactions` array, the others to an Axios
        // response with `data`, and a bare array is still accepted. Getting
        // this wrong fails quietly — an unrecognised shape lands as `[]`,
        // which renders as "no data" rather than as an error.
        const value = result.value as
          { data?: unknown; transactions?: unknown } | unknown[];
        const payload = Array.isArray(value)
          ? value
          : Array.isArray(value?.transactions)
            ? value.transactions
            : value?.data;
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
            {/* The track was `--elev-1` with an active pill of `--bg`, which made
                the selected tab *darker* than its own container and left the whole
                control almost invisible against the page. Recessed track, raised
                pill — the conventional reading, and the same two-step separation
                the mobile segmented control already uses. */}
            <div
              className="flex p-1 rounded-xl gap-0.5 max-w-xs"
              style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}
              role="tablist"
              aria-label="Dashboard views"
            >
              {(['overview', 'analytics'] as Tab[]).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  role="tab"
                  aria-selected={tab === t}
                  className="flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all"
                  style={tab === t
                    ? {
                      backgroundColor: 'var(--elev-2)',
                      color: 'var(--fg)',
                      border: '1px solid var(--line-strong)',
                      boxShadow: 'var(--edge-light), 0 1px 4px rgba(0,0,0,0.45)',
                    }
                    : { color: 'var(--muted)', border: '1px solid transparent' }}>
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
          {/* Its own boundary, not the router's: the page header and the tab
              bar must stay put while the chunk arrives. Falling back to the
              router's boundary would blank the whole dashboard and leave the
              user unable to switch back. */}
          {tab === 'analytics' && (
            <React.Suspense
              fallback={(
                <div role="status" aria-live="polite" className="py-16 text-center">
                  <span className="text-xs" style={{ color: 'var(--dim)' }}>
                    Loading analytics…
                  </span>
                </div>
              )}
            >
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
            </React.Suspense>
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
