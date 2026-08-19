/**
 * Assembles the Overview view model in one memoised pass.
 *
 * The same shape as `useAnalyticsModel`, and for the same reason: when a page
 * recomputes totals inline in JSX, two sections eventually disagree. Every
 * number Overview prints comes from here, and every money figure here comes
 * from the shared analytics classifier — Overview never defines income,
 * expenses, refunds or card payments for itself.
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
import type { Forecast, PeriodMetrics, UpcomingBill } from '../analytics/types';
import {
  buildClassificationContext,
  normalizeMerchantName,
} from '../analytics/calculations/transactions';
import { calculatePeriodMetrics, monthlyMetrics } from '../analytics/calculations/metrics';
import { detectRecurringTransactions, upcomingBills } from '../analytics/calculations/recurring';
import { calculateCategoryComparisons } from '../analytics/calculations/categories';
import { calculateForecast } from '../analytics/calculations/forecast';
import { calculateSavingsMetrics } from '../analytics/calculations/savings';
import { addMonths, baselineMonths, dateKey, monthKeyOf, resolvePeriod } from '../analytics/period';
import type { MonthActivity, SpendingComparison } from './types';
import { buildMonthActivity } from './calculations/activity';
import { buildSpendingComparison } from './calculations/comparison';
import { buildImportReview, type ImportReview } from './calculations/review';
import {
  RECENT_WINDOW_DAYS, buildMorningBrief, calculateSpendingPace,
  type BriefItem, type SpendingPace,
} from './calculations/brief';
import { calculateAccountTotals } from '../accounts/calculations/totals';
import { valuePortfolio } from '../portfolio/calculations/investments';
import { totalWealth } from '../portfolio/calculations/wealth';

export interface OverviewSources {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  snapshots: MonthSnapshot[];
  assets: Asset[];
  /** Names of sources that failed to load, from the Dashboard loader. */
  failedSources: string[];
}

export interface NetWorthTrend {
  /** Oldest → newest, one entry per snapshot month. */
  points: { month: string; label: string; value: number }[];
  current: number;
  start: number;
  change: number;
  /** Fractional change, or null when the starting value was zero. */
  pctChange: number | null;
  /** How many months the trend covers. */
  months: number;
  /** Two points is the minimum for a trend to mean anything. */
  hasTrend: boolean;
  /** `Last 12 months`, or `Since March 2026` when history is short. */
  timeframeLabel: string;
}

export interface OverviewModel {
  monthKey: string;
  metrics: PeriodMetrics;
  activity: MonthActivity;
  comparison: SpendingComparison;
  review: ImportReview;
  /** The Morning Brief — today-anchored, capped, possibly empty. */
  brief: BriefItem[];
  /** Metrics over the trailing week, for "what happened recently". */
  recentMetrics: PeriodMetrics;
  /** Month spend against a typical month, null without enough history. */
  pace: SpendingPace | null;
  forecast: Forecast;
  netWorth: NetWorthTrend;
  /** Checking + cash. Money that can be spent without moving anything first. */
  availableToSpend: number;
  physicalAssets: number;
  /**
   * Accounts plus every holding, or null when nothing is held. Net worth is
   * account balances only, so this is the figure that does not move when cash
   * is converted into an asset.
   */
  totalWealth: number | null;
  investments: number;
  cardDebt: number;
  creditLimit: number;
  cardUtilization: number | null;
  /** The next declared recurring charge due, or null. */
  nextCharge: UpcomingBill | null;
  /** Undeclared subscription-shaped charges found in history. */
  undeclaredRecurringCount: number;
}

/** Stable "now" for a mounted page, so memos don't invalidate every render. */
export function useToday(): Date {
  const [today] = useState(() => new Date());
  return today;
}

const monthLabelOf = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export function useOverviewModel(sources: OverviewSources, today: Date): OverviewModel {
  const { accounts, transactions, categories, goals, recurring, snapshots, assets, failedSources } = sources;

  const ctx = useMemo(
    () => buildClassificationContext(accounts, categories),
    [accounts, categories],
  );

  return useMemo<OverviewModel>(() => {
    const monthKey = monthKeyOf(today);
    const dataIncomplete = failedSources.length > 0;

    const monthTx = transactions.filter(t => t.transaction_date.slice(0, 7) === monthKey);
    const metrics = calculatePeriodMetrics(monthTx, ctx);

    const activity = buildMonthActivity({
      transactions,
      month: monthKey,
      today,
      income: metrics.income,
      expenses: metrics.expenses,
      dataIncomplete: failedSources.includes('transactions'),
    });

    const comparison = buildSpendingComparison({
      transactions,
      month: monthKey,
      today,
      ctx,
      currentExpenses: metrics.expenses,
    });

    const review = buildImportReview(transactions, monthKey);

    // Every account figure below comes from the canonical definitions in
    // `features/accounts/calculations/totals`. These used to be inline reduces
    // that happened to agree; a shared call cannot drift.
    const accountTotals = calculateAccountTotals(accounts);
    const currentNetWorth = accountTotals.netWorth;

    const points = snapshots
      .slice(-12)
      .map(snap => ({
        month: snap.month,
        label: new Date(`${snap.month}-01T00:00:00`)
          .toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        value: Number(snap.net_worth ?? snap.accounts ?? snap.balance ?? 0),
      }));

    const start = points.length > 0 ? points[0].value : currentNetWorth;
    const change = currentNetWorth - start;
    const netWorth: NetWorthTrend = {
      points,
      current: currentNetWorth,
      start,
      change,
      pctChange: start === 0 ? null : change / Math.abs(start),
      months: points.length,
      hasTrend: points.length >= 2,
      timeframeLabel: points.length >= 12
        ? 'Last 12 months'
        : points.length >= 2
          ? `Since ${monthLabelOf(points[0].month)}`
          : 'Not enough history yet',
    };

    const bills = failedSources.includes('recurring')
      ? []
      : upcomingBills(recurring, { accounts, categories, today, horizonDays: 45 });
    const nextCharge = bills.find(b => b.daysUntil >= 0) ?? null;

    const declaredKeys = new Set<string>();
    recurring.forEach(r => {
      if (!r.is_active) return;
      const key = normalizeMerchantName(r.description);
      if (key) declaredKeys.add(key);
    });
    const undeclaredRecurringCount = failedSources.includes('recurring')
      ? 0
      : detectRecurringTransactions(transactions, ctx, { today, declaredKeys }).length;

    // The most recent month that has actually finished, for the all-clear line.
    const previousMonth = addMonths(monthKey, -1);
    const previousTx = transactions.filter(t => t.transaction_date.slice(0, 7) === previousMonth);
    const lastCompleted = previousTx.length > 0
      ? { month: previousMonth, net: calculatePeriodMetrics(previousTx, ctx).net }
      : null;

    // ── Morning Brief inputs ────────────────────────────────────────────────
    // Everything below reuses the analytics calculations rather than growing a
    // second set. The cost is one extra pass over the same arrays, inside the
    // memo that already runs once per data change.

    const todayKey = dateKey(today);
    const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (RECENT_WINDOW_DAYS - 1));
    const windowStartKey = dateKey(windowStart);
    const recentTransactions = transactions.filter(t => {
      const day = t.transaction_date.slice(0, 10);
      return day >= windowStartKey && day <= todayKey;
    });
    const recentMetrics = calculatePeriodMetrics(recentTransactions, ctx);

    const availableMonths = Array.from(
      new Set(transactions.map(t => t.transaction_date.slice(0, 7))),
    ).sort();

    const period = resolvePeriod('this-month', {
      today,
      customMonth: monthKey,
      earliestMonth: availableMonths[0] ?? null,
    });

    const completedMonths = availableMonths.filter(m => m < monthKey);
    const monthly = monthlyMetrics(transactions, completedMonths, ctx);

    const pace = calculateSpendingPace({
      monthExpenses: metrics.expenses,
      elapsedFraction: period.elapsed,
      completedMonthExpenses: monthly.map(m => m.metrics.expenses),
    });

    const categoryRows = calculateCategoryComparisons({
      transactions,
      categories,
      period,
      baseline: baselineMonths(period, availableMonths, today),
      ctx,
    });

    // The same savings figures Analytics quotes — average monthly saved, the
    // featured goal, and its projected completion — rather than a second
    // average computed for the brief alone.
    const savings = calculateSavingsMetrics({
      transactions,
      goals: failedSources.includes('savings goals') ? [] : goals,
      period,
      baseline: completedMonths,
      ctx,
      today,
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

    const brief = buildMorningBrief({
      today,
      activity,
      dataIncomplete,
      unreviewedCount: review.unreviewed,
      accounts,
      primaryGoal: savings.primaryGoal,
      savingsMonths: savings.averageMonths,
      recentMetrics,
      recentTransactions,
      declaredRecurringKeys: declaredKeys,
      pace,
      forecast,
      upcoming: bills,
      lastCompleted,
      undeclaredRecurringCount,
      heroShowsActivityContext: activity.headline != null,
    });

    return {
      monthKey,
      metrics,
      activity,
      comparison,
      review,
      brief,
      recentMetrics,
      pace,
      forecast,
      netWorth,
      availableToSpend: accountTotals.availableToSpend,
      physicalAssets: valuePortfolio(
        assets.filter(a => a.asset_class === 'physical'), {},
      ).total,
      // The same valuation Portfolio runs, with an empty price map — Overview
      // makes no market calls, so every holding contributes its recorded
      // value. One function, two inputs, no second definition.
      investments: valuePortfolio(
        assets.filter(a => a.asset_class === 'investment'), {},
      ).total,
      // Same empty price map, same reason. Passing every asset — physical and
      // investment alike — because the question is what you are worth in total.
      totalWealth: assets.length > 0
        ? totalWealth(accounts, assets, {}).total
        : null,
      cardDebt: accountTotals.cardDebt,
      creditLimit: accountTotals.creditLimit,
      cardUtilization: accountTotals.utilization,
      nextCharge,
      undeclaredRecurringCount,
    };
  }, [accounts, transactions, categories, goals, recurring, snapshots, assets, failedSources, ctx, today]);
}
