/**
 * Net-worth trend for Portfolio.
 *
 * The Dashboard keeps its compact sparkline as the glance view. Portfolio owns
 * the deeper version — range controls, start and current, high and low — but
 * **not a second definition**. The series comes from the same
 * `/history/net-worth` snapshots the Dashboard uses, which the backend builds
 * from `type != 'investment'` account balances, matching
 * `netWorthFromAccounts`. Nothing here recomputes net worth.
 */

import type { MonthSnapshot } from '../../../types';
import { shortMonthLabel } from '../../analytics/format';

/** Ranges offered, in months. Only ones the data can actually fill are shown. */
export const RANGE_OPTIONS = [6, 12, 24] as const;
export type RangeMonths = typeof RANGE_OPTIONS[number];

export interface TrendPoint {
  month: string;
  label: string;
  value: number;
}

export interface NetWorthRange {
  points: TrendPoint[];
  /** True when at least two points exist — one point is a position, not a trend. */
  hasTrend: boolean;
  start: number;
  current: number;
  change: number;
  /** Fractional change, or null when the start was zero. */
  pctChange: number | null;
  high: TrendPoint | null;
  low: TrendPoint | null;
  /** Months actually covered, which may be fewer than requested. */
  months: number;
  /** `Last 12 months`, or `Since March 2026` when history is shorter. */
  label: string;
  /** Spoken summary, so the chart is never sighted-only. */
  summary: string;
}

const balanceOf = (snapshot: MonthSnapshot): number =>
  Number(snapshot.net_worth ?? snapshot.accounts ?? snapshot.balance ?? 0);

const money = (value: number) =>
  `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const EMPTY_RANGE: NetWorthRange = {
  points: [],
  hasTrend: false,
  start: 0,
  current: 0,
  change: 0,
  pctChange: null,
  high: null,
  low: null,
  months: 0,
  label: 'No history yet',
  summary: 'No net-worth history has been recorded yet.',
};

/**
 * Which ranges the stored history can actually fill.
 *
 * Offering a 24-month button that renders the same 4 months as the 6-month one
 * is a control that does nothing, so a range is only offered once there is more
 * history than the range below it.
 */
export function availableRanges(snapshots: MonthSnapshot[]): RangeMonths[] {
  const total = snapshots.length;
  return RANGE_OPTIONS.filter((months, index) => {
    if (index === 0) return total >= 2;
    return total > RANGE_OPTIONS[index - 1];
  });
}

export function buildNetWorthRange(
  snapshots: MonthSnapshot[],
  months: RangeMonths,
): NetWorthRange {
  const ordered = [...snapshots]
    .filter(s => typeof s.month === 'string' && s.month.length >= 7)
    .sort((a, b) => a.month.localeCompare(b.month));

  const windowed = ordered.slice(Math.max(0, ordered.length - months));
  if (windowed.length === 0) return EMPTY_RANGE;

  const points: TrendPoint[] = windowed.map(snap => ({
    month: snap.month,
    label: shortMonthLabel(snap.month),
    value: balanceOf(snap),
  }));

  const start = points[0].value;
  const current = points[points.length - 1].value;
  const change = current - start;

  let high = points[0];
  let low = points[0];
  points.forEach(p => {
    if (p.value > high.value) high = p;
    if (p.value < low.value) low = p;
  });

  const hasTrend = points.length >= 2;
  const label = !hasTrend
    ? 'Not enough history yet'
    : points.length >= months
      ? `Last ${months} months`
      : `Since ${points[0].label}`;

  return {
    points,
    hasTrend,
    start,
    current,
    change,
    pctChange: start === 0 ? null : change / Math.abs(start),
    high,
    low,
    months: points.length,
    label,
    summary: hasTrend
      ? `Net worth ${label.toLowerCase()}: ${money(start)} in ${points[0].label}, `
        + `${money(current)} in ${points[points.length - 1].label}, `
        + `a change of ${change < 0 ? 'minus ' : ''}${money(change)}. `
        + `High ${money(high.value)} in ${high.label}, low ${money(low.value)} in ${low.label}.`
      : 'Only one month of history so far, which is a position rather than a trend.',
  };
}
