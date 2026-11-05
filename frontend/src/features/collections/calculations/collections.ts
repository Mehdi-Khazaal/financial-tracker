/**
 * Collections: a trip, a holiday, a house move — a named group of transactions.
 *
 * A collection never changes the money. Its transactions still count in their
 * categories and in every total; this module only adds them up in a second
 * way. The rules are the Analytics ones (`classifyTransaction`), and match the
 * server's `services/collections.py`, so the total on a collection card and
 * the total on its page are the same number:
 *
 *   • spending counts in, refunds come off it;
 *   • money received inside the collection (a friend paying you back) comes
 *     off the cost too;
 *   • card payments and investments do not count.
 */

import type { Category, Collection, Transaction } from '../../../types';
import type { ClassificationContext } from '../../analytics/types';
import {
  categorySpendDelta,
  classifyTransaction,
  expandSplits,
  merchantDisplayName,
  merchantIdentity,
} from '../../analytics/calculations/transactions';
import { daysBetween } from '../../analytics/period';
import { money, plural, relativeDays } from '../../analytics/format';

export interface CollectionTotals {
  /** Money spent. */
  spent: number;
  /** Refunds and money received. */
  returned: number;
  /** What it actually cost: `spent - returned`. */
  net: number;
  count: number;
}

export function collectionTotals(transactions: Transaction[], ctx: ClassificationContext): CollectionTotals {
  let spent = 0;
  let returned = 0;
  transactions.forEach(tx => {
    const kind = classifyTransaction(tx, ctx);
    const amount = Math.abs(Number(tx.amount));
    if (kind === 'expense') spent += amount;
    else if (kind === 'refund' || kind === 'income') returned += amount;
  });
  return { spent, returned, net: spent - returned, count: transactions.length };
}

/** The server's totals as numbers. */
export function serverTotals(collection: Collection): CollectionTotals {
  return {
    spent: Number(collection.totals.spent) || 0,
    returned: Number(collection.totals.returned) || 0,
    net: Number(collection.totals.net) || 0,
    count: collection.totals.count,
  };
}

export interface CategorySlice {
  id: number | null;
  name: string;
  color: string;
  amount: number;
  /** Of the positive total, 0..1. */
  share: number;
}

/** Net spending per category, biggest first. Split lines count per category. */
export function categoryBreakdown(
  transactions: Transaction[],
  categories: Category[],
  ctx: ClassificationContext,
): CategorySlice[] {
  const sums = new Map<number | null, number>();
  expandSplits(transactions).forEach(row => {
    const delta = categorySpendDelta(row, classifyTransaction(row, ctx));
    if (delta === 0) return;
    const key = row.category_id ?? null;
    sums.set(key, (sums.get(key) ?? 0) + delta);
  });
  const rows = Array.from(sums.entries()).filter(([, amount]) => amount > 0.005);
  const total = rows.reduce((sum, [, amount]) => sum + amount, 0);
  return rows
    .map(([id, amount]) => {
      const category = id == null ? undefined : categories.find(c => c.id === id);
      return {
        id,
        name: category?.name ?? 'Uncategorized',
        color: category?.color ?? 'var(--dim)',
        amount,
        share: total > 0 ? amount / total : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export interface DaySpend {
  date: string;
  amount: number;
}

/** Net spending per day that had any, oldest first. A day that only had refunds is left out. */
export function dailySpending(transactions: Transaction[], ctx: ClassificationContext): DaySpend[] {
  const days = new Map<string, number>();
  transactions.forEach(tx => {
    const delta = categorySpendDelta(tx, classifyTransaction(tx, ctx));
    if (delta === 0) return;
    days.set(tx.transaction_date, (days.get(tx.transaction_date) ?? 0) + delta);
  });
  return Array.from(days.entries())
    .filter(([, amount]) => amount > 0.005)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface MerchantSpend {
  key: string;
  name: string;
  amount: number;
  count: number;
}

/** Where the money went, by place. */
export function topMerchants(transactions: Transaction[], ctx: ClassificationContext, limit = 5): MerchantSpend[] {
  const merchants = new Map<string, MerchantSpend>();
  transactions.forEach(tx => {
    const delta = categorySpendDelta(tx, classifyTransaction(tx, ctx));
    if (delta === 0) return;
    const key = merchantIdentity(tx) || `tx:${tx.id}`;
    const entry = merchants.get(key) ?? { key, name: merchantDisplayName(tx.plaid_merchant_name || tx.description), amount: 0, count: 0 };
    entry.amount += delta;
    entry.count += 1;
    merchants.set(key, entry);
  });
  return Array.from(merchants.values())
    .filter(m => m.amount > 0.005)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// ── Dates and status ──────────────────────────────────────────────────────────

const shortDate = (iso: string, withYear: boolean): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', withYear
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric' });

/** "Nov 3 – 9", "Oct 30 – Nov 2", "From Nov 3", or "" when undated. */
export function dateRangeLabel(collection: Pick<Collection, 'start_date' | 'end_date'>, todayKey: string): string {
  const { start_date: start, end_date: end } = collection;
  if (!start) return '';
  const thisYear = todayKey.slice(0, 4);
  if (!end) return `From ${shortDate(start, start.slice(0, 4) !== thisYear)}`;
  if (start === end) return shortDate(start, start.slice(0, 4) !== thisYear);
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${shortDate(start, true)} – ${shortDate(end, true)}`;
  const withYear = start.slice(0, 4) !== thisYear;
  if (start.slice(0, 7) === end.slice(0, 7)) {
    const endDay = new Date(`${end}T00:00:00`).getDate();
    return `${shortDate(start, false)} – ${endDay}${withYear ? `, ${start.slice(0, 4)}` : ''}`;
  }
  return `${shortDate(start, false)} – ${shortDate(end, withYear)}`;
}

export type CollectionPhase = 'archived' | 'upcoming' | 'active' | 'ended' | 'undated';

export function collectionPhase(collection: Pick<Collection, 'start_date' | 'end_date' | 'is_archived'>, todayKey: string): CollectionPhase {
  if (collection.is_archived) return 'archived';
  if (!collection.start_date) return 'undated';
  if (collection.start_date > todayKey) return 'upcoming';
  if (collection.end_date && collection.end_date < todayKey) return 'ended';
  return 'active';
}

/** One short line about where the collection stands today. */
export function statusLabel(collection: Collection, todayKey: string): string {
  const phase = collectionPhase(collection, todayKey);
  if (phase === 'archived') return 'Archived';
  if (phase === 'undated') return plural(collection.totals.count, 'transaction');
  const start = collection.start_date as string;
  if (phase === 'upcoming') {
    const days = daysBetween(todayKey, start);
    return days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`;
  }
  if (phase === 'ended') {
    return `Ended ${relativeDays(daysBetween(todayKey, collection.end_date as string))}`;
  }
  const day = daysBetween(start, todayKey) + 1;
  if (!collection.end_date) return `Day ${day}`;
  return `Day ${day} of ${daysBetween(start, collection.end_date) + 1}`;
}

export interface BudgetProgress {
  budget: number;
  used: number;
  remaining: number;
  /** 0..100, capped for drawing. */
  percent: number;
  over: boolean;
}

export function budgetProgress(net: number, budget: string | null): BudgetProgress | null {
  const limit = Number(budget);
  if (!budget || !Number.isFinite(limit) || limit <= 0) return null;
  const used = Math.max(0, net);
  return {
    budget: limit,
    used,
    remaining: limit - used,
    percent: Math.min(100, (used / limit) * 100),
    over: used > limit,
  };
}

/** Running now or coming up, everything else, and archived — in the server's order. */
export function groupCollections(collections: Collection[], todayKey: string): {
  current: Collection[];
  other: Collection[];
  archived: Collection[];
} {
  const current: Collection[] = [];
  const other: Collection[] = [];
  const archived: Collection[] = [];
  collections.forEach(c => {
    const phase = collectionPhase(c, todayKey);
    if (phase === 'archived') archived.push(c);
    else if (phase === 'active' || phase === 'upcoming') current.push(c);
    else other.push(c);
  });
  return { current, other, archived };
}

/** Collections a transaction can be put in: not archived, plus any it is already in. */
export function pickableCollections(collections: Collection[], memberOf: number[] = []): Collection[] {
  return collections.filter(c => !c.is_archived || memberOf.includes(c.id));
}

/** "🚗 Ohio trip", or just the name. */
export const collectionLabel = (collection: Pick<Collection, 'name' | 'emoji'>): string =>
  collection.emoji ? `${collection.emoji} ${collection.name}` : collection.name;

export interface NetDisplay {
  /** "$717.52", or "+$5,221.70" when more came in than went out. */
  text: string;
  label: 'Net cost' | 'Net money in';
  /** Green when money came in; otherwise the caller's normal text color. */
  color: string | undefined;
}

/**
 * How to print a collection's net. `dollars` drops the sign, so a collection
 * holding more money in than out (a reimbursement that arrived) would read as
 * a cost of the same size.
 */
export function netDisplay(net: number): NetDisplay {
  if (net < -0.005) return { text: `+$${money(-net)}`, label: 'Net money in', color: 'var(--pos)' };
  return { text: `$${money(net)}`, label: 'Net cost', color: undefined };
}

/** A collection's own color, or the accent. */
export const collectionColor = (collection: Pick<Collection, 'color'>): string =>
  collection.color || 'var(--accent)';
