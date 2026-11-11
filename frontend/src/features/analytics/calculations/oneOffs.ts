/**
 * Big one-off spending, left out of a usual month.
 *
 * The goal plan funds goals from what a month keeps. As a plain average that
 * figure absorbed every large purchase: on the live ledger a $7,000
 * motorcycle, a $3,050 car repair and $10,510 of tuition pulled "you keep"
 * down to $783 a month, against about $1,935 in a typical month, and counted
 * tuition twice (once as past spending, again as the Education goal saving
 * for the next semester).
 *
 * A one-off is an expense of at least `ONE_OFF_MIN` that is not routine:
 * routine means the same merchant charged a similar amount (within
 * `SIMILAR_SHARE`) in at least `ROUTINE_OTHER_MONTHS` other months, like rent.
 * The user's own mark (`Transaction.one_off`) overrides the rule either way.
 *
 * Mirrors `services/one_offs.py`; the two must agree.
 */

import type { Transaction } from '../../../types';
import type { ClassificationContext } from '../types';
import { classifyTransaction, merchantKeyOf } from './transactions';

export const ONE_OFF_MIN = 1000;
const SIMILAR_SHARE = 0.25;
const ROUTINE_OTHER_MONTHS = 2;

export interface OneOff {
  transaction: Transaction;
  month: string;
  /** Amount spent, positive. */
  amount: number;
  /** True when the rule decided; false when the user marked it. */
  automatic: boolean;
}

/** What the rule alone says, ignoring the user's mark. */
function ruleSaysOneOff(
  tx: Transaction,
  amount: number,
  byMerchant: Map<string, { month: string; amount: number }[]>,
): boolean {
  if (amount < ONE_OFF_MIN) return false;
  const month = tx.transaction_date.slice(0, 7);
  const similarMonths = new Set(
    (byMerchant.get(merchantKeyOf(tx)) ?? [])
      .filter(o => o.month !== month && Math.abs(o.amount - amount) <= amount * SIMILAR_SHARE)
      .map(o => o.month),
  );
  return similarMonths.size < ROUTINE_OTHER_MONTHS;
}

function spendingByMerchant(transactions: Transaction[], ctx: ClassificationContext) {
  const spending = transactions
    .filter(tx => classifyTransaction(tx, ctx) === 'expense')
    .map(tx => ({ tx, amount: Math.abs(Number(tx.amount)) }));
  const byMerchant = new Map<string, { month: string; amount: number }[]>();
  spending.forEach(({ tx, amount }) => {
    const key = merchantKeyOf(tx);
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), { month: tx.transaction_date.slice(0, 7), amount }]);
  });
  return { spending, byMerchant };
}

/**
 * Every one-off among `transactions`, keyed by transaction id. Routine is
 * judged against the same list, so pass enough history for a monthly charge
 * to show up in other months.
 */
export function findOneOffs(transactions: Transaction[], ctx: ClassificationContext): Map<number, OneOff> {
  const { spending, byMerchant } = spendingByMerchant(transactions, ctx);
  const found = new Map<number, OneOff>();
  spending.forEach(({ tx, amount }) => {
    const marked = tx.one_off;
    const isOneOff = marked == null ? ruleSaysOneOff(tx, amount, byMerchant) : marked;
    if (isOneOff) found.set(tx.id, { transaction: tx, month: tx.transaction_date.slice(0, 7), amount, automatic: marked == null });
  });
  return found;
}

/**
 * Whether the rule, with no mark from the user, would call `tx` a one-off;
 * null when it is not spending at all. The edit form uses it to show the
 * current answer and to hand a transaction back to the rule.
 */
export function automaticOneOff(
  tx: Transaction,
  transactions: Transaction[],
  ctx: ClassificationContext,
): boolean | null {
  if (classifyTransaction(tx, ctx) !== 'expense') return null;
  const { byMerchant } = spendingByMerchant(transactions, ctx);
  return ruleSaysOneOff(tx, Math.abs(Number(tx.amount)), byMerchant);
}

export interface UsualMonth {
  /** Mean monthly kept over `months` with big one-offs added back. */
  usualMonthlySaved: number | null;
  /** One-offs in `months`, largest first. */
  oneOffs: OneOff[];
  /** Their total spread over `months`. */
  oneOffMonthly: number;
}

/**
 * What a usual month keeps: the plain average of `months` with the one-offs
 * in those months added back. Kept apart from `calculateSavingsMetrics` so
 * the Dashboard, which needs only the plain figure, does not load this.
 */
export function usualMonth(
  transactions: Transaction[],
  ctx: ClassificationContext,
  months: string[],
  averageMonthlySaved: number | null,
): UsualMonth {
  const inWindow = new Set(months);
  const oneOffs = Array.from(findOneOffs(transactions, ctx).values())
    .filter(o => inWindow.has(o.month))
    .sort((a, b) => b.amount - a.amount);
  const total = oneOffs.reduce((s, o) => s + o.amount, 0);
  const count = months.length;
  return {
    usualMonthlySaved: averageMonthlySaved != null && count > 0 ? averageMonthlySaved + total / count : null,
    oneOffs,
    oneOffMonthly: count > 0 ? total / count : 0,
  };
}
