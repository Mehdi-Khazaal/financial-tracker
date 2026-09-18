import type { Transaction } from '../../../types';

/**
 * The timeline's filters, applied in memory.
 *
 * The page holds the whole ledger, so filtering here is instant and the
 * server's own `search`/`uncategorized` parameters are for API consumers
 * and the assistant. Both sides match the same fields — the description,
 * Plaid's merchant name, and the normalised merchant key — so "netflix"
 * finds the same rows whichever path asks.
 */
export interface TransactionFilters {
  dateFrom: string;
  dateTo: string;
  /** Account id as a string, or '' for any. */
  account: string;
  /** Category id as a string, 'none' for uncategorised, or '' for any. */
  category: string;
  type: 'all' | 'income' | 'expense';
  amountMin: string;
  amountMax: string;
  query: string;
}

export const EMPTY_FILTERS: TransactionFilters = {
  dateFrom: '', dateTo: '', account: '', category: '', type: 'all', amountMin: '', amountMax: '', query: '',
};

const haystack = (t: Transaction): string =>
  [t.description, t.plaid_merchant_name, t.merchant_key]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
    .toLowerCase();

/** Case-insensitive substring over description and merchant fields. */
export const matchesQuery = (t: Transaction, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack(t).includes(needle);
};

export const matchesFilters = (t: Transaction, f: TransactionFilters): boolean => {
  if (f.dateFrom && t.transaction_date < f.dateFrom) return false;
  if (f.dateTo && t.transaction_date > f.dateTo) return false;
  if (f.account && t.account_id !== parseInt(f.account, 10)) return false;
  if (f.category) {
    if (f.category === 'none') { if (t.category_id !== null) return false; }
    else if (t.category_id !== parseInt(f.category, 10)) return false;
  }
  if (f.type === 'income' && Number(t.amount) <= 0) return false;
  if (f.type === 'expense' && Number(t.amount) >= 0) return false;
  if (f.amountMin && Math.abs(Number(t.amount)) < parseFloat(f.amountMin)) return false;
  if (f.amountMax && Math.abs(Number(t.amount)) > parseFloat(f.amountMax)) return false;
  return matchesQuery(t, f.query);
};

/** Filtered and newest first. */
export const applyTransactionFilters = (transactions: Transaction[], f: TransactionFilters): Transaction[] =>
  transactions
    .filter(t => matchesFilters(t, f))
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
