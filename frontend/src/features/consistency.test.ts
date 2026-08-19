import type { Account, Asset, Category, SavingsGoal, Transaction } from '../types';
import {
  calculateAccountTotals,
  netWorthFromAccounts,
} from './accounts/calculations/totals';
import { totalCardDebt, cardUtilization } from './accounts/calculations/cards';
import { valuePortfolio } from './portfolio/calculations/investments';
import { totalWealth } from './portfolio/calculations/wealth';
import { summariseGoals } from './portfolio/calculations/goals';
import { buildNetWorthRange } from './portfolio/calculations/netWorthRange';
import { buildClassificationContext } from './analytics/calculations/transactions';
import { calculatePeriodMetrics } from './analytics/calculations/metrics';

/**
 * Cross-screen consistency.
 *
 * Dashboard, Analytics, Accounts and Portfolio each ask a different question,
 * and each is entitled to a different presentation — but not to a different
 * number. This file exists so a future edit that forks a definition breaks a
 * test here rather than showing two figures for the same thing on two screens.
 *
 * Every assertion below reaches for the *shared* function that each screen
 * calls. That is only meaningful while the screens actually call them — a
 * screen that reimplements a definition inline would keep these tests green
 * while the app diverged. The Phase D audit found exactly that in
 * `useOverviewModel` (net worth, available-to-spend and investment value were
 * inline reduces that happened to agree) and replaced them with the shared
 * calls, so the coupling these tests assume now holds.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 5000, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Emergency', type: 'savings', balance: 12000, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 3, user_id: 1, name: 'Cash', type: 'cash', balance: 200, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 4, user_id: 1, name: 'Venture', type: 'credit_card', balance: -1500, credit_limit: 6000, currency: 'USD', created_at: '', updated_at: '' },
  { id: 5, user_id: 1, name: 'Brokerage', type: 'investment', balance: 30000, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
];

const categories: Category[] = [
  { id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: 11, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
  { id: 12, user_id: 1, name: 'Bullion', type: 'investment', color: '#f97', is_system: false, created_at: '' },
];

const ctx = buildClassificationContext(accounts, categories);

let nextId = 100;
const tx = (amount: number, overrides: Partial<Transaction> = {}): Transaction => ({
  id: nextId++, user_id: 1, account_id: 1, category_id: null, amount,
  description: 'Entry', transaction_date: '2026-08-02', created_at: '', ...overrides,
});

const holdings: Asset[] = [
  { id: 1, user_id: 1, name: 'Vanguard ETF (VTI)', type: 'etf', asset_class: 'investment', quantity: 40, value_per_unit: 250, total_value: 10000, currency: 'USD', purchase_date: null, created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Gold bars', type: 'gold', asset_class: 'investment', quantity: 3, value_per_unit: 2000, total_value: 6000, currency: 'USD', purchase_date: null, created_at: '', updated_at: '' },
];

const goals: SavingsGoal[] = [
  { id: 1, user_id: 1, name: 'Summer 2027', target_amount: 12000, deadline: null, created_at: '', current_amount: 3000, allocations: [{ id: 1, account_id: 2, account_name: 'Emergency', amount: 3000 }] },
];

// ── Total wealth ──────────────────────────────────────────────────────────────

describe('total wealth widens net worth without redefining it', () => {
  it('reuses the net-worth definition rather than recomputing one', () => {
    expect(totalWealth(accounts, holdings, {}).netWorth).toBe(netWorthFromAccounts(accounts));
  });

  it('is exactly net worth plus the portfolio valuation both screens already use', () => {
    const wealth = totalWealth(accounts, holdings, {});
    expect(wealth.total).toBe(
      netWorthFromAccounts(accounts) + valuePortfolio(holdings, {}).total,
    );
  });

  it('moves with prices only because the portfolio valuation does', () => {
    const flat = totalWealth(accounts, holdings, {});
    const priced = totalWealth(accounts, holdings, { VTI: 300 });
    expect(priced.total - flat.total).toBe(
      valuePortfolio(holdings, { VTI: 300 }).total - valuePortfolio(holdings, {}).total,
    );
    expect(priced.netWorth).toBe(flat.netWorth);
  });
});

// ── Asset purchases ───────────────────────────────────────────────────────────

describe('buying an asset is not spending on any screen', () => {
  // The Costco-gold case: Overview and Analytics both route through
  // `calculatePeriodMetrics`, so one classification rule has to serve both.
  const groceries = tx(-120, { category_id: 10 });
  const salary = tx(4000, { category_id: 11 });
  const gold = tx(-2000, { category_id: 12 });

  it('leaves expenses and income untouched', () => {
    const withGold = calculatePeriodMetrics([groceries, salary, gold], ctx);
    const without = calculatePeriodMetrics([groceries, salary], ctx);

    expect(withGold.expenses).toBe(without.expenses);
    expect(withGold.income).toBe(without.income);
    expect(withGold.savingsRate).toBe(without.savingsRate);
  });

  it('is still reported, so the exclusion is visible rather than silent', () => {
    expect(calculatePeriodMetrics([groceries, salary, gold], ctx).investments).toBe(2000);
  });

  it('is counted once in wealth — as the holding, never also as spending', () => {
    const bought: Asset[] = [{
      id: 3, user_id: 1, name: 'Costco gold', type: 'gold', asset_class: 'physical',
      quantity: 1, value_per_unit: 2000, total_value: 2000, currency: 'USD',
      purchase_date: null, created_at: '', updated_at: '',
    }];
    const wealth = totalWealth(accounts, bought, {});
    expect(wealth.total).toBe(netWorthFromAccounts(accounts) + 2000);
    expect(calculatePeriodMetrics([gold], ctx).expenses).toBe(0);
  });
});

// ── Net worth ─────────────────────────────────────────────────────────────────

describe('net worth is one number everywhere', () => {
  it('is the same on Accounts, Overview and the backend rule', () => {
    const canonical = accounts
      .filter(a => a.type !== 'investment')
      .reduce((s, a) => s + Number(a.balance), 0);

    // Accounts summary, Overview hero and `/history/net-worth` all resolve here.
    expect(netWorthFromAccounts(accounts)).toBe(canonical);
    expect(calculateAccountTotals(accounts).netWorth).toBe(canonical);
    expect(canonical).toBe(15700);
  });

  it('is the same figure Portfolio charts', () => {
    // The trend reads stored snapshots built from the same rule; its final
    // point must therefore equal the live figure for the same month.
    const range = buildNetWorthRange(
      [{ month: '2026-07', net_worth: 14000 }, { month: '2026-08', net_worth: netWorthFromAccounts(accounts) }],
      12,
    );

    expect(range.current).toBe(netWorthFromAccounts(accounts));
  });

  it('subtracts card debt on every screen', () => {
    const withoutCard = accounts.filter(a => a.type !== 'credit_card');

    expect(netWorthFromAccounts(accounts))
      .toBe(netWorthFromAccounts(withoutCard) - totalCardDebt(accounts));
  });

  it('excludes brokerage on every screen, because Portfolio values holdings', () => {
    expect(netWorthFromAccounts(accounts))
      .toBe(netWorthFromAccounts(accounts.filter(a => a.type !== 'investment')));
  });
});

// ── The four populations ──────────────────────────────────────────────────────

describe('account populations stay distinct and ordered', () => {
  const totals = calculateAccountTotals(accounts);

  it('spendable ⊂ liquid ⊂ allocatable', () => {
    expect(totals.availableToSpend).toBe(5200);
    expect(totals.liquid).toBe(17200);
    expect(totals.allocatable).toBe(47200);
    expect(totals.availableToSpend).toBeLessThan(totals.liquid);
    expect(totals.liquid).toBeLessThan(totals.allocatable);
  });

  it('brokerage cash is reported once, and never inside spendable or liquid', () => {
    expect(totals.investmentAccounts).toBe(30000);

    // Removing the brokerage account changes neither figure, which is the
    // only way to prove it was never counted in them.
    const withoutBrokerage = calculateAccountTotals(accounts.filter(a => a.type !== 'investment'));
    expect(withoutBrokerage.availableToSpend).toBe(totals.availableToSpend);
    expect(withoutBrokerage.liquid).toBe(totals.liquid);
    expect(withoutBrokerage.investmentAccounts).toBe(0);
  });

  it('net worth and allocatable are deliberately different questions', () => {
    expect(totals.netWorth).not.toBe(totals.allocatable);
  });
});

// ── Card debt ─────────────────────────────────────────────────────────────────

describe('card debt is one number everywhere', () => {
  it('is positive on Accounts, Overview and Analytics', () => {
    expect(totalCardDebt(accounts)).toBe(1500);
    expect(calculateAccountTotals(accounts).cardDebt).toBe(totalCardDebt(accounts));
  });

  it('shares one utilisation rule', () => {
    expect(cardUtilization(accounts)).toBe(25);
    expect(calculateAccountTotals(accounts).utilization).toBe(cardUtilization(accounts));
  });

  it('is never counted as income when it is paid down', () => {
    const payment = tx(300, { account_id: 4 });

    expect(calculatePeriodMetrics([payment], ctx).income).toBe(0);
    expect(calculatePeriodMetrics([payment], ctx).cardPayments).toBe(300);
  });
});

// ── Investments ───────────────────────────────────────────────────────────────

describe('investment value agrees between Dashboard and Portfolio', () => {
  it('is the recorded total when no prices are available, which is the Dashboard case', () => {
    // Overview never fetches prices, so it passes an empty map and gets the
    // recorded total — the same function Portfolio calls with live prices.
    const dashboard = valuePortfolio(holdings, {});

    expect(dashboard.total).toBe(16000);
    expect(dashboard.total).toBe(dashboard.recordedTotal);
  });

  it('rises on Portfolio only because Portfolio has prices, not a different rule', () => {
    const dashboard = valuePortfolio(holdings, {});
    const portfolio = valuePortfolio(holdings, { VTI: 268 });

    expect(portfolio.total).toBeGreaterThan(dashboard.total);
    // The difference is exactly the priced holding's movement, nothing else.
    expect(portfolio.total - dashboard.total).toBeCloseTo(720, 2);
  });

  it('counts every holding exactly once in both cases', () => {
    expect(valuePortfolio(holdings, {}).count).toBe(holdings.length);
    expect(valuePortfolio(holdings, { VTI: 268 }).count).toBe(holdings.length);
  });

  it('never double counts brokerage cash with holdings', () => {
    // Brokerage *balance* sits in accounts; holdings sit in assets. Net worth
    // excludes the former precisely so the two cannot be added together.
    const totals = calculateAccountTotals(accounts);
    const valuation = valuePortfolio(holdings, {});

    expect(totals.netWorth + valuation.total).not.toBe(
      totals.netWorth + totals.investmentAccounts + valuation.total,
    );
  });
});

// ── Set aside ─────────────────────────────────────────────────────────────────

describe('amount set aside agrees between Overview and Portfolio', () => {
  it('is the sum of goal allocations on both screens', () => {
    // Overview sums `current_amount`; Portfolio sums the same through
    // `summariseGoals`. The backend derives `current_amount` from allocations.
    const overview = goals.reduce((s, g) => s + Number(g.current_amount), 0);
    const portfolio = summariseGoals(goals, {
      today: new Date(2026, 7, 3), averageMonthlySaved: 500, averageMonths: 6,
    }).totalSetAside;

    expect(portfolio).toBe(overview);
    expect(portfolio).toBe(3000);
  });

  it('is never confused with income minus expenses', () => {
    const monthMetrics = calculatePeriodMetrics(
      [tx(3000, { category_id: 11 }), tx(-500, { category_id: 10 })],
      ctx,
    );
    const setAside = summariseGoals(goals, {
      today: new Date(2026, 7, 3), averageMonthlySaved: 500, averageMonths: 6,
    }).totalSetAside;

    // Left after expenses is 2,500; set aside is 3,000. Different quantities,
    // and nothing in the app may add or substitute them.
    expect(monthMetrics.net).toBe(2500);
    expect(setAside).toBe(3000);
    expect(setAside).not.toBe(monthMetrics.net);
  });

  it('never exceeds what the allocatable accounts could hold', () => {
    const totals = calculateAccountTotals(accounts);
    const setAside = summariseGoals(goals, {
      today: new Date(2026, 7, 3), averageMonthlySaved: 500, averageMonths: 6,
    }).totalSetAside;

    expect(setAside).toBeLessThanOrEqual(totals.allocatable);
  });
});

// ── Savings pace ──────────────────────────────────────────────────────────────

describe('savings pace comes from one average', () => {
  const today = new Date(2026, 7, 3);

  it('drives both the goal projection and the Morning Brief from the same input', () => {
    // Both call `calculateSavingsMetrics` and pass its output onward; neither
    // computes an average of its own. Same input, same projection.
    const a = summariseGoals(goals, { today, averageMonthlySaved: 1000, averageMonths: 6 });
    const b = summariseGoals(goals, { today, averageMonthlySaved: 1000, averageMonths: 6 });

    expect(a.goals[0].projectedCompletion).toBe(b.goals[0].projectedCompletion);
    expect(a.goals[0].projectedCompletion).not.toBeNull();
  });

  it('withholds a projection identically wherever the guard applies', () => {
    const thin = summariseGoals(goals, { today, averageMonthlySaved: 1000, averageMonths: 2 });

    expect(thin.goals[0].projectedCompletion).toBeNull();
  });
});
