/**
 * Timeline day grouping.
 *
 * The Timeline is the page that answers "what happened", and it was a flat
 * undifferentiated list — 300 rows with no temporal structure, so finding
 * "that Thursday" meant reading dates off every row. Grouping by calendar day
 * gives the list a spine and a place to put a day's totals.
 *
 * Days are local. Slicing the ISO string keeps the grouping in the same
 * timezone the dates were entered in; converting through `Date` would move
 * late-evening transactions into the next day for anyone west of UTC.
 *
 * Daily totals come from the shared classifier, so a card payment is not income
 * and a refund reduces the day's spending rather than inflating both sides.
 */

import type { Transaction } from '../../../types';
import type { ClassificationContext } from '../../analytics/types';
import { calculatePeriodMetrics } from '../../analytics/calculations/metrics';
import { dateKey } from '../../analytics/period';

export interface DayGroup {
  /** `YYYY-MM-DD`, the grouping key. */
  date: string;
  /** `Today`, `Yesterday`, `Jul 31` or `Jul 31, 2025` when the year differs. */
  label: string;
  transactions: Transaction[];
  count: number;
  income: number;
  expenses: number;
  /** Income minus expenses for the day. */
  net: number;
  /** Card payments on the day — excluded from income, shown so they aren't lost. */
  cardPayments: number;
}

/** `Today` / `Yesterday` / `Jul 31` / `Jul 31, 2025`. */
export function dayHeading(day: string, today: Date): string {
  const todayKey = dateKey(today);
  if (day === todayKey) return 'Today';

  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day === dateKey(yesterday)) return 'Yesterday';

  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    // The year only earns its space when it is not the current one.
    ...(parsed.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * Group `transactions` into days, newest day first.
 *
 * Row order inside a day is preserved exactly as given, so whatever ordering
 * the caller applied — the API's date-then-created_at sort — still holds.
 */
export function groupByDay(
  transactions: Transaction[],
  ctx: ClassificationContext,
  today: Date,
): DayGroup[] {
  const buckets = new Map<string, Transaction[]>();

  transactions.forEach(tx => {
    const day = tx.transaction_date.slice(0, 10);
    const bucket = buckets.get(day);
    if (bucket) bucket.push(tx);
    else buckets.set(day, [tx]);
  });

  return Array.from(buckets.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, rows]) => {
      const metrics = calculatePeriodMetrics(rows, ctx);
      return {
        date,
        label: dayHeading(date, today),
        transactions: rows,
        count: rows.length,
        income: metrics.income,
        expenses: metrics.expenses,
        net: metrics.net,
        cardPayments: metrics.cardPayments,
      };
    });
}
