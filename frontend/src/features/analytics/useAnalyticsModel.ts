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
  Collection,
  MonthSnapshot,
  RecurringOverview,
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
  TrendMonth,
  TypicalPeriod,
} from './types';
import type { CashFlowData } from './types';
import { baselineDescription, baselineMonths, monthKeyOf, resolvePeriod } from './period';
import { buildClassificationContext } from './calculations/transactions';
import {
  calculatePeriodMetrics, investedInYear, monthlyMetrics, transactionsInRange,
} from './calculations/metrics';
import { calculateCategoryComparisons, spendingBreakdown } from './calculations/categories';
import { calculateSavingsMetrics } from './calculations/savings';
import { calculateNetWorthChange } from './calculations/netWorth';
import { buildCashFlow } from './calculations/cashflow';
import { buildRecurringOutlook } from './calculations/recurring';
import { monthFromOverview } from '../recurring/calculations';
import { generateDeterministicInsights } from './calculations/insights';
import { periodCollectionSpending } from '../collections/calculations/periods';
import { buildPeriodSummary } from './calculations/summary';
import { calculateFinancialHealth } from './calculations/health';
import { calculateForecast } from './calculations/forecast';
import { monthlyRecurringExpense } from './calculations/recurring';
import {
  LIQUID_TYPES,
  sumByTypes,
} from '../accounts/calculations/totals';
import { NO_VALUATIONS, type Valuations } from '../portfolio/calculations/investments';
import { calculateNetWorth, withCurrentNetWorth } from '../portfolio/calculations/wealth';

export interface AnalyticsSources {
  transactions: Transaction[];
  /** Trips, holidays, moves: only used to explain the period, never to change it. */
  collections?: Collection[];
  categories: Category[];
  accounts: Account[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  /** Server-built recurring overview: suggestions and this month's figures. */
  recurringOverview?: RecurringOverview | null;
  snapshots: MonthSnapshot[];
  assets: Asset[];
  /** The server's valuation of each holding; empty until it loads. */
  valuations?: Valuations;
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
  /** Up to the last 12 calendar months with activity, oldest first. */
  trend: TrendMonth[];
  /** A typical period of the same length, or null without three completed months. */
  typical: TypicalPeriod | null;
  baseline: string[];
  baselineLabel: string;
  /** Net worth as of now — sum of non-investment account balances. */
  currentNetWorth: number;
  periodTransactions: Transaction[];
  /** Net money into assets across the whole calendar year. */
  investedThisYear: number;
  /** The calendar year `investedThisYear` covers. */
  year: number;
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

const NO_COLLECTIONS: Collection[] = [];

export function useAnalyticsModel(
  sources: AnalyticsSources,
  selection: AnalyticsSelection,
  today: Date,
): AnalyticsModel {
  const { transactions, categories, accounts, goals, recurring, recurringOverview = null, snapshots, assets } = sources;
  const collections = sources.collections ?? NO_COLLECTIONS;
  const valuations = sources.valuations ?? NO_VALUATIONS;
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

    // The same net worth the Overview hero shows, and the chart's last point
    // set to it, so "now" is one number on both tabs.
    const worth = calculateNetWorth(accounts, assets, valuations);
    const netWorth = calculateNetWorthChange(withCurrentNetWorth(snapshots, worth, monthKeyOf(today)), {
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
      suggestions: recurringOverview?.suggestions ?? [],
      thisMonth: monthFromOverview(recurringOverview),
    });

    const baselineMetrics = baseline.length >= 3 ? monthlyMetrics(transactions, baseline, ctx) : [];
    const insights = generateDeterministicInsights({
      period,
      metrics,
      previousMetrics,
      categories: categoryRows,
      savings,
      recurring: recurringOutlook,
      netWorth,
      collections: periodCollectionSpending(periodTransactions, collections, ctx)
        .map(entry => ({ id: entry.collection.id, name: entry.collection.name, spent: entry.spent })),
      typicalExpenses: baselineMetrics.length > 0
        ? (baselineMetrics.reduce((sum, m) => sum + m.metrics.expenses, 0) / baselineMetrics.length) * period.months.length
        : null,
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

    // Canonical populations, shared with Accounts and Overview.
    const liquidBalance = sumByTypes(accounts, LIQUID_TYPES);
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

    // The trend always covers the last year, whatever period is selected, so
    // the selected months can be read against what came before them. It starts
    // at the first month with any activity rather than padding with empties.
    const trendMonths: string[] = [];
    for (let back = 11; back >= 0; back--) {
      const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
      trendMonths.push(monthKeyOf(d));
    }
    const firstActive = ascendingMonths[0] ?? currentMonth;
    const periodMonths = new Set(period.months);
    const trend: TrendMonth[] = monthlyMetrics(transactions, trendMonths.filter(m => m >= firstActive), ctx)
      .map(({ month, metrics: m }) => ({
        month,
        income: m.income,
        expenses: m.expenses,
        net: m.net,
        partial: month === currentMonth,
        inPeriod: periodMonths.has(month),
      }));

    const scale = Math.max(1, period.months.length);
    const typical: TypicalPeriod | null = baselineMetrics.length > 0
      ? (() => {
        const avg = (pick: (m: PeriodMetrics) => number) =>
          (baselineMetrics.reduce((s, b) => s + pick(b.metrics), 0) / baselineMetrics.length) * scale;
        return { income: avg(m => m.income), expenses: avg(m => m.expenses), net: avg(m => m.net), months: baselineMetrics.length };
      })()
      : null;

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
      trend,
      typical,
      baseline,
      baselineLabel: baselineDescription(baseline.length),
      currentNetWorth: worth.total,
      periodTransactions,
      // A running total, so a month with no purchases still shows the year's
      // contributions rather than reading as though nothing was ever invested.
      investedThisYear: investedInYear(transactions, ctx, today),
      year: today.getFullYear(),
    };
  }, [
    availableMonths, period, today, transactions, categories, accounts, goals,
    recurring, recurringOverview, snapshots, assets, valuations, ctx, netWorthWindow, collections,
  ]);
}
