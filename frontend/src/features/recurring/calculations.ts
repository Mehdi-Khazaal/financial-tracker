/**
 * Presentation helpers for the Recurring page.
 *
 * Every figure is computed by the server (`GET /recurring/overview`): which
 * charges are bills, which group they belong in, what is paid this month and
 * what is still due. This module only turns those figures into words and
 * proportions, so the page, the Overview tile and Analytics cannot disagree.
 */

import type { RecurringMonth } from '../analytics/types';
import type {
  RecurringBill,
  RecurringBillStatus,
  RecurringOverview,
  RecurringPeriod,
} from '../../types';

/** Money arrives from the API as decimal strings. */
export const num = (value: string | number | null | undefined): number => {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const PERIOD_LABEL: Record<RecurringPeriod, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  yearly: 'Yearly',
};

export type StatusTone = 'positive' | 'attention' | 'warning' | 'neutral' | 'muted';

export const STATUS_TONE: Record<RecurringBillStatus, StatusTone> = {
  paid: 'positive',
  due_soon: 'attention',
  overdue: 'warning',
  missed: 'warning',
  waiting: 'neutral',
  upcoming: 'neutral',
  paused: 'muted',
};

export const TONE_COLOR: Record<StatusTone, string> = {
  positive: 'var(--pos)',
  attention: 'var(--accent)',
  warning: 'var(--neg)',
  neutral: 'var(--muted)',
  muted: 'var(--dim)',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-03` → `Sep 3`. Parsed by hand so no timezone can shift the day. */
export const shortDate = (iso: string): string => {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : iso;
};

/**
 * The one line under a bill's name that says where it stands.
 *
 * Paid bills say when they were paid; everything else says when it is due,
 * relative for the next week and as a date beyond that.
 */
export function dueLine(bill: Pick<RecurringBill, 'status' | 'days_until' | 'next_date' | 'last_paid_date' | 'linked'>): string {
  const d = bill.days_until;
  switch (bill.status) {
    case 'paid':
      return bill.last_paid_date ? `Paid ${shortDate(bill.last_paid_date)} · next ${shortDate(bill.next_date)}` : `Next ${shortDate(bill.next_date)}`;
    case 'paused':
      return 'Paused';
    case 'waiting':
      return `Due ${shortDate(bill.next_date)} · waiting for the bank`;
    case 'missed':
      return `Due ${shortDate(bill.next_date)} · not seen from the bank`;
    case 'overdue':
      return `Due ${shortDate(bill.next_date)} · not logged yet`;
    default:
      if (d === 0) return 'Due today';
      if (d === 1) return 'Due tomorrow';
      if (d > 1 && d <= 7) return `Due in ${d} days`;
      return `Due ${shortDate(bill.next_date)}`;
  }
}

/** This month's recurring figures as plain numbers, or null without an overview. */
export function monthFromOverview(overview: RecurringOverview | null | undefined): RecurringMonth | null {
  if (!overview) return null;
  return {
    expected: num(overview.expected_this_month),
    paid: num(overview.paid_this_month),
    remaining: num(overview.remaining_this_month),
  };
}

/** Share of this month's expected recurring cost already paid, 0–1. */
export function paidShare(overview: Pick<RecurringOverview, 'paid_this_month' | 'expected_this_month'>): number {
  const expected = num(overview.expected_this_month);
  if (expected <= 0) return 0;
  return Math.min(1, Math.max(0, num(overview.paid_this_month) / expected));
}

/** A fixed bill whose price rose, and by how much. Null when it has not. */
export function priceRise(bill: Pick<RecurringBill, 'previous_amount' | 'amount' | 'is_variable'>): number | null {
  if (bill.is_variable || bill.previous_amount == null) return null;
  const rise = Math.abs(num(bill.amount)) - Math.abs(num(bill.previous_amount));
  return rise > 0.005 ? rise : null;
}

/** Bills that need the user to do something, in the order to do it. */
export function needsAttention(overview: RecurringOverview): RecurringBill[] {
  const rank: Partial<Record<RecurringBillStatus, number>> = { missed: 0, overdue: 1, due_soon: 2 };
  return overview.groups
    .flatMap(g => g.bills)
    .filter(b => b.status in rank)
    .sort((a, b) => (rank[a.status]! - rank[b.status]!) || a.days_until - b.days_until);
}

/** `-15.49` with a variable flag → `~$15.49`. Never signed: context says which way. */
export const billAmount = (amount: string | number, isVariable: boolean, format: (n: number) => string): string =>
  `${isVariable ? '~' : ''}${format(Math.abs(num(amount)))}`;
