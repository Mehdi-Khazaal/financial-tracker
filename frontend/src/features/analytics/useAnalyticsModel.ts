/**
 * Assembles the whole analytics view model in one memoised pass.
 *
 * Everything on the page reads from the object this returns, which is what
 * keeps the period filter honest: there is exactly one `ResolvedPeriod` and
 * every number is derived from it. The old page recomputed a dozen totals on
 * every render and let two sections quietly ignore the filter entirely.
 */

import { useMemo, useState } from 'react';
import type {
  Account,
  Asset,
  Category,
  MonthSnapshot,
  RecurringTransaction,
  SavingsGoal,
  Transaction,
} from '../../types';
import type {
  CategoryComparison,
  ClassificationContext,
  FinancialHealth,
  Forecast,
  Insight,
  NetWorthAnalysis,
  PeriodId,
  PeriodMetrics,
  PeriodSummaryData,
  RecurringOutlook,
  ResolvedPeriod,
  SavingsMetrics,
} from './types';
import type { CashFlowData } from './types';
import { baselineDescription, baselineMonths, monthKeyOf, resolvePeriod } from './period';
import { buildClassificationContext } from './calculations/transactions';
import { calculatePeriodMetrics, monthlyMetrics, transactionsInRange } from './calculations/metrics';
import { calculateCategoryComparisons, spendingBreakdown } from './calculations/categories';
import { calculateSavingsMetrics } from './calculations/savings';
import { calculateNetWorthChange } from './calculations/netWorth';
import { buildCashFlow } from './calculations/cashflow';
import { buildRecurringOutlook } from './calculations/recurring';
import { generateDeterministicInsights } from './calculations/insights';
import { buildPeriodSummary } from './calculations/summary';
import { calculateFinancialHealth } from './calculations/health';
import { calculateForecast } from './calculations/forecast';
import { monthlyRecurringExpense } from './calculations/recurring';

export interface AnalyticsSources {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  snapshots: MonthSnapshot[];
  assets: Asset[];
}

export interface AnalyticsModel {
  period: ResolvedPeriod;
  /** Built once here; components reuse it rather than rebuilding their own. */
  ctx: ClassificationContext;
  availableMonths: string[];
  metrics: PeriodMetrics;
  previousMetrics: PeriodMetrics | null;
  categories: CategoryComparison[];
  spending: CategoryComparison[];
  savings: SavingsMetrics;
  netWorth: NetWorthAnalysis;
  cashFlow: CashFlowData;
  recurring: RecurringOutlook;
  insights: Insight[];
  summary: PeriodSummaryData;
  health: FinancialHealth;
  forecast: Forecast;
  baseline: string[];
  baselineLabel: string;
  /** Net worth as of now — sum of non-investment account balances. */
  currentNetWorth: number;
  periodTransactions: Transaction[];
}

export interface AnalyticsSelection {
  periodId: PeriodId;
  customMonth: string;
  /** Trailing months to chart for net worth. */
  netWorthWindow: number;
}

/** Stable "now" for a mounted page, so memos don't invalidate every render. */
export function useToday(): Date {
  const [today] = useState(() => new Date());
  return today;
}

export function useAnalyticsModel(
  sources: AnalyticsSources,
  selection: AnalyticsSelection,
  today: Date,
): AnalyticsModel {
  const { transactions, categories, accounts, goals, recurring, snapshots, assets } = sources;
  const { periodId, customMonth, netWorthWindow } = selection;

  const availableMonths = useMemo(() => {
    const seen = new Set<string>();
    transactions.forEach(t => seen.add(t.transaction_date.slice(0, 7)));
    return Array.from(seen).sort().reverse();
  }, [transactions]);

  const ctx = useMemo(
    () => buildClassificationContext(accounts, categories),
    [accounts, categories],
  );

  const period = useMemo(() => {
    const ascending = [...availableMonths].sort();
    return resolvePeriod(periodId, {
      today,
      customMonth,
      earliestMonth: ascending[0] ?? null,
    });
  }, [periodId, customMonth, availableMonths, today]);

  return useMemo<AnalyticsModel>(() => {
    const ascendingMonths = [...availableMonths].sort();
    const baseline = baselineMonths(period, ascendingMonths, today);

    const periodTransactions = transactionsInRange(transactions, period);
    const metrics = calculatePeriodMetrics(periodTransactions, ctx);
    const previousMetrics = period.previous
      ? calculatePeriodMetrics(transactionsInRange(transactions, period.previous), ctx)
      : null;

    const categoryRows = calculateCategoryComparisons({
      transactions,
      categories,
      period,
      baseline,
      ctx,
    });

    const savings = calculateSavingsMetrics({
      transactions,
      goals,
      period,
      baseline,
      ctx,
      today,
    });

    const netWorth = calculateNetWorthChange(snapshots, {
      transactions,
      assets,
      ctx,
      months: netWorthWindow,
    });

    const cashFlow = buildCashFlow({ transactions, recurring, period, ctx });

    const recurringOutlook = buildRecurringOutlook({
      recurring,
      transactions,
      accounts,
      categories,
      ctx,
      today,
    });

    const insights = generateDeterministicInsights({
      period,
      metrics,
      previousMetrics,
      categories: categoryRows,
      savings,
      recurring: recurringOutlook,
      netWorth,
    });

    const summary = buildPeriodSummary({
      period,
      metrics,
      previousMetrics,
      categories: categoryRows,
      savings,
      netWorth,
      recurring: recurringOutlook,
    });

    // Completed months only — the month in progress would distort both the
    // health window and the forecast baseline.
    const currentMonth = monthKeyOf(today);
    const completedMonths = ascendingMonths.filter(m => m < currentMonth);
    const monthly = monthlyMetrics(transactions, completedMonths, ctx);

    const liquidBalance = accounts
      .filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
      .reduce((s, a) => s + Number(a.balance), 0);
    const cards = accounts.filter(a => a.type === 'credit_card');
    const creditCardDebt = cards.reduce((s, a) => s + Math.max(0, -Number(a.balance)), 0);
    const creditLimit = cards.reduce((s, a) => s + (Number(a.credit_limit) || 0), 0);

    const health = calculateFinancialHealth({
      monthly,
      liquidBalance,
      creditCardDebt,
      creditLimit,
      monthlyRecurringExpense: monthlyRecurringExpense(recurring),
      hasCreditCards: cards.length > 0,
    });

    const forecast = calculateForecast({
      period,
      transactions,
      recurring,
      categories: categoryRows,
      monthly,
      ctx,
      today,
    });

    return {
      period,
      ctx,
      availableMonths,
      metrics,
      previousMetrics,
      categories: categoryRows,
      spending: spendingBreakdown(categoryRows),
      savings,
      netWorth,
      cashFlow,
      recurring: recurringOutlook,
      insights,
      summary,
      health,
      forecast,
      baseline,
      baselineLabel: baselineDescription(baseline.length),
      currentNetWorth: accounts
        .filter(a => a.type !== 'investment')
        .reduce((s, a) => s + Number(a.balance), 0),
      periodTransactions,
    };
  }, [
    availableMonths, period, today, transactions, categories, accounts, goals,
    recurring, snapshots, assets, ctx, netWorthWindow,
  ]);
}
