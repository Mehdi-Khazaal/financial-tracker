import type { Account, Category, Collection, Transaction } from '../../../types';
import { buildClassificationContext } from '../../analytics/calculations/transactions';
import {
  budgetProgress, categoryBreakdown, collectionColor, collectionLabel, collectionPhase, collectionTotals, netDisplay,
  dailySpending, dateRangeLabel, groupCollections, pickableCollections, serverTotals, statusLabel, topMerchants,
} from './collections';
import { dashboardCollections, periodCollectionSpending, receivedInCollections, spendInCollections, withoutCollections } from './periods';

const account = (id: number, type: Account['type']): Account => ({
  id, user_id: 1, name: `A${id}`, type, balance: 0, credit_limit: null, currency: 'USD', created_at: '', updated_at: '',
});
const category = (id: number, name: string, type: Category['type']): Category => ({
  id, user_id: 1, name, type, color: '#123456', is_system: false, created_at: '',
} as Category);
const tx = (id: number, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, user_id: 1, account_id: 1, category_id: 10, amount, description: `Place ${id}`,
  transaction_date: '2026-11-03', created_at: '', ...extra,
});
const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 1, name: 'Ohio trip', emoji: '🚗', color: null, note: null, start_date: null, end_date: null, budget: null,
  is_archived: false, created_at: null, active: false, suggestion_count: 0,
  totals: { spent: '0', returned: '0', net: '0', count: 0, first_date: null, last_date: null }, ...overrides,
});

const accounts = [account(1, 'checking'), account(2, 'credit_card')];
const categories = [category(10, 'Food', 'expense'), category(11, 'Fun', 'expense'), category(12, 'Gold', 'investment')];
const ctx = buildClassificationContext(accounts, categories);

describe('collection totals', () => {
  it('counts spending, takes refunds and paybacks off, ignores card payments and investments', () => {
    const rows = [
      tx(1, -120), tx(2, 20), tx(3, 30, { category_id: null }),
      tx(4, -500, { category_id: 12 }), tx(5, 100, { account_id: 2, category_id: null }),
    ];
    expect(collectionTotals(rows, ctx)).toEqual({ spent: 120, returned: 50, net: 70, count: 5 });
    expect(serverTotals(collection({ totals: { spent: '9.5', returned: '1', net: '8.5', count: 2, first_date: null, last_date: null } })))
      .toEqual({ spent: 9.5, returned: 1, net: 8.5, count: 2 });
  });

  it('breaks spending down by category, per split line', () => {
    const split = tx(1, -100, { splits: [
      { id: 1, category_id: 10, amount: '-60', note: null },
      { id: 2, category_id: 11, amount: '-40', note: null },
    ] });
    const rows = [split, tx(2, 10, { category_id: 11 }), tx(3, -5, { category_id: null })];
    const slices = categoryBreakdown(rows, categories, ctx);
    expect(slices.map(s => [s.name, s.amount])).toEqual([['Food', 60], ['Fun', 30], ['Uncategorized', 5]]);
    expect(slices[0].share).toBeCloseTo(60 / 95);
  });

  it('adds up days and places', () => {
    const rows = [
      tx(1, -10, { transaction_date: '2026-11-04', merchant_key: 'diner' }),
      tx(2, -15, { transaction_date: '2026-11-03', merchant_key: 'diner' }),
      tx(3, -40, { transaction_date: '2026-11-03', merchant_key: 'motel', description: 'MOTEL 6' }),
      tx(4, 100, { account_id: 2, category_id: null }),
      tx(5, 8, { transaction_date: '2026-10-21' }),
    ];
    expect(dailySpending(rows, ctx)).toEqual([{ date: '2026-11-03', amount: 55 }, { date: '2026-11-04', amount: 10 }]);
    const places = topMerchants(rows, ctx, 1);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ key: 'motel', amount: 40, count: 1 });
  });
});

describe('collection dates and status', () => {
  const today = '2026-11-05';

  it('labels date ranges', () => {
    expect(dateRangeLabel({ start_date: null, end_date: null }, today)).toBe('');
    expect(dateRangeLabel({ start_date: '2026-11-03', end_date: null }, today)).toBe('From Nov 3');
    expect(dateRangeLabel({ start_date: '2026-11-03', end_date: '2026-11-03' }, today)).toBe('Nov 3');
    expect(dateRangeLabel({ start_date: '2026-11-03', end_date: '2026-11-09' }, today)).toBe('Nov 3 – 9');
    expect(dateRangeLabel({ start_date: '2026-10-30', end_date: '2026-11-02' }, today)).toBe('Oct 30 – Nov 2');
    expect(dateRangeLabel({ start_date: '2025-07-01', end_date: '2025-07-04' }, today)).toBe('Jul 1 – 4, 2025');
    expect(dateRangeLabel({ start_date: '2026-12-28', end_date: '2027-01-03' }, today)).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('works out the phase and a one-line status', () => {
    expect(collectionPhase(collection({ is_archived: true }), today)).toBe('archived');
    expect(statusLabel(collection({ is_archived: true }), today)).toBe('Archived');
    expect(statusLabel(collection({ totals: { ...collection().totals, count: 3 } }), today)).toBe('3 transactions');
    expect(statusLabel(collection({ start_date: '2026-11-06' }), today)).toBe('Starts tomorrow');
    expect(statusLabel(collection({ start_date: '2026-11-08' }), today)).toBe('Starts in 3 days');
    expect(statusLabel(collection({ start_date: '2026-11-01', end_date: '2026-11-03' }), today)).toBe('Ended 2 days ago');
    expect(statusLabel(collection({ start_date: '2026-11-03' }), today)).toBe('Day 3');
    expect(statusLabel(collection({ start_date: '2026-11-03', end_date: '2026-11-09' }), today)).toBe('Day 3 of 7');
  });

  it('measures the budget', () => {
    expect(budgetProgress(50, null)).toBeNull();
    expect(budgetProgress(50, '0')).toBeNull();
    expect(budgetProgress(50, '200')).toEqual({ budget: 200, used: 50, remaining: 150, percent: 25, over: false });
    expect(budgetProgress(250, '200')).toMatchObject({ percent: 100, over: true, remaining: -50 });
  });

  it('groups, filters and labels collections', () => {
    const list = [
      collection({ id: 1, start_date: '2026-11-03' }),
      collection({ id: 2 }),
      collection({ id: 3, is_archived: true }),
      collection({ id: 4, start_date: '2026-12-01' }),
    ];
    const groups = groupCollections(list, today);
    expect(groups.current.map(c => c.id)).toEqual([1, 4]);
    expect(groups.other.map(c => c.id)).toEqual([2]);
    expect(groups.archived.map(c => c.id)).toEqual([3]);
    expect(pickableCollections(list).map(c => c.id)).toEqual([1, 2, 4]);
    expect(pickableCollections(list, [3]).map(c => c.id)).toEqual([1, 2, 3, 4]);
    expect(collectionLabel(collection())).toBe('🚗 Ohio trip');
    expect(collectionLabel(collection({ emoji: null }))).toBe('Ohio trip');
    expect(collectionColor(collection())).toBe('var(--accent)');
    expect(collectionColor(collection({ color: '#ff0000' }))).toBe('#ff0000');
  });
});

describe('collections in a period', () => {
  const trip = collection({ id: 1, active: true });
  const move = collection({ id: 2, name: 'Move' });
  const hidden = collection({ id: 3, name: 'Old', is_archived: true });

  it('adds up spending per collection and can leave them out', () => {
    const rows = [
      tx(1, -100, { collection_ids: [1, 2] }), tx(2, 25, { collection_ids: [1] }),
      tx(3, -40, { collection_ids: [2] }), tx(4, -7), tx(5, -9, { collection_ids: [99] }),
    ];
    const spend = periodCollectionSpending(rows, [trip, move], ctx);
    expect(spend.map(s => [s.collection.id, s.spent, s.count])).toEqual([[2, 140, 2], [1, 75, 2]]);
    expect(periodCollectionSpending(rows, [], ctx)).toEqual([]);
    expect(withoutCollections(rows).map(r => r.id)).toEqual([4]);
    // Collections overlap: the $100 in both counts once.
    expect(spendInCollections(rows, ctx)).toBe(100 - 25 + 40 + 9);
    // The +25 is a refund (expense category), not money received.
    expect(receivedInCollections(rows, ctx)).toBe(0);
    expect(receivedInCollections([tx(9, 60, { category_id: null, collection_ids: [1, 2] })], ctx)).toBe(60);
  });

  it('shows running collections and ones with spending this month on the dashboard', () => {
    const rows = [
      tx(1, -30, { collection_ids: [2], transaction_date: '2026-11-02' }),
      tx(2, -99, { collection_ids: [3], transaction_date: '2026-11-02' }),
      tx(3, -50, { collection_ids: [2], transaction_date: '2026-10-02' }),
    ];
    const items = dashboardCollections([move, hidden, trip], rows, ctx, '2026-11');
    expect(items.map(i => [i.collection.id, i.monthSpent])).toEqual([[1, 0], [2, 30]]);
    expect(dashboardCollections([hidden], rows, ctx, '2026-11')).toEqual([]);
  });
});

describe('net display', () => {
  it('shows a cost, or money in with a plus when more came back than went out', () => {
    expect(netDisplay(717.52)).toEqual({ text: '$717.52', label: 'Net cost', color: undefined });
    expect(netDisplay(0)).toEqual({ text: '$0.00', label: 'Net cost', color: undefined });
    expect(netDisplay(-5221.7)).toEqual({ text: '+$5,221.70', label: 'Net money in', color: 'var(--pos)' });
  });
});
