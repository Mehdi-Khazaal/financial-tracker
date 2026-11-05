/**
 * End-of-period projections.
 *
 * Forecasts are only shown when they can be defended, so this module refuses
 * more often than it answers. It requires the period to still be running, at
 * least five days of it elapsed, and at least three completed months behind
 * it. Below any of those, it returns `available: false` with the reason
 * instead of a number.
 *
 * Method: what has already happened, plus bills that are actually scheduled,
 * plus a daily rate for day-to-day spending (everything except scheduled
 * bills). That daily rate blends this period's pace with the historical
 * median, and this period's share grows with how much of it has passed: on
 * day 5 one trip should not set the month, by day 25 the month has mostly
 * spoken for itself. Bills are never run-rated — rent paid on the 1st is
 * counted once, not multiplied by the days left.
 *
 * Categories are projected more conservatively still: spent so far, plus
 * bills still due in them, plus a typical rest of the month. A one-off
 * purchase raises a category by its own amount and no more.
 *
 * Irregular income is handled by refusing to run-rate it: income is projected
 * only from what has landed plus what is scheduled, unless month-to-month
 * income has been stable.
 */

import type { RecurringTransaction, Transaction } from '../../../types';
import type {
  CategoryComparison,
  ClassificationContext,
  Forecast,
  PeriodMetrics,
  ResolvedPeriod,
} from '../types';
import { monthLabel, plural } from '../format';
import { dateKey } from '../period';
import { fixedCostKeys } from './cashflow';
import { calculatePeriodMetrics, transactionsInRange } from './metrics';
import {
  categorySpendDelta,
  classifyTransaction,
  expandSplits,
  median,
  merchantKeyOf,
} from './transactions';
import { activeRecurringExpenses } from './recurring';

const MIN_DAYS_ELAPSED = 5;
const MIN_MONTHS = 3;
const DAYS_PER_MONTH = 30.44;

/**
 * Day-to-day spending: every expense except charges from a scheduled bill,
 * as a total and per category (split lines filed under their own category).
 */
export function dayToDaySpend(
  transactions: Transaction[],
  ctx: ClassificationContext,
  fixedKeys: Set<string>,
): { total: number; byCategory: Map<number, number> } {
  let total = 0;
  const byCategory = new Map<number, number>();
  expandSplits(transactions).forEach(tx => {
    const delta = categorySpendDelta(tx, classifyTransaction(tx, ctx));
    if (delta === 0) return;
    const key = merchantKeyOf(tx);
    if (key && fixedKeys.has(key)) return;
    total += delta;
    if (tx.category_id != null) {
      byCategory.set(tx.category_id, (byCategory.get(tx.category_id) ?? 0) + delta);
    }
  });
  return { total, byCategory };
}

const unavailable = (reason: string, period: ResolvedPeriod): Forecast => ({
  available: false,
  reason,
  confidence: 'none',
  basis: '',
  monthLabel: period.isSingleMonth ? monthLabel(period.months[0]) : period.label,
  daysElapsed: period.daysElapsed,
  daysTotal: period.daysTotal,
  expenses: null,
  income: null,
  savings: null,
  savingsRate: null,
  categoryRisks: [],
});

export interface ForecastInputs {
  period: ResolvedPeriod;
  transactions: Transaction[];
  recurring: RecurringTransaction[];
  categories: CategoryComparison[];
  /** Completed months only, ascending. */
  monthly: { month: string; metrics: PeriodMetrics }[];
  ctx: ClassificationContext;
  today: Date;
}

export function calculateForecast(inputs: ForecastInputs): Forecast {
  const { period, transactions, recurring, monthly, ctx, today } = inputs;

  if (!period.isIncomplete) {
    return unavailable('This period is already complete.', period);
  }
  if (period.daysElapsed < MIN_DAYS_ELAPSED) {
    return unavailable(
      `Only ${plural(period.daysElapsed, 'day')} into the period — too early to project from.`,
      period,
    );
  }
  if (monthly.length < MIN_MONTHS) {
    return unavailable(
      `Projections need ${MIN_MONTHS} completed months of history. You have ${monthly.length}.`,
      period,
    );
  }

  const todayKey = dateKey(today);
  const daysRemaining = Math.max(0, period.daysTotal - period.daysElapsed);
  const periodTxs = transactionsInRange(transactions, period);
  const metrics = calculatePeriodMetrics(periodTxs, ctx);

  // ── Spending already committed by a schedule ────────────────────────────────
  const keys = fixedCostKeys(recurring);
  const scheduledByCategory = new Map<number, number>();
  const scheduledRemaining = activeRecurringExpenses(recurring)
    .reduce((sum, r) => {
      const due = r.next_date.slice(0, 10);
      if (due <= todayKey || due > period.end) return sum;
      const amount = Math.abs(Number(r.amount));
      if (r.category_id != null) {
        scheduledByCategory.set(r.category_id, (scheduledByCategory.get(r.category_id) ?? 0) + amount);
      }
      return sum + amount;
    }, 0);

  // ── Day-to-day spending, from a blended daily rate ──────────────────────────
  // History is measured the same way as this month — bills left out — or a
  // typical month's rent would be counted again on top of the real one.
  const current = dayToDaySpend(periodTxs, ctx, keys);
  const history = monthly.map(m =>
    dayToDaySpend(transactions.filter(t => t.transaction_date.slice(0, 7) === m.month), ctx, keys));

  const elapsedFraction = period.daysElapsed / period.daysTotal;
  const historicalDaily = median(history.map(h => h.total)) / DAYS_PER_MONTH;
  const currentDaily = current.total / period.daysElapsed;
  const blendedDaily = historicalDaily * (1 - elapsedFraction) + currentDaily * elapsedFraction;
  const variableRemaining = blendedDaily * daysRemaining;

  const projectedExpenses = metrics.expenses + scheduledRemaining + variableRemaining;

  // ── Income: scheduled only, unless history says it is stable ────────────────
  const incomes = monthly.map(m => m.metrics.income);
  const medianIncome = median(incomes);
  // Every month must sit close to the median, not merely most of them. A
  // single near-empty month is exactly the case where filling the rest of the
  // period toward a "typical" figure would invent income that never arrives.
  const incomeIsRegular = medianIncome > 0
    && incomes.every(v => Math.abs(v - medianIncome) <= medianIncome * 0.35);

  const scheduledIncome = recurring
    .filter(r => r.is_active && Number(r.amount) > 0)
    .reduce((sum, r) => {
      const due = r.next_date.slice(0, 10);
      return due > todayKey && due <= period.end ? sum + Number(r.amount) : sum;
    }, 0);

  // Only fill the gap toward a typical month when income has been predictable.
  const impliedRemainingIncome = incomeIsRegular
    ? Math.max(0, medianIncome - metrics.income - scheduledIncome) * (daysRemaining / period.daysTotal)
    : 0;
  const projectedIncome = metrics.income + scheduledIncome + impliedRemainingIncome;

  const projectedSavings = projectedIncome - projectedExpenses;

  // ── Categories tracking above their own average ─────────────────────────────
  // Spent so far + bills still due + a typical rest of the month.
  const categoryRisks = inputs.categories
    .filter(c => c.baselineMonths >= MIN_MONTHS && c.average > 0 && c.current > 0)
    .map(c => {
      const typicalDaily = median(history.map(h => h.byCategory.get(c.id) ?? 0)) / DAYS_PER_MONTH;
      const projected = c.current + (scheduledByCategory.get(c.id) ?? 0) + typicalDaily * daysRemaining;
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        projected,
        average: c.average,
        pct: (projected - c.average) / c.average,
      };
    })
    .filter(r => r.pct >= 0.25 && r.projected - r.average >= 25)
    .sort((a, b) => b.projected - b.average - (a.projected - a.average))
    .slice(0, 3);

  const confidence = monthly.length >= 6 ? 'high' : monthly.length >= 4 ? 'medium' : 'low';
  const asOf = new Date(`${todayKey}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return {
    available: true,
    reason: null,
    confidence,
    // `period.daysElapsed` is the single source for "how far in are we" — the
    // progress bar and this sentence must never quote different numbers.
    basis: `Based on spending through ${asOf}, ${plural(period.daysElapsed, 'day')} into the period, and your previous ${plural(monthly.length, 'month')}.${incomeIsRegular ? '' : ' Income has varied month to month, so only income already received or scheduled is counted.'}`,
    monthLabel: period.isSingleMonth ? monthLabel(period.months[0]) : period.label,
    daysElapsed: period.daysElapsed,
    daysTotal: period.daysTotal,
    expenses: {
      projected: projectedExpenses,
      soFar: metrics.expenses,
      scheduled: scheduledRemaining,
    },
    income: {
      projected: projectedIncome,
      soFar: metrics.income,
      scheduled: scheduledIncome,
    },
    savings: projectedSavings,
    savingsRate: projectedIncome > 0 ? projectedSavings / projectedIncome : null,
    categoryRisks,
  };
}
