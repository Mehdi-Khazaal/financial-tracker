import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../types';
import { EMPTY_FILTERS, applyTransactionFilters, matchesQuery } from './filters';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 1, user_id: 1, account_id: 1, category_id: null, amount: -10, description: 'x',
  transaction_date: '2026-03-01', created_at: '2026-03-01T00:00:00Z', ...over,
});

describe('matchesQuery', () => {
  it('matches the description, the Plaid merchant name and the merchant key, ignoring case', () => {
    expect(matchesQuery(tx({ description: 'NETFLIX.COM 866-579-7172' }), 'netflix')).toBe(true);
    expect(matchesQuery(tx({ description: 'CHECKCARD 0312', plaid_merchant_name: 'Netflix' }), 'NETFLIX')).toBe(true);
    expect(matchesQuery(tx({ description: 'ODD BANK STRING', merchant_key: 'netflix' }), 'netflix')).toBe(true);
    expect(matchesQuery(tx({ description: 'Spotify' }), 'netflix')).toBe(false);
  });

  it('treats an empty query as no filter', () => {
    expect(matchesQuery(tx({ description: null }), '   ')).toBe(true);
  });
});

describe('applyTransactionFilters', () => {
  const rows = [
    tx({ id: 1, description: 'NETFLIX', amount: -15.99, transaction_date: '2026-03-01', category_id: 5 }),
    tx({ id: 2, description: 'Netflix refund', amount: 15.99, transaction_date: '2026-03-05' }),
    tx({ id: 3, description: 'Salary', amount: 3000, transaction_date: '2026-03-02', account_id: 2 }),
  ];

  it('combines the query with the other filters and sorts newest first', () => {
    expect(applyTransactionFilters(rows, { ...EMPTY_FILTERS, query: 'netflix' }).map(t => t.id)).toEqual([2, 1]);
    expect(applyTransactionFilters(rows, { ...EMPTY_FILTERS, query: 'netflix', type: 'expense' }).map(t => t.id)).toEqual([1]);
    expect(applyTransactionFilters(rows, { ...EMPTY_FILTERS, category: 'none' }).map(t => t.id)).toEqual([2, 3]);
    expect(applyTransactionFilters(rows, { ...EMPTY_FILTERS, account: '2', amountMin: '1000' }).map(t => t.id)).toEqual([3]);
    expect(applyTransactionFilters(rows, { ...EMPTY_FILTERS, dateFrom: '2026-03-02', dateTo: '2026-03-04' }).map(t => t.id)).toEqual([3]);
  });
});
