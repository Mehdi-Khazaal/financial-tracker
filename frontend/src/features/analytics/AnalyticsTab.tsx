import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account, Asset, BudgetProgressSummary, Category, Collection, MonthSnapshot, RecurringOverview, RecurringTransaction, SavingsGoal, Transaction } from '../../types';
import type { CategoryDetail, PeriodId } from './types';
import { TabContext } from '../../context/TabContext';
import { cleanDescription, getBudgetProgress } from '../../utils/api';
import { downloadCSV, printPDF } from '../../utils/export';
import { monthKeyOf } from './period';
import { classifyTransaction } from './calculations/transactions';
import { buildCategoryDetail } from './calculations/categories';
import { calculatePeriodMetrics, transactionsInRange } from './calculations/metrics';
import { periodCollectionSpending, receivedInCollections, spendInCollections, withoutCollections } from '../collections/calculations/periods';
import { dollars, percent } from './format';
import { useAnalyticsModel, useToday } from './useAnalyticsModel';

import AnalyticsHeader from './components/AnalyticsHeader';
import AnalyticsMetricGrid from './components/AnalyticsMetricGrid';
import PeriodSummary from './components/PeriodSummary';
import CashFlowTrendCard from './components/CashFlowTrendCard';
import StatementCard from './components/StatementCard';
import RecommendedInsights from './components/RecommendedInsights';
import CategoryDetailDrawer from './components/CategoryDetailDrawer';
import NetWorthTrendCard from './components/NetWorthTrendCard';
import RecurringBillsPreview from './components/RecurringBillsPreview';
import RecurringChargesCard from './components/RecurringChargesCard';
import KeyRatiosCard from './components/KeyRatiosCard';
import ForecastCard from './components/ForecastCard';
import BudgetProgressCard from './components/BudgetProgressCard';
import CollectionsSpendCard from './components/CollectionsSpendCard';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  recurringOverview?: RecurringOverview | null;
  snapshots: MonthSnapshot[];
  assets: Asset[];
  failedSources: string[];
  /** Category drawer to open on mount, when arriving from a deep link. */
  initialCategoryId?: number | null;
  /** This month's budget progress, loaded by the page. */
  budgets?: BudgetProgressSummary | null;
  onManageBudgets?: () => void;
  /** Trips, holidays, moves. */
  collections?: Collection[];
}

const NO_COLLECTIONS: Collection[] = [];

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
 * It reads as a report: the figures, one sentence on what they mean, then
 * numbered-down sections with the title in a left column — cash flow over a
 * year, the period as a statement, where the month is heading, what stands
 * out, net worth, what is committed, budgets, and the ratios underneath it all.
 */
const AnalyticsTab: React.FC<Props> = ({
  transactions, categories, accounts, goals, recurring, recurringOverview = null, snapshots, assets, failedSources,
  initialCategoryId = null, budgets = null, onManageBudgets, collections = NO_COLLECTIONS,
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
  // Seeded when the user arrived from a category elsewhere in the app, so the
  // drawer they asked for is already open on landing.
  const [openCategoryId, setOpenCategoryId] = useState<number | null>(initialCategoryId);

  // "Leave out collections": every figure below is computed without them.
  const [leaveOutCollections, setLeaveOutCollections] = useState(false);
  const modelTransactions = useMemo(
    () => (leaveOutCollections ? withoutCollections(transactions) : transactions),
    [leaveOutCollections, transactions],
  );

  const sources = useMemo(
    () => ({ transactions: modelTransactions, categories, accounts, goals, recurring, recurringOverview, snapshots, assets, collections }),
    [modelTransactions, categories, accounts, goals, recurring, recurringOverview, snapshots, assets, collections],
  );

  const model = useAnalyticsModel(
    sources,
    { periodId, customMonth, netWorthWindow },
    today,
  );

  // The model already builds this; rebuilding it here would be a second
  // source of truth for what counts as income.
  const { ctx } = model;

  // The collections card always reads the full ledger, so it can say what the
  // switch leaves out.
  const collectionView = useMemo(() => {
    if (collections.length === 0) return { items: [], expenses: 0, inCollections: 0, received: 0 };
    const inPeriod = transactionsInRange(transactions, model.period);
    return {
      items: periodCollectionSpending(inPeriod, collections, ctx),
      expenses: calculatePeriodMetrics(inPeriod, ctx).expenses,
      inCollections: spendInCollections(inPeriod, ctx),
      received: receivedInCollections(inPeriod, ctx),
    };
  }, [collections, transactions, model.period, ctx]);

  // Budgets are monthly, so the card follows the month picker: the current
  // month reuses the page's data, any other month is fetched on demand.
  const currentMonthKey = monthKeyOf(today);
  const budgetMonth = periodId === 'custom' && customMonth ? customMonth : currentMonthKey;
  const [otherMonthBudgets, setOtherMonthBudgets] = useState<{ month: string; summary: BudgetProgressSummary | null } | null>(null);
  useEffect(() => {
    if (budgetMonth === currentMonthKey) return;
    let cancelled = false;
    getBudgetProgress(budgetMonth)
      .then(res => { if (!cancelled) setOtherMonthBudgets({ month: budgetMonth, summary: res.data as BudgetProgressSummary }); })
      .catch(() => { if (!cancelled) setOtherMonthBudgets({ month: budgetMonth, summary: null }); });
    return () => { cancelled = true; };
  }, [budgetMonth, currentMonthKey]);
  const budgetSummary = budgetMonth === currentMonthKey
    ? (budgets ?? null)
    : otherMonthBudgets?.month === budgetMonth ? otherMonthBudgets.summary : null;
  const budgetMonthLabel = new Date(Number(budgetMonth.slice(0, 4)), Number(budgetMonth.slice(5, 7)) - 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });

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
      // Same name as the on-screen tile: this is income minus expenses, not money moved to savings.
      ['Left over', dollars(model.metrics.net)],
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
    <div className="report space-y-10 md:space-y-12">
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
        investedThisYear={model.investedThisYear}
        year={model.year}
      />

      <PeriodSummary summary={model.summary} />

      <CashFlowTrendCard trend={model.trend} periodLabel={model.period.label} />

      <StatementCard
        period={model.period}
        metrics={model.metrics}
        previousMetrics={model.previousMetrics}
        typical={model.typical}
        categories={model.categories}
        cashFlow={model.cashFlow}
        categoriesFailed={categoriesFailed}
        onOpenCategory={setOpenCategoryId}
      />

      {model.period.isIncomplete && (
        <ForecastCard forecast={model.forecast} onOpenCategory={setOpenCategoryId} />
      )}

      <RecommendedInsights
        insights={model.insights}
        onOpenCategory={setOpenCategoryId}
        onNavigate={handleNavigate}
      />

      {(collectionView.items.length > 0 || leaveOutCollections) && (
        <CollectionsSpendCard
          items={collectionView.items}
          periodExpenses={collectionView.expenses}
          inCollections={collectionView.inCollections}
          received={collectionView.received}
          periodLabel={model.period.label}
          excluded={leaveOutCollections}
          onToggle={() => setLeaveOutCollections(v => !v)}
        />
      )}

      <NetWorthTrendCard
        netWorth={model.netWorth}
        window={netWorthWindow}
        onWindowChange={setNetWorthWindow}
      />

      <RecurringBillsPreview outlook={model.recurring} onNavigate={handleNavigate} />
      <RecurringChargesCard
        subscriptions={model.recurring.subscriptions}
        onNavigate={handleNavigate}
      />

      {onManageBudgets && (
        <BudgetProgressCard
          summary={budgetSummary}
          monthLabel={budgetMonthLabel}
          today={today}
          onManage={onManageBudgets}
        />
      )}

      <KeyRatiosCard health={model.health} />

      <p className="text-xs pt-6 pb-2 leading-relaxed max-w-3xl" style={{ color: 'var(--dim)', borderTop: '1px solid var(--line)' }}>
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
