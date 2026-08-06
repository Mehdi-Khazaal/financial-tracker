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
 * plus a daily rate for everything else — where that daily rate is a 50/50
 * blend of this period's pace and the historical median. The blend stops a
 * quiet or frantic first week from setting the whole projection.
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
  median,
  merchantKeyOf,
} from './transactions';
import { activeRecurringExpenses } from './recurring';

const MIN_DAYS_ELAPSED = 5;
const MIN_MONTHS = 3;

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
  const scheduledRemaining = activeRecurringExpenses(recurring)
    .reduce((sum, r) => {
      const due = r.next_date.slice(0, 10);
      return due > todayKey && due <= period.end ? sum + Math.abs(Number(r.amount)) : sum;
    }, 0);

  // ── Everything else, from a blended daily rate ──────────────────────────────
  let variableSoFar = 0;
  periodTxs.forEach(tx => {
    const kind = classifyTransaction(tx, ctx);
    const delta = categorySpendDelta(tx, kind);
    if (delta === 0) return;
    const key = merchantKeyOf(tx);
    if (!key || !keys.has(key)) variableSoFar += delta;
  });

  const historicalDaily = median(monthly.map(m => m.metrics.expenses)) / 30.44;
  const currentDaily = variableSoFar / period.daysElapsed;
  const blendedDaily = (historicalDaily + currentDaily) / 2;
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
  const elapsedFraction = period.daysElapsed / period.daysTotal;
  const categoryRisks = inputs.categories
    .filter(c => c.baselineMonths >= MIN_MONTHS && c.average > 0 && c.current > 0)
    .map(c => {
      const projected = elapsedFraction > 0 ? c.current / elapsedFraction : c.current;
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
