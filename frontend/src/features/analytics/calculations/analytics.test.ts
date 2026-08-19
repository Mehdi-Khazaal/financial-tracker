import type { Account, Category, RecurringTransaction, SavingsGoal, Transaction } from '../../../types';
import {
  buildClassificationContext,
  classifyTransaction,
  normalizeMerchantName,
  pctChange,
} from './transactions';
import {
  calculatePeriodMetrics, investedInYear, monthlyMetrics, transactionsInRange,
} from './metrics';
import { calculateCategoryComparisons } from './categories';
import { calculateSavingsMetrics, selectPrimaryGoal } from './savings';
import { calculateNetWorthChange } from './netWorth';
import { buildCashFlow } from './cashflow';
import {
  buildRecurringOutlook, detectRecurringTransactions, groupRecurringCharges,
  monthlyEquivalent, monthlyRecurringExpense,
} from './recurring';
import { KIND_LABELS } from './transactions';
import { percentagePoints, plural, pluralize, rateTransition } from '../format';
import { calculateFinancialHealth } from './health';
import { calculateForecast } from './forecast';
import { baselineMonths, resolvePeriod } from '../period';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHECKING = 1;
const CARD = 2;
const GROCERIES = 10;
const SALARY = 11;
const FUEL = 12;
const BULLION = 13;

const accounts: Account[] = [
  { id: CHECKING, user_id: 1, name: 'Everyday', type: 'checking', balance: 4000, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: CARD, user_id: 1, name: 'Rewards Card', type: 'credit_card', balance: -600, credit_limit: 3000, currency: 'USD', created_at: '', updated_at: '' },
];

const categories: Category[] = [
  { id: GROCERIES, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: SALARY, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
  { id: FUEL, user_id: 1, name: 'Fuel', type: 'expense', color: '#11e', is_system: false, created_at: '' },
  { id: BULLION, user_id: 1, name: 'Bullion', type: 'investment', color: '#f97', is_system: false, created_at: '' },
];

let nextId = 100;
const tx = (
  transaction_date: string,
  amount: number,
  category_id: number | null = null,
  account_id: number = CHECKING,
  description = 'Test',
): Transaction => ({
  id: nextId++,
  user_id: 1,
  account_id,
  category_id,
  amount,
  description,
  transaction_date,
  created_at: '',
});

const ctx = buildClassificationContext(accounts, categories);
const TODAY = new Date(2026, 6, 18); // 18 July 2026, local

const period = (id: Parameters<typeof resolvePeriod>[0], customMonth = '2026-07') =>
  resolvePeriod(id, { today: TODAY, customMonth, earliestMonth: '2025-08' });

// ── Classification ────────────────────────────────────────────────────────────

describe('transaction classification', () => {
  it('treats a positive amount with no category as income', () => {
    expect(classifyTransaction(tx('2026-07-01', 3000), ctx)).toBe('income');
  });

  it('treats a negative amount as an expense', () => {
    expect(classifyTransaction(tx('2026-07-02', -50, GROCERIES), ctx)).toBe('expense');
  });

  it('treats a positive amount in an expense category as a refund, not income', () => {
    expect(classifyTransaction(tx('2026-07-03', 20, GROCERIES), ctx)).toBe('refund');
  });

  it('excludes a payment into a credit-card account', () => {
    expect(classifyTransaction(tx('2026-07-04', 400, null, CARD), ctx)).toBe('card-payment');
  });

  it('classifies a refund onto a card as a refund rather than a payment', () => {
    expect(classifyTransaction(tx('2026-07-05', 30, GROCERIES, CARD), ctx)).toBe('refund');
  });

  it('ignores zero-value rows', () => {
    expect(classifyTransaction(tx('2026-07-06', 0), ctx)).toBe('excluded');
  });

  // Buying an ounce of gold is negative, so it would exit as an expense if the
  // category were consulted after the sign — which is why it is consulted first.
  it('treats a purchase in an investment category as an investment, not an expense', () => {
    expect(classifyTransaction(tx('2026-07-07', -2000, BULLION), ctx)).toBe('investment');
  });

  it('treats a sale out of an investment category as an investment, not income', () => {
    expect(classifyTransaction(tx('2026-07-08', 2100, BULLION), ctx)).toBe('investment');
  });

  it('does not mistake an investment sale for a refund', () => {
    expect(classifyTransaction(tx('2026-07-09', 500, BULLION), ctx)).not.toBe('refund');
  });

  it('classifies an investment bought on a card as an investment, not a card payment', () => {
    expect(classifyTransaction(tx('2026-07-10', 800, BULLION, CARD), ctx)).toBe('investment');
  });
});

// ── Investments are held, not spent ───────────────────────────────────────────

describe('investment purchases are kept out of spending', () => {
  it('counts toward neither expenses nor income', () => {
    const metrics = calculatePeriodMetrics([
      tx('2026-07-02', -50, GROCERIES),
      tx('2026-07-03', 3000, SALARY),
      tx('2026-07-04', -2000, BULLION),
    ], ctx);

    expect(metrics.expenses).toBe(50);
    expect(metrics.grossExpenses).toBe(50);
    expect(metrics.income).toBe(3000);
    expect(metrics.investments).toBe(2000);
  });

  it('leaves the savings rate untouched', () => {
    const withoutGold = calculatePeriodMetrics([
      tx('2026-07-02', -50, GROCERIES),
      tx('2026-07-03', 3000, SALARY),
    ], ctx);
    const withGold = calculatePeriodMetrics([
      tx('2026-07-02', -50, GROCERIES),
      tx('2026-07-03', 3000, SALARY),
      tx('2026-07-04', -2000, BULLION),
    ], ctx);

    expect(withGold.savingsRate).toBe(withoutGold.savingsRate);
    expect(withGold.net).toBe(withoutGold.net);
  });

  it('nets a sale back down against a purchase', () => {
    const metrics = calculatePeriodMetrics([
      tx('2026-07-04', -2000, BULLION),
      tx('2026-07-20', 500, BULLION),
    ], ctx);
    expect(metrics.investments).toBe(1500);
  });

  it('tracks the year as a running total, across months', () => {
    const invested = investedInYear([
      tx('2026-02-10', -1000, BULLION),
      tx('2026-07-04', -2000, BULLION),
      tx('2026-11-01', -500, BULLION),
    ], ctx, TODAY);
    expect(invested).toBe(3500);
  });

  it('counts only the year asked for', () => {
    const transactions = [
      tx('2025-12-31', -900, BULLION),
      tx('2026-01-01', -100, BULLION),
      tx('2027-01-01', -700, BULLION),
    ];
    expect(investedInYear(transactions, ctx, TODAY)).toBe(100);
    expect(investedInYear(transactions, ctx, new Date(2025, 5, 1))).toBe(900);
  });

  it('nets a sale against the year total rather than ignoring it', () => {
    expect(investedInYear([
      tx('2026-03-01', -2000, BULLION),
      tx('2026-09-01', 800, BULLION),
    ], ctx, TODAY)).toBe(1200);
  });

  it('is zero when nothing was filed as an investment', () => {
    expect(investedInYear([
      tx('2026-03-01', -2000, GROCERIES),
      tx('2026-03-02', 4000, SALARY),
    ], ctx, TODAY)).toBe(0);
  });

  it('never counts an investment purchase as the largest expense', () => {
    const metrics = calculatePeriodMetrics([
      tx('2026-07-02', -50, GROCERIES),
      tx('2026-07-04', -2000, BULLION),
    ], ctx);
    expect(metrics.largestExpense?.category_id).toBe(GROCERIES);
  });
});

// ── Period metrics ────────────────────────────────────────────────────────────

describe('calculatePeriodMetrics', () => {
  it('computes income, expenses and savings from a mixed set', () => {
    const metrics = calculatePeriodMetrics([
      tx('2026-07-01', 4000, SALARY),
      tx('2026-07-02', -1000, GROCERIES),
      tx('2026-07-03', -200, FUEL),
    ], ctx);

    expect(metrics.income).toBe(4000);
    expect(metrics.expenses).toBe(1200);
    expect(metrics.net).toBe(2800);
    expect(metrics.savingsRate).toBeCloseTo(0.7, 5);
  });

  it('subtracts refunds from spending instead of adding them to income', () => {
    const metrics = calculatePeriodMetrics([
      tx('2026-07-01', 1000, SALARY),
      tx('2026-07-02', -300, GROCERIES),
      tx('2026-07-03', 100, GROCERIES), // returned items
    ], ctx);

    expect(metrics.income).toBe(1000);
    expect(metrics.grossExpenses).toBe(300);
    expect(metrics.refunds).toBe(100);
    expect(metrics.expenses).toBe(200);
    expect(metrics.net).toBe(800);
  });

  it('excludes credit-card payments from income so spending is not double counted', () => {
    const metrics = calculatePeriodMetrics([
      tx('2026-07-01', 2000, SALARY),
      tx('2026-07-02', -500, GROCERIES, CARD),
      tx('2026-07-10', 500, null, CARD), // paying the card off
    ], ctx);

    expect(metrics.income).toBe(2000);
    expect(metrics.expenses).toBe(500);
    expect(metrics.cardPayments).toBe(500);
    expect(metrics.net).toBe(1500);
  });

  it('never reports negative spending when refunds exceed purchases', () => {
    const metrics = calculatePeriodMetrics([
      tx('2026-07-01', 500, SALARY),
      tx('2026-07-02', -100, GROCERIES),
      tx('2026-07-03', 400, GROCERIES),
    ], ctx);

    expect(metrics.expenses).toBe(0);
    expect(metrics.savingsRate).toBeLessThanOrEqual(1);
  });

  it('returns a null savings rate when there is no income', () => {
    const metrics = calculatePeriodMetrics([tx('2026-07-02', -100, GROCERIES)], ctx);
    expect(metrics.income).toBe(0);
    expect(metrics.savingsRate).toBeNull();
  });

  it('counts uncategorized spending separately', () => {
    const metrics = calculatePeriodMetrics([
      tx('2026-07-02', -80),
      tx('2026-07-03', -20, GROCERIES),
    ], ctx);
    expect(metrics.uncategorizedCount).toBe(1);
    expect(metrics.uncategorizedSpend).toBe(80);
  });

  it('handles an empty period without dividing by zero', () => {
    const metrics = calculatePeriodMetrics([], ctx);
    expect(metrics.net).toBe(0);
    expect(metrics.savingsRate).toBeNull();
    expect(metrics.largestExpense).toBeNull();
  });
});

// ── Percentage change ─────────────────────────────────────────────────────────

describe('pctChange', () => {
  it('returns null when the previous value is zero', () => {
    expect(pctChange(500, 0)).toBeNull();
  });

  it('computes a normal change', () => {
    expect(pctChange(150, 100)).toBeCloseTo(0.5, 5);
  });

  it('uses the magnitude of a negative baseline so direction is not inverted', () => {
    expect(pctChange(-50, -100)).toBeCloseTo(0.5, 5);
  });
});

// ── Period resolution ─────────────────────────────────────────────────────────

describe('resolvePeriod', () => {
  it('resolves this month with the previous month as its comparison', () => {
    const p = period('this-month');
    expect(p.months).toEqual(['2026-07']);
    expect(p.start).toBe('2026-07-01');
    expect(p.end).toBe('2026-07-31');
    expect(p.previous?.months).toEqual(['2026-06']);
    expect(p.isIncomplete).toBe(true);
    expect(p.daysElapsed).toBe(18);
    expect(p.daysTotal).toBe(31);
  });

  it('compares a three-month range against the three months before it', () => {
    const p = period('last-3');
    expect(p.months).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(p.previous?.months).toEqual(['2026-02', '2026-03', '2026-04']);
  });

  it('gives all-time no comparison range', () => {
    expect(period('all-time').previous).toBeNull();
  });

  it('treats a past custom month as complete', () => {
    const p = period('custom', '2026-03');
    expect(p.isIncomplete).toBe(false);
    expect(p.elapsed).toBe(1);
  });
});

describe('baselineMonths', () => {
  const available = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

  it('excludes the month in progress so averages are not dragged down', () => {
    const baseline = baselineMonths(period('this-month'), available, TODAY);
    expect(baseline).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    expect(baseline).not.toContain('2026-07');
  });

  it('excludes months inside the selected period', () => {
    const baseline = baselineMonths(period('last-3'), available, TODAY);
    expect(baseline).toEqual(['2026-03', '2026-04']);
  });

  it('returns nothing when there is no earlier history', () => {
    expect(baselineMonths(period('custom', '2026-03'), available, TODAY)).toEqual([]);
  });
});

// ── Category comparisons ──────────────────────────────────────────────────────

describe('calculateCategoryComparisons', () => {
  const transactions = [
    // Baseline: four completed months at 100/month on groceries.
    tx('2026-03-05', -100, GROCERIES),
    tx('2026-04-05', -100, GROCERIES),
    tx('2026-05-05', -100, GROCERIES),
    tx('2026-06-05', -100, GROCERIES),
    // Selected month
    tx('2026-07-05', -250, GROCERIES),
    tx('2026-07-06', -50, FUEL),
  ];

  const rows = calculateCategoryComparisons({
    transactions,
    categories,
    period: period('this-month'),
    baseline: ['2026-03', '2026-04', '2026-05', '2026-06'],
    ctx,
  });

  it('compares against both the previous month and the average', () => {
    const groceries = rows.find(r => r.id === GROCERIES)!;
    expect(groceries.current).toBe(250);
    expect(groceries.previous).toBe(100);
    expect(groceries.average).toBe(100);
    expect(groceries.deltaVsAverage).toBe(150);
    expect(groceries.baselineMonths).toBe(4);
    expect(groceries.confidence).toBe('medium');
  });

  it('scales the monthly average up for multi-month ranges', () => {
    const multi = calculateCategoryComparisons({
      transactions,
      categories,
      period: period('last-3'),
      baseline: ['2026-03', '2026-04'],
      ctx,
    });
    const groceries = multi.find(r => r.id === GROCERIES)!;
    // 100/month across a three-month range.
    expect(groceries.average).toBe(300);
  });

  it('flags a rise driven by one large purchase so it is not framed as a habit', () => {
    const oneOff = calculateCategoryComparisons({
      transactions: [
        tx('2026-03-05', -50, FUEL),
        tx('2026-04-05', -50, FUEL),
        tx('2026-05-05', -50, FUEL),
        tx('2026-07-05', -900, FUEL, CHECKING, 'Motorcycle deposit'),
      ],
      categories,
      period: period('this-month'),
      baseline: ['2026-03', '2026-04', '2026-05'],
      ctx,
    });
    expect(oneOff.find(r => r.id === FUEL)!.drivenByOneTransaction).toBe(true);
  });

  it('reports zero average and no confidence when there is no history', () => {
    const fresh = calculateCategoryComparisons({
      transactions: [tx('2026-07-05', -80, GROCERIES)],
      categories,
      period: period('this-month'),
      baseline: [],
      ctx,
    });
    const groceries = fresh.find(r => r.id === GROCERIES)!;
    expect(groceries.average).toBe(0);
    expect(groceries.confidence).toBe('none');
    expect(groceries.pctVsAverage).toBeNull();
  });
});

// ── Savings ───────────────────────────────────────────────────────────────────

describe('savings', () => {
  const goal = (over: Partial<SavingsGoal>): SavingsGoal => ({
    id: 1, user_id: 1, name: 'Goal', target_amount: 1000, deadline: null,
    created_at: '', allocations: [], current_amount: 0, ...over,
  });

  it('uses income minus expenses, matching the rest of the app', () => {
    const metrics = calculateSavingsMetrics({
      transactions: [
        tx('2026-07-01', 3000, SALARY),
        tx('2026-07-02', -1000, GROCERIES),
        tx('2026-06-01', 3000, SALARY),
        tx('2026-06-02', -2000, GROCERIES),
      ],
      goals: [],
      period: period('this-month'),
      baseline: ['2026-06'],
      ctx,
      today: TODAY,
    });

    expect(metrics.saved).toBe(2000);
    expect(metrics.previousSaved).toBe(1000);
    expect(metrics.savedDelta).toBe(1000);
    expect(metrics.averageMonthlySaved).toBe(1000);
  });

  it('keeps goal allocations separate from what was saved this period', () => {
    const metrics = calculateSavingsMetrics({
      transactions: [tx('2026-07-01', 1000, SALARY)],
      goals: [goal({ id: 5, current_amount: 8400, target_amount: 12000 })],
      period: period('this-month'),
      baseline: [],
      ctx,
      today: TODAY,
    });
    expect(metrics.saved).toBe(1000);
    expect(metrics.allocatedTotal).toBe(8400);
  });

  it('picks the goal with the nearest upcoming deadline', () => {
    const primary = selectPrimaryGoal([
      goal({ id: 1, name: 'Far', deadline: '2027-01-01', current_amount: 900 }),
      goal({ id: 2, name: 'Near', deadline: '2026-09-01', current_amount: 100 }),
    ], 100, TODAY);
    expect(primary?.name).toBe('Near');
    expect(primary?.basis).toBe('deadline');
  });

  it('falls back to the goal furthest along when none has a deadline', () => {
    const primary = selectPrimaryGoal([
      goal({ id: 1, name: 'Behind', current_amount: 100 }),
      goal({ id: 2, name: 'Ahead', current_amount: 900 }),
    ], 100, TODAY);
    expect(primary?.name).toBe('Ahead');
    expect(primary?.basis).toBe('progress');
  });

  it('ignores deadlines that have already passed', () => {
    const primary = selectPrimaryGoal([
      goal({ id: 1, name: 'Expired', deadline: '2025-01-01', current_amount: 10 }),
      goal({ id: 2, name: 'Ahead', current_amount: 900 }),
    ], 100, TODAY);
    expect(primary?.name).toBe('Ahead');
  });

  it('does not project a completion date without a positive savings rate', () => {
    const primary = selectPrimaryGoal([goal({ current_amount: 200 })], null, TODAY);
    expect(primary?.projectedCompletion).toBeNull();

    const negative = selectPrimaryGoal([goal({ current_amount: 200 })], -50, TODAY);
    expect(negative?.projectedCompletion).toBeNull();
  });

  it('projects a completion date from the average monthly saving', () => {
    // 800 remaining at 200/month → 4 months → November 2026.
    const primary = selectPrimaryGoal([goal({ current_amount: 200, target_amount: 1000 })], 200, TODAY);
    expect(primary?.monthsToCompletion).toBe(4);
    expect(primary?.projectedCompletion).toBe('November 2026');
  });
});

// ── Net worth ─────────────────────────────────────────────────────────────────

describe('calculateNetWorthChange', () => {
  const snapshots = [
    { month: '2026-04', net_worth: 10000 },
    { month: '2026-05', net_worth: 9000 },
    { month: '2026-06', net_worth: 12000 },
    { month: '2026-07', net_worth: 13000 },
  ];

  const analysis = calculateNetWorthChange(snapshots, {
    transactions: [tx('2026-07-01', 3000, SALARY), tx('2026-07-04', -500, GROCERIES)],
    assets: [],
    ctx,
    months: 12,
  });

  it('reports the change across the window', () => {
    expect(analysis.start).toBe(10000);
    expect(analysis.end).toBe(13000);
    expect(analysis.change).toBe(3000);
    expect(analysis.pctChange).toBeCloseTo(0.3, 5);
  });

  it('finds the extremes', () => {
    expect(analysis.high?.month).toBe('2026-07');
    expect(analysis.low?.month).toBe('2026-05');
    expect(analysis.bestMonth?.month).toBe('2026-06');
    expect(analysis.worstMonth?.month).toBe('2026-05');
  });

  it('offers contributors without asserting a cause', () => {
    expect(analysis.contributors.length).toBeGreaterThan(0);
    expect(analysis.contributors[0].value).toBe(2500);
  });

  it('handles a single snapshot without crashing', () => {
    const single = calculateNetWorthChange([{ month: '2026-07', net_worth: 100 }], {
      transactions: [], assets: [], ctx,
    });
    expect(single.change).toBe(0);
    expect(single.points[0].change).toBeNull();
  });
});

// ── Cash flow ─────────────────────────────────────────────────────────────────

describe('buildCashFlow', () => {
  const rent: RecurringTransaction = {
    id: 1, user_id: 1, account_id: CHECKING, category_id: GROCERIES,
    amount: -1200, description: 'Rent', period: 'monthly',
    next_date: '2026-08-01', is_active: true, is_variable: false, created_at: '',
  };

  it('splits fixed from variable when recurring bills are declared', () => {
    const flow = buildCashFlow({
      transactions: [
        tx('2026-07-01', 4000, SALARY),
        tx('2026-07-02', -1200, GROCERIES, CHECKING, 'Rent'),
        tx('2026-07-05', -300, GROCERIES, CHECKING, 'Corner Shop'),
      ],
      recurring: [rent],
      period: period('this-month'),
      ctx,
    });

    expect(flow.mode).toBe('waterfall');
    expect(flow.hasFixedBreakdown).toBe(true);
    expect(flow.fixed).toBe(1200);
    expect(flow.variable).toBe(300);
    expect(flow.remaining).toBe(2500);
  });

  it('falls back to a single spending step when nothing is declared recurring', () => {
    const flow = buildCashFlow({
      transactions: [tx('2026-07-01', 1000, SALARY), tx('2026-07-02', -400, GROCERIES)],
      recurring: [],
      period: period('this-month'),
      ctx,
    });
    expect(flow.hasFixedBreakdown).toBe(false);
    expect(flow.steps.map(s => s.key)).toEqual(['income', 'spending', 'remaining']);
  });

  it('switches to a monthly series for a multi-month range', () => {
    const flow = buildCashFlow({
      transactions: [tx('2026-05-01', 100, SALARY), tx('2026-07-01', 200, SALARY)],
      recurring: [],
      period: period('last-3'),
      ctx,
    });
    expect(flow.mode).toBe('series');
    expect(flow.series).toHaveLength(3);
    expect(flow.series[0].Income).toBe(100);
  });

  it('hangs a shortfall below zero rather than floating it', () => {
    const flow = buildCashFlow({
      transactions: [tx('2026-07-01', 100, SALARY), tx('2026-07-02', -400, GROCERIES)],
      recurring: [],
      period: period('this-month'),
      ctx,
    });
    const result = flow.steps[flow.steps.length - 1];
    expect(result.value).toBe(-300);
    expect(result.base).toBe(-300);
  });
});

// ── Recurring & subscriptions ─────────────────────────────────────────────────

describe('recurring', () => {
  it('normalises a period to a monthly equivalent', () => {
    expect(monthlyEquivalent(-12, 'yearly')).toBeCloseTo(1, 5);
    expect(monthlyEquivalent(-30, 'quarterly')).toBeCloseTo(10, 5);
    expect(monthlyEquivalent(-10, 'monthly')).toBe(10);
  });

  it('detects a steady monthly charge', () => {
    const detected = detectRecurringTransactions([
      tx('2026-05-04', -15.99, null, CHECKING, 'Streamflix'),
      tx('2026-06-04', -15.99, null, CHECKING, 'Streamflix'),
      tx('2026-07-04', -15.99, null, CHECKING, 'Streamflix'),
    ], ctx, { today: TODAY });

    expect(detected).toHaveLength(1);
    expect(detected[0].occurrences).toBe(3);
    expect(detected[0].monthlyAmount).toBeCloseTo(15.99, 1);
  });

  it('ignores a regular shop with varying amounts', () => {
    const detected = detectRecurringTransactions([
      tx('2026-05-04', -30, null, CHECKING, 'Corner Grocer'),
      tx('2026-06-04', -95, null, CHECKING, 'Corner Grocer'),
      tx('2026-07-04', -12, null, CHECKING, 'Corner Grocer'),
    ], ctx, { today: TODAY });
    expect(detected).toHaveLength(0);
  });

  it('ignores a charge seen only twice', () => {
    const detected = detectRecurringTransactions([
      tx('2026-06-04', -9.99, null, CHECKING, 'Podcast Plus'),
      tx('2026-07-04', -9.99, null, CHECKING, 'Podcast Plus'),
    ], ctx, { today: TODAY });
    expect(detected).toHaveLength(0);
  });

  it('does not re-detect something already declared as recurring', () => {
    const declared = new Set([normalizeMerchantName('Streamflix')]);
    const detected = detectRecurringTransactions([
      tx('2026-05-04', -15.99, null, CHECKING, 'Streamflix'),
      tx('2026-06-04', -15.99, null, CHECKING, 'Streamflix'),
      tx('2026-07-04', -15.99, null, CHECKING, 'Streamflix'),
    ], ctx, { today: TODAY, declaredKeys: declared });
    expect(detected).toHaveLength(0);
  });

  it('expands short-cycle bills across the 30-day window', () => {
    const weekly: RecurringTransaction = {
      id: 2, user_id: 1, account_id: CHECKING, category_id: null,
      amount: -25, description: 'Window cleaner', period: 'weekly',
      next_date: '2026-07-20', is_active: true, is_variable: false, created_at: '',
    };
    const outlook = buildRecurringOutlook({
      recurring: [weekly], transactions: [], accounts, categories, ctx, today: TODAY,
    });
    // 20 and 27 July, then 3, 10 and 17 August — all within 30 days of the 18th.
    expect(outlook.next30DaysCount).toBe(5);
    expect(outlook.next30DaysTotal).toBe(125);
  });

  it('leaves income schedules out of the bills list', () => {
    const payday: RecurringTransaction = {
      id: 3, user_id: 1, account_id: CHECKING, category_id: SALARY,
      amount: 3000, description: 'Payday', period: 'monthly',
      next_date: '2026-07-25', is_active: true, is_variable: false, created_at: '',
    };
    const outlook = buildRecurringOutlook({
      recurring: [payday], transactions: [], accounts, categories, ctx, today: TODAY,
    });
    expect(outlook.upcoming).toHaveLength(0);
  });
});

// ── Financial health ──────────────────────────────────────────────────────────

describe('calculateFinancialHealth', () => {
  const monthFor = (income: number, expense: number, month: string) =>
    ({ month, metrics: calculatePeriodMetrics([tx(`${month}-05`, income, SALARY), tx(`${month}-06`, -expense, GROCERIES)], ctx) });

  it('declines to score without enough history', () => {
    const health = calculateFinancialHealth({
      monthly: [monthFor(3000, 2000, '2026-06')],
      liquidBalance: 5000, creditCardDebt: 0, creditLimit: 0,
      monthlyRecurringExpense: 0, hasCreditCards: false,
    });
    expect(health.available).toBe(false);
    expect(health.score).toBeNull();
    expect(health.requiredMonths).toBe(3);
  });

  it('explains every factor it uses', () => {
    const health = calculateFinancialHealth({
      monthly: ['2026-04', '2026-05', '2026-06'].map(m => monthFor(4000, 2000, m)),
      liquidBalance: 12000, creditCardDebt: 0, creditLimit: 0,
      monthlyRecurringExpense: 400, hasCreditCards: false,
    });

    expect(health.available).toBe(true);
    expect(health.factors.length).toBeGreaterThan(0);
    health.factors.forEach(factor => {
      expect(factor.explanation.length).toBeGreaterThan(0);
      expect(factor.detail.length).toBeGreaterThan(0);
      expect(factor.score).toBeGreaterThanOrEqual(0);
      expect(factor.score).toBeLessThanOrEqual(100);
    });
    // Weights always renormalise to a score out of 100.
    expect(health.score!).toBeGreaterThanOrEqual(0);
    expect(health.score!).toBeLessThanOrEqual(100);
  });

  it('does not punish high spending that is matched by high income', () => {
    const modest = calculateFinancialHealth({
      monthly: ['2026-04', '2026-05', '2026-06'].map(m => monthFor(2000, 1400, m)),
      liquidBalance: 4200, creditCardDebt: 0, creditLimit: 0,
      monthlyRecurringExpense: 0, hasCreditCards: false,
    });
    const bigSpender = calculateFinancialHealth({
      monthly: ['2026-04', '2026-05', '2026-06'].map(m => monthFor(20000, 14000, m)),
      liquidBalance: 42000, creditCardDebt: 0, creditLimit: 0,
      monthlyRecurringExpense: 0, hasCreditCards: false,
    });
    // Same ratios, ten times the amounts — the score should not move.
    expect(bigSpender.score).toBe(modest.score);
  });

  it('adds a debt factor only when credit cards exist', () => {
    const withCards = calculateFinancialHealth({
      monthly: ['2026-04', '2026-05', '2026-06'].map(m => monthFor(3000, 2000, m)),
      liquidBalance: 6000, creditCardDebt: 600, creditLimit: 3000,
      monthlyRecurringExpense: 0, hasCreditCards: true,
    });
    expect(withCards.factors.some(f => f.key === 'debt')).toBe(true);

    const withoutCards = calculateFinancialHealth({
      monthly: ['2026-04', '2026-05', '2026-06'].map(m => monthFor(3000, 2000, m)),
      liquidBalance: 6000, creditCardDebt: 0, creditLimit: 0,
      monthlyRecurringExpense: 0, hasCreditCards: false,
    });
    expect(withoutCards.factors.some(f => f.key === 'debt')).toBe(false);
  });
});

// ── Forecast safeguards ───────────────────────────────────────────────────────

describe('calculateForecast', () => {
  const history = ['2026-04', '2026-05', '2026-06'].map(month => ({
    month,
    metrics: calculatePeriodMetrics([
      tx(`${month}-05`, 4000, SALARY),
      tx(`${month}-06`, -2000, GROCERIES),
    ], ctx),
  }));

  const base = {
    transactions: [tx('2026-07-05', 4000, SALARY), tx('2026-07-06', -900, GROCERIES)],
    recurring: [] as RecurringTransaction[],
    categories: [],
    monthly: history,
    ctx,
    today: TODAY,
  };

  it('refuses to project a completed period', () => {
    const forecast = calculateForecast({ ...base, period: period('custom', '2026-03') });
    expect(forecast.available).toBe(false);
    expect(forecast.reason).toContain('already complete');
  });

  it('refuses to project from the first few days', () => {
    const forecast = calculateForecast({
      ...base,
      today: new Date(2026, 6, 2),
      period: resolvePeriod('this-month', { today: new Date(2026, 6, 2), customMonth: '2026-07' }),
    });
    expect(forecast.available).toBe(false);
    expect(forecast.reason).toContain('too early');
  });

  it('refuses to project without three completed months', () => {
    const forecast = calculateForecast({ ...base, monthly: history.slice(0, 2), period: period('this-month') });
    expect(forecast.available).toBe(false);
    expect(forecast.reason).toContain('3 completed months');
  });

  it('projects above what has already been spent', () => {
    const forecast = calculateForecast({ ...base, period: period('this-month') });
    expect(forecast.available).toBe(true);
    expect(forecast.expenses!.projected).toBeGreaterThan(forecast.expenses!.soFar);
    expect(forecast.basis).toContain('July');
  });

  it('does not run-rate irregular income', () => {
    const lumpy = [
      { month: '2026-04', metrics: calculatePeriodMetrics([tx('2026-04-05', 12000, SALARY)], ctx) },
      { month: '2026-05', metrics: calculatePeriodMetrics([tx('2026-05-05', 200, SALARY)], ctx) },
      { month: '2026-06', metrics: calculatePeriodMetrics([tx('2026-06-05', 9000, SALARY)], ctx) },
    ];
    const forecast = calculateForecast({ ...base, monthly: lumpy, period: period('this-month') });
    // Only what has landed plus what is scheduled — no speculative top-up.
    expect(forecast.income!.projected).toBe(forecast.income!.soFar);
    expect(forecast.basis).toContain('Income has varied');
  });
});

// ── Range helpers ─────────────────────────────────────────────────────────────

describe('transactionsInRange', () => {
  it('is inclusive at both ends', () => {
    const rows = [tx('2026-06-30', -1), tx('2026-07-01', -1), tx('2026-07-31', -1), tx('2026-08-01', -1)];
    expect(transactionsInRange(rows, period('this-month'))).toHaveLength(2);
  });
});

describe('monthlyMetrics', () => {
  it('returns a zeroed entry for a month with no activity', () => {
    const rows = monthlyMetrics([tx('2026-07-01', 100, SALARY)], ['2026-06', '2026-07'], ctx);
    expect(rows).toHaveLength(2);
    expect(rows[0].metrics.income).toBe(0);
    expect(rows[1].metrics.income).toBe(100);
  });
});

// ── Cross-surface consistency ─────────────────────────────────────────────────

describe('definitions agree across surfaces', () => {
  const transactions = [
    tx('2026-07-01', 4000, SALARY),
    tx('2026-07-02', -900, GROCERIES),
    tx('2026-07-03', -300, FUEL),
    tx('2026-07-04', 100, GROCERIES),   // refund
    tx('2026-07-05', -250),             // uncategorized spend
    tx('2026-07-06', -400, GROCERIES, CARD),
    tx('2026-07-07', 400, null, CARD),  // card payment
  ];
  const p = period('this-month');
  const metrics = calculatePeriodMetrics(transactionsInRange(transactions, p), ctx);

  it('reconciles category totals with the period expense total', () => {
    const rows = calculateCategoryComparisons({
      transactions, categories, period: p, baseline: [], ctx,
    });
    const categorised = rows.reduce((s, r) => s + r.current, 0);
    // Everything spent is either in a category or explicitly called out as
    // uncategorized. Nothing may quietly vanish between the two.
    expect(categorised + metrics.uncategorizedSpend).toBeCloseTo(metrics.expenses, 6);
  });

  it('gives the savings card the same figures as the period metrics', () => {
    const savingsMetrics = calculateSavingsMetrics({
      transactions, goals: [], period: p, baseline: [], ctx, today: TODAY,
    });
    expect(savingsMetrics.saved).toBe(metrics.net);
    expect(savingsMetrics.savingsRate).toBe(metrics.savingsRate);
  });

  it('gives the cash-flow chart the same income and expense totals', () => {
    const flow = buildCashFlow({ transactions, recurring: [], period: p, ctx });
    expect(flow.income).toBe(metrics.income);
    expect(flow.fixed + flow.variable).toBeCloseTo(metrics.expenses, 6);
    expect(flow.remaining).toBe(metrics.net);
  });

  it('quotes one recurring monthly total everywhere it appears', () => {
    const recurringRows: RecurringTransaction[] = [
      {
        id: 1, user_id: 1, account_id: CHECKING, category_id: GROCERIES,
        amount: -30, description: 'Streamflix', period: 'monthly',
        next_date: '2026-08-04', is_active: true, is_variable: false, created_at: '',
      },
      {
        id: 2, user_id: 1, account_id: CHECKING, category_id: null,
        amount: -120, description: 'Insurance', period: 'yearly',
        next_date: '2026-12-01', is_active: true, is_variable: false, created_at: '',
      },
    ];
    const outlook = buildRecurringOutlook({
      recurring: recurringRows, transactions: [], accounts, categories, ctx, today: TODAY,
    });
    // 30/month + 120/year → 30 + 10 = 40.
    expect(outlook.subscriptions.monthlyTotal).toBeCloseTo(40, 6);
    expect(monthlyRecurringExpense(recurringRows)).toBe(outlook.subscriptions.monthlyTotal);
    // And the grouped view must add up to the same number.
    const grouped = outlook.subscriptions.groups.reduce((s, g) => s + g.monthlyTotal, 0);
    expect(grouped).toBeCloseTo(outlook.subscriptions.monthlyTotal, 6);
  });

  it('excludes the card payment from income on every surface', () => {
    expect(metrics.income).toBe(4000);
    expect(metrics.cardPayments).toBe(400);
    const flow = buildCashFlow({ transactions, recurring: [], period: p, ctx });
    expect(flow.income).toBe(4000);
  });
});

describe('groupRecurringCharges', () => {
  const make = (over: Partial<RecurringTransaction>): RecurringTransaction => ({
    id: 1, user_id: 1, account_id: CHECKING, category_id: null, amount: -20,
    description: 'Thing', period: 'monthly', next_date: '2026-08-01',
    is_active: true, is_variable: false, created_at: '', ...over,
  });

  it('files a varying amount as a bill and a fixed one as a subscription', () => {
    const groups = groupRecurringCharges([
      make({ id: 1, description: 'Electricity', is_variable: true }),
      make({ id: 2, description: 'Streamflix', is_variable: false }),
    ], categories);

    expect(groups.find(g => g.kind === 'bill')?.charges[0].name).toBe('Electricity');
    expect(groups.find(g => g.kind === 'subscription')?.charges[0].name).toBe('Streamflix');
  });

  it('files an irregular cadence as other', () => {
    const groups = groupRecurringCharges([make({ period: 'biweekly' })], categories);
    expect(groups.map(g => g.kind)).toEqual(['other']);
  });

  it('leaves out income schedules and inactive rows', () => {
    const groups = groupRecurringCharges([
      make({ id: 1, amount: 3000, description: 'Payday' }),
      make({ id: 2, is_active: false, description: 'Cancelled' }),
    ], categories);
    expect(groups).toHaveLength(0);
  });
});

// ── Wording ───────────────────────────────────────────────────────────────────

describe('formatting language', () => {
  it('pluralises irregular nouns instead of appending s', () => {
    expect(pluralize('category')).toBe('categories');
    expect(plural(3, 'category')).toBe('3 categories');
    expect(plural(1, 'category')).toBe('1 category');
    expect(plural(3, 'smaller category')).toBe('3 smaller categories');
    expect(plural(2, 'charge')).toBe('2 charges');
    expect(plural(5, 'day')).toBe('5 days');
    expect(plural(2, 'completed month')).toBe('2 completed months');
  });

  it('reports a rate movement in percentage points, not percent', () => {
    // 27.2% → 79.1% is +51.9 points. As a percent change it would read +191%.
    expect(percentagePoints(0.791 - 0.272)).toBe('+51.9 pp');
    expect(percentagePoints(-0.12)).toBe('−12.0 pp');
    expect(rateTransition(0.272, 0.791)).toBe('27.2% → 79.1%');
  });

  it('labels every transaction kind explicitly', () => {
    // A salary must read as Income wherever it appears.
    expect(KIND_LABELS.income).toBe('Income');
    expect(KIND_LABELS.expense).toBe('Expense');
    expect(KIND_LABELS.refund).toBe('Refund');
    expect(KIND_LABELS['card-payment']).toBe('Card payment');
  });
});

describe('normalizeMerchantName', () => {
  it('strips transaction noise and ids so repeats group together', () => {
    expect(normalizeMerchantName('POS PURCHASE STREAMFLIX 998877'))
      .toBe(normalizeMerchantName('Streamflix'));
  });

  it('strips the plaid import prefix', () => {
    expect(normalizeMerchantName('[plaid:abc123] Streamflix')).toBe('streamflix');
  });

  it('keeps genuinely different merchants apart', () => {
    expect(normalizeMerchantName('Apple Store')).not.toBe(normalizeMerchantName('Apple Bakery'));
  });
});
