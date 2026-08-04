/**
 * Recent balance change, from the account history already loaded for sparklines.
 *
 * The data is there — `/history/accounts?months=6` is fetched on every visit —
 * but only ever drawn as a 72px line. The number itself was never shown, so the
 * one genuinely useful fact in it went unread.
 *
 * The rule that matters here: **missing history is not "no change".** An
 * account opened last week has no six-month trend, and printing `+$0.00` for it
 * would be a statement about its balance rather than about the absence of data.
 * A single snapshot is the same problem — one point is a position, not a trend.
 */

import type { MonthSnapshot } from '../../../types';

export interface BalanceChange {
  /** True when there are at least two comparable snapshots. */
  available: boolean;
  /** Absolute movement over the window. Zero when unavailable. */
  change: number;
  /** Fractional movement, or null when the starting balance was zero. */
  pctChange: number | null;
  /** Balance at the start of the window. */
  start: number;
  /** Balance at the end of the window. */
  end: number;
  /** Snapshots actually used. */
  points: number;
  /** `6 months`, `3 months` — the real span, not the requested one. */
  windowLabel: string;
  /** Values for a sparkline, oldest first. Empty when unavailable. */
  series: number[];
  /** Spoken summary, so the sparkline is not sighted-only. */
  summary: string;
}

const UNAVAILABLE: BalanceChange = {
  available: false,
  change: 0,
  pctChange: null,
  start: 0,
  end: 0,
  points: 0,
  windowLabel: '',
  series: [],
  summary: 'Not enough history to show a trend yet.',
};

/** Balance out of a snapshot, whichever field the endpoint filled. */
const balanceOf = (snapshot: MonthSnapshot): number =>
  Number(snapshot.balance ?? snapshot.net_worth ?? snapshot.accounts ?? 0);

/**
 * Change across `snapshots`, oldest to newest.
 *
 * Snapshots are sorted by their month key before comparison, so two series
 * that arrived in different orders can never be differenced end-to-end and
 * produce a change with the wrong sign.
 */
export function calculateBalanceChange(
  snapshots: MonthSnapshot[] | undefined,
  accountName = 'This account',
): BalanceChange {
  if (!snapshots || snapshots.length < 2) return UNAVAILABLE;

  const ordered = [...snapshots]
    .filter(s => typeof s.month === 'string' && s.month.length >= 7)
    .sort((a, b) => a.month.localeCompare(b.month));

  if (ordered.length < 2) return UNAVAILABLE;

  const series = ordered.map(balanceOf);
  const start = series[0];
  const end = series[series.length - 1];
  const change = end - start;
  const months = ordered.length;

  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'unchanged';
  const magnitude = Math.abs(change).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return {
    available: true,
    change,
    pctChange: start === 0 ? null : change / Math.abs(start),
    start,
    end,
    points: months,
    windowLabel: months === 1 ? '1 month' : `${months} months`,
    series,
    summary: change === 0
      ? `${accountName} is unchanged over the last ${months} months.`
      : `${accountName} is ${direction} $${magnitude} over the last ${months} months.`,
  };
}
