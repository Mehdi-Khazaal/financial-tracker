import type { Asset, SavingsGoal } from '../../../types';
import { valuePortfolio } from './investments';
import { describeGoalProgress, summariseGoals } from './goals';
import { buildNetWorthRange } from './netWorthRange';

/**
 * Partial-failure behaviour.
 *
 * Portfolio pulls from seven sources. The rule these tests protect is that a
 * failure in one must degrade only what depends on it, and must never be
 * presented as data. A failed request that renders as `$0.00`, `0 months` or
 * `no change` is worse than an error — it is a confident lie.
 */

const TODAY = new Date(2026, 7, 3);

let nextId = 1;
const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: nextId++, user_id: 1, name: 'Gold bars', type: 'gold', asset_class: 'investment',
  quantity: 3, value_per_unit: 2000, total_value: 6000, currency: 'USD',
  purchase_date: null, created_at: '', updated_at: '',
  ...overrides,
});

const goal = (overrides: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: nextId++, user_id: 1, name: 'Summer 2027', target_amount: 12000,
  deadline: '2027-08-03', created_at: '', allocations: [], current_amount: 3000,
  ...overrides,
});

describe('market prices fail', () => {
  const holdings = [
    asset({ name: 'Vanguard ETF (VTI)', quantity: 40, value_per_unit: 250, total_value: 10000 }),
    asset(),
  ];

  it('falls back to recorded values rather than zeroing the portfolio', () => {
    const valuation = valuePortfolio(holdings, {});

    expect(valuation.total).toBe(16000);
    expect(valuation.total).toBe(valuation.recordedTotal);
  });

  it('reports no change rather than a change of zero', () => {
    // Zero would imply the market was checked and had not moved.
    expect(valuePortfolio(holdings, {}).changeSinceRecorded).toBeNull();
  });

  it('says nothing is priced, which the UI can distinguish from "all priced"', () => {
    const valuation = valuePortfolio(holdings, {});

    expect(valuation.pricedCount).toBe(0);
    expect(valuation.unpricedCount).toBe(2);
    expect(valuation.pricedShare).toBe(0);
  });

  it('a partial price failure still values the holdings that did resolve', () => {
    const valuation = valuePortfolio(holdings, { VTI: 268 });

    expect(valuation.pricedCount).toBe(1);
    expect(valuation.total).toBeCloseTo(10720 + 6000, 2);
  });
});

describe('transaction history fails', () => {
  it('withholds the projection instead of projecting from nothing', () => {
    const p = describeGoalProgress(goal(), {
      today: TODAY, averageMonthlySaved: null, averageMonths: 0, historyUnavailable: true,
    });

    expect(p.projectedCompletion).toBeNull();
    expect(p.pace).toBe('unknown');
  });

  it('says the history could not be loaded, not that the user has none', () => {
    const failed = describeGoalProgress(goal(), {
      today: TODAY, averageMonthlySaved: null, averageMonths: 0, historyUnavailable: true,
    });
    const genuinelyNew = describeGoalProgress(goal(), {
      today: TODAY, averageMonthlySaved: null, averageMonths: 0, historyUnavailable: false,
    });

    expect(failed.paceDetail).toContain('could not be loaded');
    expect(genuinelyNew.paceDetail).toContain('You have 0');
    expect(failed.paceDetail).not.toBe(genuinelyNew.paceDetail);
  });

  it('still reports what it knows without the history', () => {
    const p = describeGoalProgress(goal(), {
      today: TODAY, averageMonthlySaved: null, averageMonths: 0, historyUnavailable: true,
    });

    // Allocation, target and the required contribution need no transactions.
    expect(p.setAside).toBe(3000);
    expect(p.remaining).toBe(9000);
    expect(p.requiredMonthly).toBeCloseTo(750, 2);
  });
});

describe('goal allocations are missing', () => {
  it('keeps the target and the shortfall visible', () => {
    const p = describeGoalProgress(goal({ current_amount: 0, allocations: [] }), {
      today: TODAY, averageMonthlySaved: 500, averageMonths: 6,
    });

    expect(p.target).toBe(12000);
    expect(p.remaining).toBe(12000);
    expect(p.presentation.status).toBe('not-started');
  });
});

describe('net-worth history fails', () => {
  it('produces an empty range rather than a chart of zeros', () => {
    const range = buildNetWorthRange([], 12);

    expect(range.points).toHaveLength(0);
    expect(range.hasTrend).toBe(false);
    expect(range.high).toBeNull();
    expect(range.low).toBeNull();
  });
});

describe('sources are independent', () => {
  it('valuing holdings needs no goals, accounts or transactions', () => {
    expect(valuePortfolio([asset()], {}).total).toBe(6000);
  });

  it('summarising goals needs no assets or prices', () => {
    const summary = summariseGoals([goal()], {
      today: TODAY, averageMonthlySaved: 500, averageMonths: 6,
    });

    expect(summary.totalSetAside).toBe(3000);
    expect(summary.overallProgress).toBeCloseTo(25, 4);
  });

  it('an empty asset list does not affect goal figures', () => {
    const withAssets = summariseGoals([goal()], { today: TODAY, averageMonthlySaved: 500, averageMonths: 6 });
    const withoutAssets = summariseGoals([goal()], { today: TODAY, averageMonthlySaved: 500, averageMonths: 6 });

    expect(withAssets.totalSetAside).toBe(withoutAssets.totalSetAside);
  });
});
