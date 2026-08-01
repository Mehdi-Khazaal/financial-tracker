import React, { useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account, Asset, Category, MonthSnapshot, RecurringTransaction, SavingsGoal, Transaction } from '../../types';
import type { CategoryDetail, PeriodId } from './types';
import { TabContext } from '../../context/TabContext';
import { cleanDescription } from '../../utils/api';
import { downloadCSV, printPDF } from '../../utils/export';
import { monthKeyOf } from './period';
import { classifyTransaction } from './calculations/transactions';
import { buildCategoryDetail } from './calculations/categories';
import { dollars, percent } from './format';
import { useAnalyticsModel, useToday } from './useAnalyticsModel';

import AnalyticsHeader from './components/AnalyticsHeader';
import AnalyticsMetricGrid from './components/AnalyticsMetricGrid';
import PeriodSummary from './components/PeriodSummary';
import RecommendedInsights from './components/RecommendedInsights';
import SavingsOverviewCard from './components/SavingsOverviewCard';
import CashFlowCard from './components/CashFlowCard';
import CategorySpendingCard from './components/CategorySpendingCard';
import CategoryDetailDrawer from './components/CategoryDetailDrawer';
import NetWorthTrendCard from './components/NetWorthTrendCard';
import PeriodComparisonTable from './components/PeriodComparisonTable';
import RecurringBillsPreview from './components/RecurringBillsPreview';
import RecurringChargesCard from './components/RecurringChargesCard';
import RecentActivity from './components/RecentActivity';
import FinancialHealthCard from './components/FinancialHealthCard';
import ForecastCard from './components/ForecastCard';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  snapshots: MonthSnapshot[];
  assets: Asset[];
  failedSources: string[];
}

const PERIOD_STORAGE_KEY = 'ft_analytics_period';
const MONTH_STORAGE_KEY = 'ft_analytics_month';

const readStoredPeriod = (): PeriodId => {
  try {
    const stored = localStorage.getItem(PERIOD_STORAGE_KEY);
    const valid: PeriodId[] = ['this-month', 'last-3', 'last-6', 'all-time', 'custom'];
    if (stored && (valid as string[]).includes(stored)) return stored as PeriodId;
  } catch {
    /* localStorage unavailable — fall through to the default. */
  }
  return 'this-month';
};

/**
 * The Analytics tab.
 *
 * Its only jobs are period state, navigation, and layout order. Every number
 * comes from `useAnalyticsModel`, and every section is a component that
 * receives finished data — there is no arithmetic in this file, which is what
 * keeps the calculations testable without rendering a chart.
 *
 * Section order follows the questions the page is meant to answer: what
 * happened (metrics), what it means (summary, insights), what to do about it
 * (savings, cash flow, categories), and then the detail underneath.
 */
const AnalyticsTab: React.FC<Props> = ({
  transactions, categories, accounts, goals, recurring, snapshots, assets, failedSources,
}) => {
  const navigate = useNavigate();
  const { setRouteTab } = useContext(TabContext);
  const today = useToday();

  const [periodId, setPeriodId] = useState<PeriodId>(readStoredPeriod);
  const [customMonth, setCustomMonth] = useState<string>(() => {
    try {
      return localStorage.getItem(MONTH_STORAGE_KEY) ?? monthKeyOf(new Date());
    } catch {
      return monthKeyOf(new Date());
    }
  });
  const [netWorthWindow, setNetWorthWindow] = useState(12);
  const [openCategoryId, setOpenCategoryId] = useState<number | null>(null);

  const sources = useMemo(
    () => ({ transactions, categories, accounts, goals, recurring, snapshots, assets }),
    [transactions, categories, accounts, goals, recurring, snapshots, assets],
  );

  const model = useAnalyticsModel(
    sources,
    { periodId, customMonth, netWorthWindow },
    today,
  );

  // The model already builds this; rebuilding it here would be a second
  // source of truth for what counts as income.
  const { ctx } = model;

  const handlePeriodChange = useCallback((id: PeriodId) => {
    setPeriodId(id);
    try { localStorage.setItem(PERIOD_STORAGE_KEY, id); } catch { /* non-critical */ }
  }, []);

  const handleMonthChange = useCallback((month: string) => {
    setCustomMonth(month);
    try { localStorage.setItem(MONTH_STORAGE_KEY, month); } catch { /* non-critical */ }
  }, []);

  const handleNavigate = useCallback((to: string, tab?: string) => {
    navigate(to);
    if (tab) setRouteTab(to, tab);
  }, [navigate, setRouteTab]);

  const categoryDetail: CategoryDetail | null = useMemo(() => {
    if (openCategoryId == null) return null;
    const comparison = model.categories.find(c => c.id === openCategoryId);
    if (!comparison) return null;
    return buildCategoryDetail(comparison, transactions, model.period, ctx);
  }, [openCategoryId, model.categories, model.period, transactions, ctx]);

  // ── Exports ─────────────────────────────────────────────────────────────────

  const handleExportCsv = useCallback(() => {
    const categoryName = (id: number | null) =>
      id == null ? 'Uncategorized' : categories.find(c => c.id === id)?.name ?? 'Uncategorized';
    const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? '';

    downloadCSV(
      `fintrack-${model.period.months[0]}-to-${model.period.months[model.period.months.length - 1]}.csv`,
      ['Date', 'Description', 'Category', 'Account', 'Amount', 'Counted as'],
      model.periodTransactions.map(tx => [
        tx.transaction_date,
        cleanDescription(tx.description),
        categoryName(tx.category_id),
        accountName(tx.account_id),
        Number(tx.amount).toFixed(2),
        classifyTransaction(tx, ctx),
      ]),
    );
  }, [model.period, model.periodTransactions, categories, accounts, ctx]);

  const handleExportPrint = useCallback(() => {
    const rows: (string | number)[][] = [
      ['Income', dollars(model.metrics.income)],
      ['Expenses', dollars(model.metrics.expenses)],
      ['Saved', dollars(model.metrics.net)],
      ['Savings rate', model.metrics.savingsRate != null ? percent(model.metrics.savingsRate) : 'n/a'],
      ['Transactions', String(model.metrics.transactionCount)],
      ['', ''],
      ['Category', 'Spent'],
      ...model.spending.map(category => [category.name, dollars(category.current)]),
    ];
    printPDF(`Fintrack — ${model.period.label}`, ['Metric', 'Value'], rows);
  }, [model.metrics, model.spending, model.period]);

  // ── Hard failure: nothing meaningful can be computed ─────────────────────────

  if (failedSources.includes('transactions')) {
    return (
      <div className="ledger-panel p-8 text-center">
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--fg)' }}>
          Analytics needs your transactions
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Transactions could not be loaded, so none of the figures on this page can be calculated.
          Retry from the banner above.
        </p>
      </div>
    );
  }

  const categoriesFailed = failedSources.includes('categories');

  return (
    <div className="space-y-5 md:space-y-6">
      <AnalyticsHeader
        periodId={periodId}
        customMonth={customMonth}
        availableMonths={model.availableMonths}
        period={model.period}
        onPeriodChange={handlePeriodChange}
        onCustomMonthChange={handleMonthChange}
        onExportCsv={handleExportCsv}
        onExportPrint={handleExportPrint}
      />

      <AnalyticsMetricGrid
        metrics={model.metrics}
        previousMetrics={model.previousMetrics}
        savings={model.savings}
        netWorth={model.netWorth}
        currentNetWorth={model.currentNetWorth}
        period={model.period}
      />

      <PeriodSummary summary={model.summary} />

      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5 md:gap-6 items-start">
        <RecommendedInsights
          insights={model.insights}
          onOpenCategory={setOpenCategoryId}
          onNavigate={handleNavigate}
        />
        <SavingsOverviewCard
          savings={model.savings}
          period={model.period}
          onNavigate={handleNavigate}
        />
      </div>

      <CashFlowCard cashFlow={model.cashFlow} period={model.period} />

      <div className="grid lg:grid-cols-2 gap-5 md:gap-6 items-start">
        {categoriesFailed ? (
          <div className="ledger-panel p-8 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--fg)' }}>
              Categories unavailable
            </p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              The spending breakdown needs your category list, which could not be loaded.
              Totals above are unaffected.
            </p>
          </div>
        ) : (
          <CategorySpendingCard
            spending={model.spending}
            metrics={model.metrics}
            onOpenCategory={setOpenCategoryId}
            onNavigate={handleNavigate}
          />
        )}
        <NetWorthTrendCard
          netWorth={model.netWorth}
          window={netWorthWindow}
          onWindowChange={setNetWorthWindow}
        />
      </div>

      <ForecastCard forecast={model.forecast} onOpenCategory={setOpenCategoryId} />

      {!categoriesFailed && (
        <PeriodComparisonTable
          categories={model.categories}
          period={model.period}
          baselineLabel={model.baselineLabel}
          baselineCount={model.baseline.length}
          onOpenCategory={setOpenCategoryId}
        />
      )}

      <div className="grid lg:grid-cols-2 gap-5 md:gap-6 items-start">
        <RecurringBillsPreview outlook={model.recurring} onNavigate={handleNavigate} />
        <RecurringChargesCard
          subscriptions={model.recurring.subscriptions}
          onNavigate={handleNavigate}
        />
      </div>

      <RecentActivity
        transactions={model.periodTransactions}
        accounts={accounts}
        categories={categories}
        ctx={ctx}
        onNavigate={handleNavigate}
      />

      <FinancialHealthCard health={model.health} />

      <p className="text-[10px] text-center pb-2 leading-relaxed" style={{ color: 'var(--dim)' }}>
        All figures are calculated from your own transactions and account balances.
        Transfers between your accounts are excluded, refunds reduce the category they came from,
        and projections are estimates rather than guarantees.
      </p>

      <CategoryDetailDrawer
        detail={categoryDetail}
        period={model.period}
        accounts={accounts}
        ctx={ctx}
        onClose={() => setOpenCategoryId(null)}
        onNavigate={handleNavigate}
      />
    </div>
  );
};

export default AnalyticsTab;
