/**
 * Collections inside a period: what the Dashboard and Analytics show.
 *
 * Collections come and go — most months have none — so these return an empty
 * list when there is nothing to say, and the cards that use them hide.
 *
 * "Spent" here is spending minus refunds, the same thing Analytics calls
 * expenses, so a collection's share of a month's spending is a true share.
 */

import type { Collection, Transaction } from '../../../types';
import type { ClassificationContext } from '../../analytics/types';
import { categorySpendDelta, classifyTransaction } from '../../analytics/calculations/transactions';

export interface CollectionPeriodSpend {
  collection: Collection;
  spent: number;
  count: number;
}

/** Spending per collection among `transactions`, biggest first. Hidden collections excluded. */
export function periodCollectionSpending(
  transactions: Transaction[],
  collections: Collection[],
  ctx: ClassificationContext,
): CollectionPeriodSpend[] {
  if (collections.length === 0) return [];
  const byId = new Map(collections.map(c => [c.id, c]));
  const sums = new Map<number, CollectionPeriodSpend>();
  transactions.forEach(tx => {
    if (!tx.collection_ids || tx.collection_ids.length === 0) return;
    const delta = categorySpendDelta(tx, classifyTransaction(tx, ctx));
    tx.collection_ids.forEach(id => {
      const collection = byId.get(id);
      if (!collection) return;
      const entry = sums.get(id) ?? { collection, spent: 0, count: 0 };
      entry.spent += delta;
      entry.count += 1;
      sums.set(id, entry);
    });
  });
  return Array.from(sums.values())
    .filter(entry => entry.spent > 0.005)
    .sort((a, b) => b.spent - a.spent);
}

/**
 * Spending in any collection, each transaction counted once.
 *
 * A transaction can be in several collections, so their totals overlap and
 * must never be added together. This is the honest "how much went to
 * collections" figure.
 */
export function spendInCollections(transactions: Transaction[], ctx: ClassificationContext): number {
  return transactions.reduce((sum, tx) => (
    tx.collection_ids && tx.collection_ids.length > 0
      ? sum + categorySpendDelta(tx, classifyTransaction(tx, ctx))
      : sum
  ), 0);
}

/** Money received inside collections (paybacks, reimbursements), each transaction once. */
export function receivedInCollections(transactions: Transaction[], ctx: ClassificationContext): number {
  return transactions.reduce((sum, tx) => (
    tx.collection_ids && tx.collection_ids.length > 0 && classifyTransaction(tx, ctx) === 'income'
      ? sum + Math.abs(Number(tx.amount))
      : sum
  ), 0);
}

/** Transactions that are in no collection — the period "without collections". */
export const withoutCollections = (transactions: Transaction[]): Transaction[] =>
  transactions.filter(tx => !tx.collection_ids || tx.collection_ids.length === 0);

export interface DashboardCollection {
  collection: Collection;
  /** Spent in the current month. */
  monthSpent: number;
}

/**
 * The collections worth a line on the Dashboard today: running now, or with
 * spending this month. Archived ones never show. Running ones first.
 */
export function dashboardCollections(
  collections: Collection[],
  transactions: Transaction[],
  ctx: ClassificationContext,
  monthKey: string,
): DashboardCollection[] {
  const visible = collections.filter(c => !c.is_archived);
  if (visible.length === 0) return [];
  const thisMonth = transactions.filter(tx => tx.transaction_date.startsWith(monthKey));
  const spend = new Map(periodCollectionSpending(thisMonth, visible, ctx).map(e => [e.collection.id, e.spent]));
  return visible
    .filter(c => c.active || (spend.get(c.id) ?? 0) > 0)
    .map(collection => ({ collection, monthSpent: spend.get(collection.id) ?? 0 }))
    .sort((a, b) => Number(b.collection.active) - Number(a.collection.active) || b.monthSpent - a.monthSpent);
}
