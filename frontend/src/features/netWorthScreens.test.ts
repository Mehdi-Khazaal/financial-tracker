import { renderHook } from '@testing-library/react';
import type { Account, Asset, MonthSnapshot } from '../types';
import { useOverviewModel } from './overview/useOverviewModel';
import { useAnalyticsModel } from './analytics/useAnalyticsModel';
import { calculateNetWorth } from './portfolio/calculations/wealth';
import { marketValuations } from './portfolio/calculations/valuations.testing';

/**
 * The live account showed four net worths: $9,218.40 in the Overview hero,
 * $9,572.59 at the end of the charts, $29,948.40 "including holdings" on the
 * Dashboard and $29,791.93 on Portfolio. The two tabs also disagreed on the
 * twelve-month change (−$2,867.80 against −$2,513.61).
 *
 * This reproduces that account's shape and asserts the Overview hero, the
 * Overview chart, the Analytics tile and the Analytics chart all land on one
 * figure that includes holdings at the server's price.
 */

const TODAY = new Date(2026, 10, 10);

const account = (id: number, type: Account['type'], balance: number): Account => ({
  id, user_id: 1, name: `Account ${id}`, type, balance,
  credit_limit: type === 'credit_card' ? 2750 : null, currency: 'USD', created_at: '', updated_at: '',
});

const accounts = [
  account(47, 'checking', 693.28),
  account(48, 'savings', 4000.04),
  account(49, 'credit_card', -384.92),
  account(52, 'cash', 4910),
];

const gld: Asset = {
  id: 7, user_id: 1, name: 'GOLD (GLD)', type: 'stock', asset_class: 'investment',
  quantity: 3.0965, value_per_unit: 419.84, total_value: 1300.01, currency: 'USD',
  purchase_date: '2026-03-02', created_at: '', updated_at: '',
};
const ounces: Asset = {
  id: 8, user_id: 1, name: 'Gold Ounce', type: 'jewelry', asset_class: 'physical',
  quantity: 2, value_per_unit: 4000, total_value: 8000, currency: 'USD',
  purchase_date: '2026-10-14', created_at: '', updated_at: '',
};
const assets = [gld, ounces];
const valuations = marketValuations(assets, { GLD: 369.30 });

// The server's series, its last point written before today's activity.
const snapshots: MonthSnapshot[] = [
  { month: '2025-12', net_worth: 12086.20 },
  { month: '2026-10', net_worth: 15551.64 },
  { month: '2026-11', net_worth: 18872.60 },
];

const expected = calculateNetWorth(accounts, assets, valuations).total;

describe('one net worth on every screen', () => {
  it('includes holdings at the server price', () => {
    // 9,218.40 in accounts + 1,143.54 GLD + 8,000 recorded ounces.
    expect(expected).toBeCloseTo(18361.94, 2);
  });

  it('is the Overview hero and the end of its chart', () => {
    const { result } = renderHook(() => useOverviewModel({
      accounts, transactions: [], categories: [], goals: [], recurring: [],
      snapshots, assets, valuations, failedSources: [],
    }, TODAY));

    const { netWorth, netWorthParts, investments, physicalAssets } = result.current;
    expect(netWorth.current).toBeCloseTo(expected, 2);
    expect(netWorth.points[netWorth.points.length - 1].value).toBeCloseTo(expected, 2);
    expect(netWorthParts).toEqual({ accounts: expect.closeTo(9218.40, 2), holdings: expect.closeTo(9143.54, 2) });
    // The Investments tile shows the market value, not the recorded $1,300.01.
    expect(investments).toBeCloseTo(1143.54, 2);
    expect(physicalAssets).toBe(8000);
  });

  it('is the Analytics tile and the end of its chart, with the same change as Overview', () => {
    const overview = renderHook(() => useOverviewModel({
      accounts, transactions: [], categories: [], goals: [], recurring: [],
      snapshots, assets, valuations, failedSources: [],
    }, TODAY)).result.current;
    const analytics = renderHook(() => useAnalyticsModel(
      { transactions: [], categories: [], accounts, goals: [], recurring: [], snapshots, assets, valuations },
      { periodId: 'this-month', customMonth: '2026-11', netWorthWindow: 12 },
      TODAY,
    )).result.current;

    expect(analytics.currentNetWorth).toBeCloseTo(expected, 2);
    expect(analytics.netWorth.end).toBeCloseTo(expected, 2);
    expect(analytics.netWorth.change).toBeCloseTo(overview.netWorth.change, 2);
  });
});

describe('the Overview hero leaves goal money out of available to spend', () => {
  it('shows $693.28, not $5,603.28, when the cash account is set aside for a trip', () => {
    const goals = [{
      id: 2, user_id: 1, name: 'Summer 2027', target_amount: 20000, deadline: '2027-06-30', created_at: '',
      is_emergency_fund: false, current_amount: 4910,
      allocations: [{ id: 1, account_id: 52, account_name: 'Home', amount: 4910 }],
    }];
    const { result } = renderHook(() => useOverviewModel({
      accounts, transactions: [], categories: [], goals, recurring: [],
      snapshots, assets, valuations, failedSources: [],
    }, TODAY));

    expect(result.current.availableToSpend).toBeCloseTo(693.28, 2);
  });
});
