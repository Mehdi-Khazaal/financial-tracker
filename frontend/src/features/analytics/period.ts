/**
 * Period resolution — the single source of truth for "what range am I looking
 * at, and what do I compare it against".
 *
 * Every analytics component reads from one `ResolvedPeriod`, which is what
 * makes the date filter actually control the whole page. Dates are handled as
 * local `YYYY-MM-DD` strings throughout, matching how the API stores
 * `transaction_date`, so nothing ever shifts by a day across a timezone.
 */

import type { PeriodId, PeriodRange, ResolvedPeriod } from './types';
import { monthLabel, shortMonthLabel } from './format';

const pad = (n: number) => String(n).padStart(2, '0');

export const PERIOD_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-3', label: 'Last 3 months' },
  { id: 'last-6', label: 'Last 6 months' },
  { id: 'all-time', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

/** `Date` → `"YYYY-MM-DD"` in local time. */
export const dateKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** `Date` → `"YYYY-MM"` in local time. */
export const monthKeyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** `"YYYY-MM-DD"` or `"YYYY-MM..."` → `"YYYY-MM"`. */
export const monthOf = (iso: string): string => iso.slice(0, 7);

/** Parse `"YYYY-MM-DD"` as a local midnight `Date`. */
export const parseDate = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00`);

/** First day of the month containing `ym` (`"YYYY-MM"`). */
export const startOfMonth = (ym: string): string => `${ym}-01`;

/** Last day of the month `ym`, as `"YYYY-MM-DD"`. */
export const endOfMonth = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
};

/** Shift a month key by `delta` months. `addMonths('2026-01', -2)` → `'2025-11'`. */
export const addMonths = (ym: string, delta: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKeyOf(d);
};

/** Inclusive list of month keys from `from` to `to`, ascending. */
export const monthRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  let cursor = from;
  // Guard against a malformed range producing an unbounded loop.
  for (let i = 0; i < 600 && cursor <= to; i += 1) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
};

/** Whole days from `a` to `b` (`b - a`), using local midnights. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);

const rangeLabel = (months: string[]): string => {
  if (months.length === 0) return '—';
  if (months.length === 1) return monthLabel(months[0]);
  return `${shortMonthLabel(months[0])} – ${shortMonthLabel(months[months.length - 1])}`;
};

const buildRange = (months: string[]): PeriodRange => ({
  start: startOfMonth(months[0]),
  end: endOfMonth(months[months.length - 1]),
  months,
  label: rangeLabel(months),
});

/**
 * Resolve a period selection into concrete dates plus its comparison range.
 *
 * `earliestMonth` is only consulted for `all-time`; pass the earliest month
 * that has transactions so the range doesn't stretch over empty history.
 */
export function resolvePeriod(
  id: PeriodId,
  options: { today: Date; customMonth: string; earliestMonth?: string | null },
): ResolvedPeriod {
  const { today, customMonth } = options;
  const currentMonth = monthKeyOf(today);

  let months: string[];
  if (id === 'this-month') {
    months = [currentMonth];
  } else if (id === 'last-3') {
    months = monthRange(addMonths(currentMonth, -2), currentMonth);
  } else if (id === 'last-6') {
    months = monthRange(addMonths(currentMonth, -5), currentMonth);
  } else if (id === 'custom') {
    months = [customMonth];
  } else {
    const from = options.earliestMonth && options.earliestMonth < currentMonth
      ? options.earliestMonth
      : currentMonth;
    months = monthRange(from, currentMonth);
  }

  const base = buildRange(months);
  const todayKey = dateKey(today);

  // All-time has no meaningful "same length, immediately before" comparison.
  const previous: PeriodRange | null = id === 'all-time'
    ? null
    : buildRange(monthRange(
      addMonths(months[0], -months.length),
      addMonths(months[0], -1),
    ));

  const daysTotal = daysBetween(base.start, base.end) + 1;
  const isIncomplete = todayKey < base.end;
  const daysElapsed = todayKey < base.start
    ? 0
    : Math.min(daysBetween(base.start, todayKey) + 1, daysTotal);

  return {
    ...base,
    id,
    isSingleMonth: months.length === 1,
    isIncomplete,
    elapsed: daysTotal > 0 ? daysElapsed / daysTotal : 0,
    daysElapsed,
    daysTotal,
    shortLabel: months.length === 1 ? shortMonthLabel(months[0]) : base.label,
    previous,
  };
}

/** True when `iso` (a `YYYY-MM-DD` date) falls inside the range, inclusive. */
export const inRange = (iso: string, range: PeriodRange): boolean => {
  const day = iso.slice(0, 10);
  return day >= range.start && day <= range.end;
};

/**
 * The completed months to average against, most recent last.
 *
 * "Completed" matters: including the month in progress would drag every
 * average down and make the current month look artificially expensive. The
 * current month is always excluded, and so is everything inside `period`.
 */
export function baselineMonths(
  period: ResolvedPeriod,
  availableMonths: string[],
  today: Date,
  limit = 12,
): string[] {
  const currentMonth = monthKeyOf(today);
  const firstMonth = period.months[0];
  const eligible = availableMonths
    .filter(m => m < firstMonth && m < currentMonth)
    .sort();
  return eligible.slice(Math.max(0, eligible.length - limit));
}

/** How much to trust an average built from `n` months. */
export function confidenceFor(n: number): 'none' | 'low' | 'medium' | 'high' {
  if (n <= 0) return 'none';
  if (n <= 2) return 'low';
  if (n <= 5) return 'medium';
  return 'high';
}

/** "Average of the previous 4 completed months" — spelled out, never implied. */
export function baselineDescription(n: number): string {
  if (n <= 0) return 'No completed months to average yet';
  if (n === 1) return 'Based on 1 earlier month — treat as a rough guide';
  return `Average of the previous ${n} completed months`;
}
