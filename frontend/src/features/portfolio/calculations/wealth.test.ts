import type { Account, Asset } from '../../../types';
import { totalWealth } from './wealth';
import { netWorthFromAccounts } from '../../accounts/calculations/totals';

/**
 * Total wealth composes two existing definitions and must not restate either.
 * The load-bearing assertion is that `netWorth` still equals
 * `netWorthFromAccounts` exactly — if this figure ever starts recomputing it,
 * the dashboard and the stored snapshot series drift apart silently.
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
  account(3, 'investment', 9000), // outside net worth by definition
];

describe('totalWealth', () => {
  it('adds holdings to the unchanged net-worth definition', () => {
    const wealth = totalWealth(accounts, [asset(1, 2000)], {});

    expect(wealth.netWorth).toBe(netWorthFromAccounts(accounts));
    expect(wealth.portfolioValue).toBe(2000);
    expect(wealth.total).toBe(wealth.netWorth + 2000);
  });

  it('does not redefine net worth — brokerage balances stay out of it', () => {
    const wealth = totalWealth(accounts, [], {});
    // 4000 - 600, with the 9000 investment account excluded.
    expect(wealth.netWorth).toBe(3400);
    expect(wealth.total).toBe(3400);
  });

  it('falls back to recorded value when no price is supplied', () => {
    const wealth = totalWealth([], [asset(1, 1500, 'Gold bar (GLD)', 'investment')], {});
    expect(wealth.portfolioValue).toBe(1500);
    expect(wealth.pricedShare).toBe(0);
  });

  it('uses a live price when the ticker resolves', () => {
    const holding = asset(1, 1000, 'Vanguard ETF (VTI)', 'investment');
    holding.quantity = 10;
    const wealth = totalWealth([], [holding], { VTI: 150 });

    expect(wealth.portfolioValue).toBe(1500);
    expect(wealth.pricedShare).toBe(1);
  });

  it('reports no priced share on an empty portfolio', () => {
    const wealth = totalWealth(accounts, [], {});
    expect(wealth.pricedShare).toBeNull();
    expect(wealth.holdingCount).toBe(0);
  });

  it('counts physical and investment holdings alike', () => {
    const wealth = totalWealth([], [
      asset(1, 2000, 'Gold', 'physical'),
      asset(2, 3000, 'Fund', 'investment'),
    ], {});
    expect(wealth.portfolioValue).toBe(5000);
    expect(wealth.holdingCount).toBe(2);
  });

  it('defaults to an empty price map', () => {
    expect(totalWealth([], [asset(1, 700)]).total).toBe(700);
  });
});
