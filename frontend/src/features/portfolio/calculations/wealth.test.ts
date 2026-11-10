import type { Account, Asset, MonthSnapshot } from '../../../types';
import { calculateNetWorth, withCurrentNetWorth } from './wealth';
import { netWorthFromAccounts } from '../../accounts/calculations/totals';
import { marketValuations } from './valuations.testing';

/**
 * Net worth is account balances plus holdings, and it is one figure.
 *
 * Two regressions shaped these tests. Net worth used to be balances only, so
 * buying gold with cash read as losing the full price. And the chart's last
 * point came from a stored snapshot, so it could disagree with the number
 * printed above it ($9,572.59 against $9,218.40 on the live account).
 */

const account = (id: number, type: Account['type'], balance: number): Account => ({
  id, user_id: 1, name: `Account ${id}`, type, balance,
  credit_limit: null, currency: 'USD', created_at: '', updated_at: '',
});

const asset = (
  id: number,
  total_value: number,
  name = `Asset ${id}`,
  asset_class: Asset['asset_class'] = 'physical',
): Asset => ({
  id, user_id: 1, name, type: 'gold', asset_class,
  quantity: null, value_per_unit: null, total_value,
  currency: 'USD', purchase_date: null, created_at: '', updated_at: '',
});

const accounts = [
  account(1, 'checking', 4000),
  account(2, 'credit_card', -600),
  account(3, 'investment', 9000), // brokerage cash: its holdings are counted instead
];

describe('calculateNetWorth', () => {
  it('adds holdings to the account balances', () => {
    const worth = calculateNetWorth(accounts, [asset(1, 2000)]);

    expect(worth.accounts).toBe(netWorthFromAccounts(accounts));
    expect(worth.holdings).toBe(2000);
    expect(worth.total).toBe(3400 + 2000);
  });

  it('leaves investment-type account balances out', () => {
    const worth = calculateNetWorth(accounts, []);
    // 4000 − 600, with the 9000 investment account excluded.
    expect(worth.total).toBe(3400);
  });

  it('does not move when cash becomes an asset', () => {
    const before = calculateNetWorth([account(1, 'checking', 10000)], []);
    const after = calculateNetWorth([account(1, 'checking', 2000)], [asset(1, 8000)]);
    expect(after.total).toBe(before.total);
  });

  it('values a holding at the server price when there is one', () => {
    const holding = asset(1, 1300.01, 'GOLD (GLD)', 'investment');
    holding.quantity = 3.0965;
    const worth = calculateNetWorth([], [holding], marketValuations([holding], { GLD: 369.30 }));

    expect(worth.holdings).toBeCloseTo(1143.54, 2);
    expect(worth.pricedShare).toBe(1);
  });

  it('falls back to the recorded value without one', () => {
    const worth = calculateNetWorth([], [asset(1, 1500, 'Gold bar (GLD)', 'investment')]);
    expect(worth.holdings).toBe(1500);
    expect(worth.pricedShare).toBe(0);
  });

  it('counts physical and investment holdings alike', () => {
    const worth = calculateNetWorth([], [
      asset(1, 2000, 'Gold', 'physical'),
      asset(2, 3000, 'Fund', 'investment'),
    ]);
    expect(worth.holdings).toBe(5000);
    expect(worth.holdingCount).toBe(2);
  });

  it('reports no priced share when nothing is held', () => {
    const worth = calculateNetWorth(accounts, []);
    expect(worth.pricedShare).toBeNull();
    expect(worth.holdingCount).toBe(0);
  });
});

describe('withCurrentNetWorth', () => {
  const live = calculateNetWorth([account(1, 'checking', 9218.40)], [asset(1, 20573.53)]);
  const series: MonthSnapshot[] = [
    { month: '2026-10', net_worth: 26981.63, accounts: 6251.63, holdings: 20730 },
    { month: '2026-11', net_worth: 30145.94, accounts: 9572.59, holdings: 20573.35 },
  ];

  it('sets this month to the figure on screen', () => {
    const result = withCurrentNetWorth(series, live, '2026-11');

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ month: '2026-11', net_worth: live.total, accounts: 9218.40, holdings: 20573.53 });
    expect(result[0]).toBe(series[0]);
  });

  it('adds this month when the series stops short of it', () => {
    const result = withCurrentNetWorth(series.slice(0, 1), live, '2026-11');
    expect(result.map(p => p.month)).toEqual(['2026-10', '2026-11']);
  });

  it('leaves an empty series empty', () => {
    expect(withCurrentNetWorth([], live, '2026-11')).toEqual([]);
  });

  it('never rewrites a series that is ahead of the given month', () => {
    expect(withCurrentNetWorth(series, live, '2026-10')).toBe(series);
  });
});
