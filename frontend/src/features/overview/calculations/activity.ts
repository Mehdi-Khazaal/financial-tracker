/**
 * What the current month actually looks like right now.
 *
 * A month that reads $0 income and $0 expenses on the 2nd is *correct* —
 * nothing has posted yet. The bug was never the arithmetic, it was a screen
 * that showed two zeroes and left the user to guess whether the app was broken.
 * This module turns that silence into a stated reason.
 *
 * Fintrack has no pending-transaction flag: Plaid's pending rows are stored as
 * ordinary transactions and overwritten once they post (`plaid_router.py`).
 * There is therefore nothing truthful to report as "pending", and this module
 * deliberately does not invent it. The honest substitute is the date of the
 * most recent posted transaction.
 */

import type { Transaction } from '../../../types';
import { dateKey } from '../../analytics/period';
import { dayLabel, plural } from '../../analytics/format';
import type { MonthActivity, MonthActivityState } from '../types';

/** A month this young is "just started" rather than "quiet". */
export const EARLY_MONTH_DAYS = 5;

export interface MonthActivityOptions {
  /** Every transaction the page holds, not just the current month's. */
  transactions: Transaction[];
  /** `YYYY-MM` of the month in view. */
  month: string;
  today: Date;
  /** Current-month income, from the shared classifier. */
  income: number;
  /** Current-month expenses, from the shared classifier. */
  expenses: number;
  /** True when a source failed, so an empty month may just be missing data. */
  dataIncomplete: boolean;
}

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

export function buildMonthActivity(options: MonthActivityOptions): MonthActivity {
  const { transactions, month, today, income, expenses, dataIncomplete } = options;

  const todayKey = dateKey(today);
  const monthName = monthNameOf(month);
  const daysInMonth = daysInMonthOf(month);
  const daysElapsed = todayKey.slice(0, 7) === month
    ? today.getDate()
    : daysInMonth;

  const inMonth = transactions.filter(t => t.transaction_date.slice(0, 7) === month);

  // A transaction dated in the future has not posted, whatever the row says.
  const postedDays = transactions
    .map(t => t.transaction_date.slice(0, 10))
    .filter(day => day <= todayKey);
  const lastPostedDate: string | null = postedDays.length > 0
    ? postedDays.reduce((latest, day) => (day > latest ? day : latest))
    : null;

  const postedCount = inMonth.length;
  const hasAnyHistory = transactions.length > 0;

  const state: MonthActivityState = dataIncomplete
    ? 'unavailable'
    : !hasAnyHistory
      ? 'no-data'
      : postedCount === 0
        ? 'no-activity'
        : income === 0 && expenses === 0
          // Every entry in the month netted out — a refund-only month, say.
          ? 'no-activity'
          : income === 0
            ? 'no-income'
            : expenses === 0
              ? 'no-expenses'
              : 'active';

  const lastPostedLabel: string | null = lastPostedDate ? dayLabel(lastPostedDate) : null;
  const lastPostedIsEarlier = lastPostedDate != null && lastPostedDate.slice(0, 7) < month;

  return {
    month,
    monthName,
    state,
    postedCount,
    lastPostedDate,
    lastPostedLabel,
    lastPostedIsEarlier,
    daysElapsed,
    daysInMonth,
    ...describe(state, { monthName, daysElapsed, postedCount }),
  };
}

function describe(
  state: MonthActivityState,
  ctx: { monthName: string; daysElapsed: number; postedCount: number },
): { headline: string | null; detail: string | null } {
  const { monthName, daysElapsed, postedCount } = ctx;

  switch (state) {
    case 'unavailable':
      return {
        headline: 'Activity may be incomplete',
        detail: 'Some information could not be loaded, so these totals may not reflect everything.',
      };
    case 'no-data':
      return {
        headline: 'No transactions yet',
        detail: 'Once an account is linked, imported activity appears here automatically.',
      };
    case 'no-activity':
      return {
        headline: 'No posted activity yet',
        detail: daysElapsed <= EARLY_MONTH_DAYS
          ? `${monthName} has just started. Waiting for your first posted transactions.`
          : `Nothing has posted in ${monthName} so far.`,
      };
    case 'no-income':
      return {
        headline: 'No income posted yet',
        detail: `${plural(postedCount, 'transaction')} posted in ${monthName}, all of it spending so far.`,
      };
    case 'no-expenses':
      return {
        headline: 'No spending posted yet',
        detail: `${plural(postedCount, 'transaction')} posted in ${monthName}, all of it income so far.`,
      };
    default:
      return { headline: null, detail: null };
  }
}
