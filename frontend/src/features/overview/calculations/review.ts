/**
 * Imported-transaction review progress.
 *
 * Scoped to the current month on purpose: the Review tab on Transactions works
 * a month at a time, so quoting an all-time figure here would send the user to
 * a screen showing a different number. Anything still unfiled from earlier
 * months is reported separately rather than folded in silently.
 */

import type { Transaction } from '../../../types';

export interface ImportReview {
  /** Transactions dated in the current month. */
  total: number;
  /** Of those, how many carry a category. */
  reviewed: number;
  /** Of those, how many do not. */
  unreviewed: number;
  /** 0–100. A month with no transactions is complete, not 0%. */
  rate: number;
  isComplete: boolean;
  /** Uncategorized transactions dated before the current month. */
  olderUnreviewed: number;
}

export function buildImportReview(
  transactions: Transaction[],
  month: string,
): ImportReview {
  let total = 0;
  let unreviewed = 0;
  let olderUnreviewed = 0;

  transactions.forEach(t => {
    const isCurrentMonth = t.transaction_date.slice(0, 7) === month;
    const filed = t.category_id != null;
    if (isCurrentMonth) {
      total += 1;
      if (!filed) unreviewed += 1;
    } else if (!filed && t.transaction_date.slice(0, 7) < month) {
      olderUnreviewed += 1;
    }
  });

  const reviewed = total - unreviewed;

  return {
    total,
    reviewed,
    unreviewed,
    // Nothing to review is a finished state, not an empty progress bar.
    rate: total === 0 ? 100 : Math.round((reviewed / total) * 100),
    isComplete: unreviewed === 0,
    olderUnreviewed,
  };
}
