/**
 * Transaction classification — the rule every other calculation defers to.
 *
 * Fintrack stores transfers in their own table, so money moved between the
 * user's own accounts never reaches this module. What *does* reach it and must
 * not be double-counted:
 *
 *   • Credit-card payments. Recorded as a positive amount on a `credit_card`
 *     account. The purchases that created the balance were already counted as
 *     expenses, so counting the payment as income would inflate both sides.
 *
 *   • Refunds. A positive amount filed under an *expense* category is money
 *     coming back out of that category, not new income. It nets against the
 *     category so "Groceries" shows what was actually spent.
 *
 *   • Asset purchases. Money filed under an `investment` category bought
 *     something you still hold — gold, a stock, a coin. It left the account but
 *     was not consumed, so counting it as spending overstates the month and
 *     drags the savings rate down for a purchase that cost nothing on net.
 *
 * The refund rule is checked first so a refund onto a credit card is treated
 * as a refund rather than a payment. The investment rule is checked before
 * *everything*, including the negative-amount shortcut, because a purchase is
 * negative and would otherwise exit as an expense before its category is ever
 * consulted. It answers for both directions: selling the gold is no more income
 * than buying it was spending.
 */

import type { Account, Category, Transaction } from '../../../types';
import type { ClassificationContext, TransactionKind } from '../types';

export function buildClassificationContext(
  accounts: Account[],
  categories: Category[],
): ClassificationContext {
  const accountTypeById = new Map<number, Account['type']>();
  accounts.forEach(a => accountTypeById.set(a.id, a.type));
  const categoryTypeById = new Map<number, Category['type']>();
  categories.forEach(c => categoryTypeById.set(c.id, c.type));
  return { accountTypeById, categoryTypeById };
}

export function classifyTransaction(
  tx: Transaction,
  ctx: ClassificationContext,
): TransactionKind {
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount) || amount === 0) return 'excluded';

  const categoryType = tx.category_id != null ? ctx.categoryTypeById.get(tx.category_id) : undefined;
  // Before the sign check: a purchase is negative and would exit as an expense.
  if (categoryType === 'investment') return 'investment';

  if (amount < 0) return 'expense';
  if (categoryType === 'expense') return 'refund';
  if (ctx.accountTypeById.get(tx.account_id) === 'credit_card') return 'card-payment';
  return 'income';
}

/**
 * Signed contribution of a transaction to a category's spend total.
 * Expenses add, refunds subtract, everything else is zero.
 */
export function categorySpendDelta(tx: Transaction, kind: TransactionKind): number {
  const amount = Number(tx.amount);
  if (kind === 'expense') return Math.abs(amount);
  if (kind === 'refund') return -Math.abs(amount);
  return 0;
}

/**
 * The label shown against a transaction anywhere in Analytics.
 *
 * Every row states what it was counted as, so a salary never reads as
 * anything but "Income". Transfers are absent by construction — Fintrack
 * stores them in their own table, so they never reach a transaction list.
 */
export const KIND_LABELS: Record<TransactionKind, string> = {
  income: 'Income',
  expense: 'Expense',
  refund: 'Refund',
  'card-payment': 'Card payment',
  investment: 'Investment',
  excluded: 'Not counted',
};

/** Semantic colour for a kind label. Expenses stay neutral — spending is not a verdict. */
export const KIND_COLORS: Record<TransactionKind, string> = {
  income: 'var(--pos)',
  expense: 'var(--muted)',
  refund: 'var(--pos)',
  'card-payment': 'var(--muted)',
  investment: 'var(--muted)',
  excluded: 'var(--dim)',
};

/** Human-readable explanation of a classification, for tooltips. */
export const KIND_EXPLANATIONS: Record<TransactionKind, string> = {
  income: 'Money received from outside your accounts.',
  expense: 'Money spent.',
  refund: 'Money returned into an expense category — subtracted from that category rather than counted as income.',
  'card-payment': 'A payment into a credit-card account — excluded, because the original purchases were already counted as spending.',
  investment: 'Money moved into or out of an asset you hold — excluded from spending, because it changed form rather than leaving.',
  excluded: 'Zero-value entry, not counted.',
};

/**
 * Legacy merchant normalisation — a *compatibility fallback*, not the rule.
 *
 * The authoritative implementation is `backend/services/merchants.py`, and its
 * answer arrives on each transaction as `merchant_key`. Prefer
 * `merchantIdentity` below, which uses the stored value and only falls back to
 * this function for rows written before the Phase 5A migration or not yet
 * reached by the backfill.
 *
 * This copy is deliberately frozen: it must not gain new rules. The two
 * implementations diverging is exactly the bug the stored key removes, so
 * improvements belong in the backend normalizer. Once the backfill has run and
 * no null keys remain, this can be deleted outright.
 */
const PLAID_PREFIX = /^\[plaid:[^\]]+\]\s*/;
const NOISE_TOKENS = /\b(purchase|pos|debit|credit|payment|pmt|autopay|recurring|online|web|mobile|card|visa|mc|mastercard|amex|check|chk|ach|xfer|transfer|deposit|withdrawal|fee|inc|llc|ltd|corp|co)\b/gi;
const LONG_DIGITS = /\d{3,}/g;
const PUNCT = /[^a-z0-9\s]/g;
const WHITESPACE = /\s+/g;

export function normalizeMerchantName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(PLAID_PREFIX, '')
    .toLowerCase()
    .replace(LONG_DIGITS, ' ')
    .replace(PUNCT, ' ')
    .replace(NOISE_TOKENS, ' ')
    .replace(WHITESPACE, ' ')
    .trim();
}

/**
 * The grouping key for a transaction's merchant, in precedence order:
 *
 *   1. `plaid_merchant_entity_id` — Plaid's stable id, prefixed so it can
 *      never collide with a normalized string.
 *   2. `merchant_key` — computed by the backend at write time.
 *   3. Local normalization of the description — legacy rows only.
 *
 * Every calculation that groups by merchant should use this rather than
 * calling `normalizeMerchantName` directly, so a row with a stored identity is
 * grouped by the backend's answer and not by a second opinion.
 */
export function merchantIdentity(tx: Transaction): string {
  if (tx.plaid_merchant_entity_id) return `plaid:${tx.plaid_merchant_entity_id}`;
  if (tx.merchant_key) return tx.merchant_key;
  return normalizeMerchantName(tx.description);
}

/**
 * The transaction's merchant as a *normalized string*, never an entity id.
 *
 * Declared `RecurringTransaction` rows carry only a description, so matching a
 * transaction to one has to happen in string space. The backend populates
 * `merchant_key` on every row it writes — including rows that also have an
 * entity id — so this stays comparable with `normalizeMerchantName(rec.description)`.
 */
export function merchantKeyOf(tx: Transaction): string {
  return tx.merchant_key || normalizeMerchantName(tx.description);
}

/** Display form of a merchant: title-cased, or the raw description if nothing survives. */
export function merchantDisplayName(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').replace(PLAID_PREFIX, '').trim();
  const key = normalizeMerchantName(raw);
  if (!key) return cleaned || 'Uncategorized';
  return key
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 60);
}

/** Median of a numeric list. Returns 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Percentage change from `previous` to `current`, or null when undefined. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Clamp to `[min, max]`. */
export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));
