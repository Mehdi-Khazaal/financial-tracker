/**
 * Review-board layout.
 *
 * The board used to render every category as a full-size column in a three-row
 * grid that scrolled sideways, with a hand-built mirrored scrollbar to drive it.
 * With twenty categories that put most of the board off-screen behind the least
 * discoverable gesture on desktop, and gave a category with no activity exactly
 * as much room as the one holding half the month's spending.
 *
 * Splitting the categories is what makes a wrapping grid work: the ones with
 * activity earn a column, the ones without collapse into a single strip that is
 * still a drop target. Nothing is removed — an empty category is still there,
 * still droppable, just not occupying a card-sized hole.
 */

import type { Category, Transaction } from '../../../types';
import type { ClassificationContext } from '../../analytics/types';
import { categorySpendDelta, classifyTransaction } from '../../analytics/calculations/transactions';

export interface CategoryColumn {
  category: Category;
  transactions: Transaction[];
  count: number;
  /**
   * Net spend for an expense category, money received for an income category.
   * Refunds reduce the category they came from; card payments never count as
   * income. Same rules as every other total in the app.
   */
  total: number;
}

export interface BoardLayout {
  /** Categories with at least one transaction this month, in display order. */
  active: CategoryColumn[];
  /** Categories with nothing this month — still valid drop targets. */
  empty: Category[];
}

/** Net spend or income received for one category's transactions. */
export function categoryTotal(
  transactions: Transaction[],
  category: Category,
  ctx: ClassificationContext,
): number {
  if (category.type === 'income') {
    return transactions.reduce((sum, t) => (
      classifyTransaction(t, ctx) === 'income' ? sum + Number(t.amount) : sum
    ), 0);
  }
  return transactions.reduce(
    (sum, t) => sum + categorySpendDelta(t, classifyTransaction(t, ctx)),
    0,
  );
}

/**
 * Order: spending first, largest to smallest, then income the same way.
 *
 * Sorting purely by magnitude would interleave a big salary with the grocery
 * bill, which reads as a ranking of unlike things. Keeping the two kinds in
 * separate runs preserves what the number means while still answering "where
 * did most of it go" at a glance.
 */
export function buildBoard(
  categories: Category[],
  monthTransactions: Transaction[],
  ctx: ClassificationContext,
): BoardLayout {
  const byCategory = new Map<number, Transaction[]>();
  monthTransactions.forEach(tx => {
    if (tx.category_id == null) return;
    const bucket = byCategory.get(tx.category_id);
    if (bucket) bucket.push(tx);
    else byCategory.set(tx.category_id, [tx]);
  });

  const active: CategoryColumn[] = [];
  const empty: Category[] = [];

  categories.forEach(category => {
    const transactions = byCategory.get(category.id) ?? [];
    if (transactions.length === 0) {
      empty.push(category);
      return;
    }
    active.push({
      category,
      transactions,
      count: transactions.length,
      total: categoryTotal(transactions, category, ctx),
    });
  });

  active.sort((a, b) => {
    const kindA = a.category.type === 'expense' ? 0 : 1;
    const kindB = b.category.type === 'expense' ? 0 : 1;
    if (kindA !== kindB) return kindA - kindB;
    if (b.total !== a.total) return b.total - a.total;
    // A stable tiebreak keeps the board from reshuffling as totals change.
    return a.category.name.localeCompare(b.category.name);
  });

  // Alphabetical: with no activity to rank by, findability is the only order
  // that helps someone hunting for a specific drop target.
  empty.sort((a, b) => a.name.localeCompare(b.name));

  return { active, empty };
}
