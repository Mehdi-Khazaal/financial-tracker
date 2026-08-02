/**
 * The "vs last month" metric, said out loud.
 *
 * The old card printed `−$2,285.84 spending`, which could be read three ways:
 * spending is down by that much, last month's spending *was* that much, or
 * spending dented net worth by that much. A sign is not an explanation, so
 * every result here states which of the three it is.
 *
 * The comparison is also fair by construction. On 2 August, measuring two days
 * of spending against thirty-one days of July would report a ~95% "improvement"
 * every single month. So a part-month is compared against the *same stretch* of
 * the previous month, and when there is nothing comparable the number is quoted
 * neutrally as a prior-period total rather than dressed up as progress.
 */

import type { Transaction } from '../../../types';
import type { ClassificationContext } from '../../analytics/types';
import { calculatePeriodMetrics } from '../../analytics/calculations/metrics';
import { addMonths, dateKey } from '../../analytics/period';
import { dollars } from '../../analytics/format';
import type { SpendingComparison } from '../types';

const monthNameOf = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' });
};

const daysInMonthOf = (month: string): number => {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
};

export interface SpendingComparisonOptions {
  transactions: Transaction[];
  /** `YYYY-MM` of the month in view. */
  month: string;
  today: Date;
  ctx: ClassificationContext;
  /** Current-month expenses, already computed by the shared classifier. */
  currentExpenses: number;
}

export function buildSpendingComparison(options: SpendingComparisonOptions): SpendingComparison {
  const { transactions, month, today, ctx, currentExpenses } = options;

  const previousMonth = addMonths(month, -1);
  const previousName = monthNameOf(previousMonth);
  const todayKey = dateKey(today);

  const isCurrentMonth = todayKey.slice(0, 7) === month;
  const daysInMonth = daysInMonthOf(month);
  const dayOfMonth = isCurrentMonth ? today.getDate() : daysInMonth;
  const isPartialMonth = isCurrentMonth && dayOfMonth < daysInMonth;

  const previousTx = transactions.filter(t => t.transaction_date.slice(0, 7) === previousMonth);
  const previousTotal = calculatePeriodMetrics(previousTx, ctx).expenses;

  // Same stretch of the previous month. February has no 30th, so the cutoff is
  // clamped — which simply means the whole of the shorter month is in scope.
  const previousCutoffDay = Math.min(dayOfMonth, daysInMonthOf(previousMonth));
  const previousCutoff = `${previousMonth}-${String(previousCutoffDay).padStart(2, '0')}`;
  const previousToDate = calculatePeriodMetrics(
    previousTx.filter(t => t.transaction_date.slice(0, 10) <= previousCutoff),
    ctx,
  ).expenses;

  const comparableWindow = isPartialMonth ? previousToDate : previousTotal;

  // Nothing on either side: say nothing rather than print a zero.
  if (currentExpenses === 0 && previousTotal === 0) {
    return {
      kind: 'none',
      label: `Spending vs ${previousName}`,
      value: 0,
      text: 'Nothing to compare yet',
      tone: 'neutral',
      hint: `Neither ${monthNameOf(month)} nor ${previousName} has any posted spending to compare.`,
    };
  }

  // No spending yet this month. Quoting last month's total is useful context;
  // calling it a 100% reduction would not be.
  if (currentExpenses === 0) {
    return {
      kind: 'prior-total',
      label: `${previousName} spending`,
      value: previousTotal,
      text: `${previousName} total: ${dollars(previousTotal)}`,
      tone: 'neutral',
      hint: `${monthNameOf(month)} has no posted spending yet, so this is ${previousName}'s full-month total rather than a comparison.`,
    };
  }

  // Spending this month with no comparable window last month.
  if (comparableWindow === 0) {
    return {
      kind: 'current-total',
      label: `${monthNameOf(month)} spending`,
      value: currentExpenses,
      text: `${dollars(currentExpenses)} spent so far`,
      tone: 'neutral',
      hint: previousTotal === 0
        ? `${previousName} had no posted spending, so there is nothing to compare against.`
        : `${previousName} had no posted spending in its first ${previousCutoffDay} days, so a like-for-like comparison is not possible yet.`,
    };
  }

  const difference = currentExpenses - comparableWindow;

  if (difference === 0) {
    return {
      kind: 'difference',
      label: `Spending vs ${previousName}`,
      value: 0,
      text: `Same as ${previousName}${isPartialMonth ? ' so far' : ''}`,
      tone: 'neutral',
      hint: hintFor(month, previousName, isPartialMonth, dayOfMonth, previousCutoffDay),
    };
  }

  const lower = difference < 0;
  return {
    kind: 'difference',
    label: `Spending vs ${previousName}`,
    value: Math.abs(difference),
    text: `${dollars(Math.abs(difference))} ${lower ? 'less' : 'more'} than ${previousName}${isPartialMonth ? ' so far' : ''}`,
    // Less spending reads as positive, but neither direction is a verdict on a
    // part-month — a big bill simply hasn't landed yet.
    tone: isPartialMonth ? 'neutral' : lower ? 'positive' : 'negative',
    hint: hintFor(month, previousName, isPartialMonth, dayOfMonth, previousCutoffDay),
  };
}

function hintFor(
  month: string,
  previousName: string,
  isPartialMonth: boolean,
  dayOfMonth: number,
  previousCutoffDay: number,
): string {
  const currentName = monthNameOf(month);
  if (!isPartialMonth) {
    return `Total posted spending in ${currentName} against total posted spending in ${previousName}. Refunds reduce the category they came from; credit-card payments and transfers between your own accounts are excluded.`;
  }
  return `${currentName} 1–${dayOfMonth} against ${previousName} 1–${previousCutoffDay}, so a part-month is never measured against a whole one. Refunds reduce the category they came from; credit-card payments and transfers between your own accounts are excluded.`;
}
