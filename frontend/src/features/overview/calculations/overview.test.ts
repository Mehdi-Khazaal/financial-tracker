import type { Account, Category, SavingsGoal, Transaction } from '../../../types';
import { buildClassificationContext } from '../../analytics/calculations/transactions';
import { calculatePeriodMetrics } from '../../analytics/calculations/metrics';
import { buildMonthActivity } from './activity';
import { buildSpendingComparison } from './comparison';
import { buildImportReview } from './review';
import {
  amountOwed, cardUtilization, describeBalance, totalCardDebt, totalCreditLimit,
} from './accounts';
import { describeGoal, isOverfunded } from './goals';
import { buildStatusInsight, statusInsightCandidates } from './insight';

/**
 * Overview calculation tests.
 *
 * The wording is asserted as well as the arithmetic, because on this tab the
 * wording *is* the fix: `−$2,285.84 spending` and `$0.00` on the 2nd of the
 * month were both numerically correct and both unreadable.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 4200, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Rewards Card', type: 'credit_card', balance: -213.37, credit_limit: 1500, currency: 'USD', created_at: '', updated_at: '' },
  { id: 3, user_id: 1, name: 'Cash', type: 'cash', balance: 120, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
];

const categories: Category[] = [
  { id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: 11, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
];

const ctx = buildClassificationContext(accounts, categories);

let nextId = 1;
const tx = (
  date: string,
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction => ({
  id: nextId++,
  user_id: 1,
  account_id: 1,
  category_id: null,
  amount,
  description: 'Entry',
  transaction_date: date,
  created_at: '',
  ...overrides,
});

/** 2 August 2026 — early in a month, the state that started all of this. */
const EARLY_AUGUST = new Date(2026, 7, 2);
/** 31 August 2026 — the month is complete. */
const END_OF_AUGUST = new Date(2026, 7, 31);

const goal = (overrides: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 1, user_id: 1, name: 'Education', target_amount: 10000,
  deadline: null, created_at: '', allocations: [], current_amount: 0,
  ...overrides,
});

// ── Month activity ────────────────────────────────────────────────────────────

describe('buildMonthActivity', () => {
  const base = {
    month: '2026-08',
    today: EARLY_AUGUST,
    income: 0,
    expenses: 0,
    dataIncomplete: false,
  };

  it('explains a brand-new month rather than showing a bare zero', () => {
    const activity = buildMonthActivity({
      ...base,
      transactions: [tx('2026-07-31', -40), tx('2026-07-15', 3000, { category_id: 11 })],
    });

    expect(activity.state).toBe('no-activity');
    expect(activity.headline).toBe('No posted activity yet');
    expect(activity.detail).toContain('August has just started');
    expect(activity.postedCount).toBe(0);
  });

  it('reports the most recent posted transaction date when prior activity exists', () => {
    const activity = buildMonthActivity({
      ...base,
      transactions: [tx('2026-07-31', -40), tx('2026-06-02', -12)],
    });

    expect(activity.lastPostedDate).toBe('2026-07-31');
    expect(activity.lastPostedLabel).toBe('Jul 31');
    expect(activity.lastPostedIsEarlier).toBe(true);
  });

  it('never treats a future-dated row as posted', () => {
    const activity = buildMonthActivity({
      ...base,
      transactions: [tx('2026-07-20', -40), tx('2026-09-01', -99)],
    });

    expect(activity.lastPostedDate).toBe('2026-07-20');
  });

  it('drops the "just started" wording later in a quiet month', () => {
    const activity = buildMonthActivity({
      ...base,
      today: new Date(2026, 7, 20),
      transactions: [tx('2026-07-31', -40)],
    });

    expect(activity.detail).toBe('Nothing has posted in August so far.');
  });

  it('distinguishes no history at all from a quiet month', () => {
    const activity = buildMonthActivity({ ...base, transactions: [] });

    expect(activity.state).toBe('no-data');
    expect(activity.headline).toBe('No transactions yet');
    expect(activity.lastPostedLabel).toBeNull();
  });

  it('distinguishes "no income yet" from "no activity"', () => {
    const activity = buildMonthActivity({
      ...base,
      transactions: [tx('2026-08-01', -55, { category_id: 10 })],
      expenses: 55,
    });

    expect(activity.state).toBe('no-income');
    expect(activity.headline).toBe('No income posted yet');
  });

  it('distinguishes "no spending yet" from "no activity"', () => {
    const activity = buildMonthActivity({
      ...base,
      transactions: [tx('2026-08-01', 3000, { category_id: 11 })],
      income: 3000,
    });

    expect(activity.state).toBe('no-expenses');
    expect(activity.headline).toBe('No spending posted yet');
  });

  it('says nothing when the month is behaving normally', () => {
    const activity = buildMonthActivity({
      ...base,
      transactions: [tx('2026-08-01', 3000, { category_id: 11 }), tx('2026-08-02', -55, { category_id: 10 })],
      income: 3000,
      expenses: 55,
    });

    expect(activity.state).toBe('active');
    expect(activity.headline).toBeNull();
  });

  it('refuses to call a month empty when a source failed to load', () => {
    const activity = buildMonthActivity({ ...base, transactions: [], dataIncomplete: true });

    expect(activity.state).toBe('unavailable');
    expect(activity.headline).toBe('Activity may be incomplete');
  });
});

// ── Spending comparison ───────────────────────────────────────────────────────

describe('buildSpendingComparison', () => {
  const july = [
    tx('2026-07-02', -100, { category_id: 10 }),
    tx('2026-07-20', -2185.84, { category_id: 10 }),
  ];

  it('quotes last month as a prior-period total when nothing has posted yet', () => {
    const result = buildSpendingComparison({
      transactions: july,
      month: '2026-08',
      today: EARLY_AUGUST,
      ctx,
      currentExpenses: 0,
    });

    expect(result.kind).toBe('prior-total');
    expect(result.label).toBe('July spending');
    expect(result.text).toBe('July total: $2,285.84');
    // Never dressed up as a 100% improvement.
    expect(result.tone).toBe('neutral');
  });

  it('compares a part-month against the same stretch of the previous month', () => {
    const result = buildSpendingComparison({
      transactions: [...july, tx('2026-08-01', -60, { category_id: 10 })],
      month: '2026-08',
      today: EARLY_AUGUST,
      ctx,
      currentExpenses: 60,
    });

    // Aug 1–2 ($60) against Jul 1–2 ($100), not against all of July.
    expect(result.kind).toBe('difference');
    expect(result.value).toBeCloseTo(40, 2);
    expect(result.text).toBe('$40.00 less than July so far');
    expect(result.hint).toContain('August 1–2 against July 1–2');
    // A part-month is not an achievement either way.
    expect(result.tone).toBe('neutral');
  });

  it('compares whole months once the current month is complete', () => {
    const result = buildSpendingComparison({
      transactions: [...july, tx('2026-08-05', -1000, { category_id: 10 })],
      month: '2026-08',
      today: END_OF_AUGUST,
      ctx,
      currentExpenses: 1000,
    });

    expect(result.text).toBe('$1,285.84 less than July');
    expect(result.text).not.toContain('so far');
    expect(result.tone).toBe('positive');
  });

  it('names the direction rather than leaning on a sign', () => {
    const result = buildSpendingComparison({
      transactions: [...july, tx('2026-08-05', -4000, { category_id: 10 })],
      month: '2026-08',
      today: END_OF_AUGUST,
      ctx,
      currentExpenses: 4000,
    });

    expect(result.text).toBe('$1,714.16 more than July');
    expect(result.tone).toBe('negative');
  });

  it('falls back to a current-period total when the prior window is empty', () => {
    const result = buildSpendingComparison({
      transactions: [tx('2026-08-01', -60, { category_id: 10 })],
      month: '2026-08',
      today: EARLY_AUGUST,
      ctx,
      currentExpenses: 60,
    });

    expect(result.kind).toBe('current-total');
    expect(result.text).toBe('$60.00 spent so far');
  });

  it('says nothing when neither month has spending', () => {
    const result = buildSpendingComparison({
      transactions: [],
      month: '2026-08',
      today: EARLY_AUGUST,
      ctx,
      currentExpenses: 0,
    });

    expect(result.kind).toBe('none');
  });

  it('clamps the comparison window to a shorter previous month', () => {
    const result = buildSpendingComparison({
      transactions: [tx('2026-02-27', -50, { category_id: 10 }), tx('2026-03-15', -50, { category_id: 10 })],
      month: '2026-03',
      today: new Date(2026, 2, 30),
      ctx,
      currentExpenses: 50,
    });

    // February has 28 days, so the whole month is in scope rather than day 30.
    expect(result.hint).toContain('February 1–28');
  });
});

// ── Import review ─────────────────────────────────────────────────────────────

describe('buildImportReview', () => {
  it('reports a complete month as complete, not as 0%', () => {
    const review = buildImportReview([], '2026-08');

    expect(review.isComplete).toBe(true);
    expect(review.rate).toBe(100);
    expect(review.total).toBe(0);
  });

  it('counts only the current month, matching the Review tab', () => {
    const review = buildImportReview(
      [
        tx('2026-08-01', -10, { category_id: 10 }),
        tx('2026-08-02', -10),
        tx('2026-07-02', -10),
      ],
      '2026-08',
    );

    expect(review.total).toBe(2);
    expect(review.unreviewed).toBe(1);
    expect(review.rate).toBe(50);
    expect(review.isComplete).toBe(false);
  });

  it('reports unfiled transactions from earlier months separately', () => {
    const review = buildImportReview(
      [tx('2026-08-01', -10, { category_id: 10 }), tx('2026-06-02', -10)],
      '2026-08',
    );

    expect(review.isComplete).toBe(true);
    expect(review.olderUnreviewed).toBe(1);
  });
});

// ── Credit cards and balances ─────────────────────────────────────────────────

describe('account balance presentation', () => {
  it('renders a card balance as an amount owed, not a negative number', () => {
    const result = describeBalance(accounts[1]);

    expect(result.text).toBe('$213.37 owed');
    expect(result.text).not.toContain('−');
    expect(result.tone).toBe('negative');
    expect(result.detail).toBe('$1,286.63 available');
  });

  it('says "Paid off" for a zero card balance', () => {
    const result = describeBalance({ ...accounts[1], balance: 0 });

    expect(result.text).toBe('Paid off');
    expect(result.tone).toBe('positive');
    expect(result.detail).toBe('$1,500.00 available');
  });

  it('handles an overpaid card without calling it a debt', () => {
    const result = describeBalance({ ...accounts[1], balance: 42 });

    expect(result.text).toBe('$42.00 in credit');
    expect(result.tone).toBe('positive');
  });

  it('omits credit detail when no limit is recorded rather than inferring one', () => {
    const result = describeBalance({ ...accounts[1], credit_limit: null });

    expect(result.detail).toBeNull();
  });

  it('flags an overdrawn everyday account', () => {
    const result = describeBalance({ ...accounts[0], balance: -80 });

    expect(result.tone).toBe('negative');
    expect(result.detail).toBe('Overdrawn');
    expect(result.srText).toBe('Overdrawn by $80.00');
  });

  it('keeps the stored accounting value untouched', () => {
    // Presentation only — the account object still carries a negative balance.
    expect(Number(accounts[1].balance)).toBe(-213.37);
    expect(amountOwed(accounts[1])).toBeCloseTo(213.37, 2);
    expect(amountOwed(accounts[0])).toBe(0);
  });

  it('aggregates card debt, limit and utilisation', () => {
    expect(totalCardDebt(accounts)).toBeCloseTo(213.37, 2);
    expect(totalCreditLimit(accounts)).toBe(1500);
    expect(cardUtilization(accounts)).toBeCloseTo(14.22, 1);
  });

  it('returns null utilisation when no limit is known', () => {
    expect(cardUtilization([{ ...accounts[1], credit_limit: null }])).toBeNull();
  });
});

// ── Savings goals ─────────────────────────────────────────────────────────────

describe('describeGoal', () => {
  const today = EARLY_AUGUST;

  it('shows a completed goal in the positive colour, never red', () => {
    const result = describeGoal(goal({ current_amount: 10000 }), today);

    expect(result.status).toBe('complete');
    expect(result.color).toBe('var(--pos)');
    expect(result.statusLabel).toBe('Complete');
  });

  it('keeps an overfunded goal complete and reports the true percentage', () => {
    const result = describeGoal(goal({ current_amount: 12500 }), today);

    expect(result.status).toBe('complete');
    expect(result.rawProgress).toBe(125);
    // The bar itself still stops at full.
    expect(result.progress).toBe(100);
    expect(isOverfunded(result)).toBe(true);
  });

  it('uses the goal accent while partially funded', () => {
    const result = describeGoal(goal({ current_amount: 4000 }), today);

    expect(result.status).toBe('in-progress');
    expect(result.color).toBe('var(--accent)');
    expect(result.progress).toBe(40);
  });

  it('treats zero progress as subdued, not as a failure', () => {
    const result = describeGoal(goal({ current_amount: 0 }), today);

    expect(result.status).toBe('not-started');
    expect(result.color).toBe('var(--dim)');
  });

  it('reserves red for a deadline that has actually passed', () => {
    const result = describeGoal(goal({ current_amount: 2000, deadline: '2026-07-01' }), today);

    expect(result.status).toBe('overdue');
    expect(result.color).toBe('var(--neg)');
    expect(result.statusLabel).toBe('Past deadline');
  });

  it('does not mark a completed goal overdue', () => {
    const result = describeGoal(goal({ current_amount: 10000, deadline: '2026-07-01' }), today);

    expect(result.status).toBe('complete');
  });

  it('survives a goal with no positive target instead of dividing by zero', () => {
    const result = describeGoal(goal({ target_amount: 0, current_amount: 500 }), today);

    expect(result.status).toBe('invalid');
    expect(Number.isFinite(result.progress)).toBe(true);
    expect(result.progress).toBe(0);
  });
});

// ── Status insight ────────────────────────────────────────────────────────────

describe('status insight', () => {
  const quietActivity = buildMonthActivity({
    transactions: [tx('2026-07-31', -40)],
    month: '2026-08',
    today: EARLY_AUGUST,
    income: 0,
    expenses: 0,
    dataIncomplete: false,
  });

  const activeActivity = buildMonthActivity({
    transactions: [tx('2026-08-01', 3000, { category_id: 11 }), tx('2026-08-02', -50, { category_id: 10 })],
    month: '2026-08',
    today: EARLY_AUGUST,
    income: 3000,
    expenses: 50,
    dataIncomplete: false,
  });

  const base = {
    today: EARLY_AUGUST,
    activity: quietActivity,
    dataIncomplete: false,
    unreviewedCount: 0,
    accounts: [accounts[0]],
    goals: [] as SavingsGoal[],
    undeclaredRecurringCount: 0,
    lastCompleted: null,
  };

  it('shows exactly one insight', () => {
    expect(buildStatusInsight(base).id).toBeDefined();
    expect(statusInsightCandidates(base).length).toBeGreaterThan(0);
  });

  it('puts partial data above everything else', () => {
    const insight = buildStatusInsight({
      ...base,
      dataIncomplete: true,
      unreviewedCount: 5,
      accounts: [{ ...accounts[0], balance: -50 }],
    });

    expect(insight.id).toBe('data-incomplete');
  });

  it('ranks unresolved imports above account and goal states', () => {
    const insight = buildStatusInsight({
      ...base,
      unreviewedCount: 3,
      accounts: [{ ...accounts[0], balance: -50 }],
      goals: [goal({ current_amount: 1000 })],
    });

    expect(insight.id).toBe('unreviewed-imports');
    expect(insight.title).toBe('3 imported transactions still need a category');
    // A deep link, so the Review tab is already selected on arrival.
    expect(insight.action).toEqual({ label: 'Review imports', to: '/transactions?tab=transactions' });
  });

  it('ranks an overdrawn account above a recurring-charge prompt', () => {
    const insight = buildStatusInsight({
      ...base,
      accounts: [{ ...accounts[0], balance: -50 }],
      undeclaredRecurringCount: 3,
    });

    expect(insight.id).toBe('overdrawn');
  });

  it('flags credit use only when it is genuinely high', () => {
    const nearLimit = { ...accounts[1], balance: -1400 };
    expect(buildStatusInsight({ ...base, accounts: [nearLimit] }).id).toBe('high-utilization');

    // A routine balance is reported, not escalated: it ranks below the
    // beginning-of-month context, and never carries an "attention" tone.
    const routine = buildStatusInsight({ ...base, activity: activeActivity, accounts: [accounts[1]] });
    expect(routine.id).toBe('card-balance');
    expect(routine.tone).toBe('neutral');
    expect(routine.title).toBe('$213.37 outstanding on your cards');
  });

  it('surfaces recurring charges that need confirming', () => {
    const insight = buildStatusInsight({ ...base, undeclaredRecurringCount: 3 });

    expect(insight.id).toBe('recurring-review');
    expect(insight.title).toBe('3 possible recurring charges to confirm');
  });

  it('frames a goal as distance remaining so it resolves when reached', () => {
    const insight = buildStatusInsight({ ...base, goals: [goal({ current_amount: 3000 })] });

    expect(insight.id).toBe('goal-next');
    expect(insight.title).toBe('$7,000.00 to go on Education');
  });

  it('celebrates a completed goal without alarming language', () => {
    const insight = buildStatusInsight({ ...base, goals: [goal({ current_amount: 10000 })] });

    expect(insight.id).toBe('goals-complete');
    expect(insight.tone).toBe('positive');
    expect(insight.title).toBe('Your Education goal is complete');
  });

  it('falls back to beginning-of-month context when nothing else applies', () => {
    const insight = buildStatusInsight(base);

    expect(insight.id).toBe('no-activity');
    expect(insight.title).toBe('No posted activity yet');
  });

  it('yields the beginning-of-month message when the hero already shows it', () => {
    const insight = buildStatusInsight({ ...base, heroShowsActivityContext: true });

    // One message per screen, not the same sentence twice.
    expect(insight.id).not.toBe('no-activity');
    expect(insight.id).toBe('all-clear');
  });

  it('states something real in the all-clear state', () => {
    const active = buildMonthActivity({
      transactions: [tx('2026-08-01', 3000, { category_id: 11 }), tx('2026-08-02', -50, { category_id: 10 })],
      month: '2026-08',
      today: EARLY_AUGUST,
      income: 3000,
      expenses: 50,
      dataIncomplete: false,
    });

    const insight = buildStatusInsight({
      ...base,
      activity: active,
      lastCompleted: { month: '2026-07', net: 7405 },
    });

    expect(insight.id).toBe('all-clear-summary');
    expect(insight.tone).toBe('positive');
    expect(insight.title).toBe('$7,405.00 left after expenses in July 2026');
  });
});

// ── Shared money definitions ──────────────────────────────────────────────────

describe('Overview uses the shared classifier', () => {
  it('excludes credit-card payments from income', () => {
    const metrics = calculatePeriodMetrics(
      [tx('2026-08-01', 300, { account_id: 2 })],
      ctx,
    );

    expect(metrics.income).toBe(0);
    expect(metrics.cardPayments).toBe(300);
  });

  it('nets a refund against spending rather than counting it as income', () => {
    const metrics = calculatePeriodMetrics(
      [tx('2026-08-01', -100, { category_id: 10 }), tx('2026-08-03', 30, { category_id: 10 })],
      ctx,
    );

    expect(metrics.income).toBe(0);
    expect(metrics.expenses).toBe(70);
    expect(metrics.grossExpenses).toBe(100);
    expect(metrics.refunds).toBe(30);
  });

  it('treats a refund onto a card as a refund, not a card payment', () => {
    const metrics = calculatePeriodMetrics(
      [tx('2026-08-01', -100, { account_id: 2, category_id: 10 }), tx('2026-08-03', 25, { account_id: 2, category_id: 10 })],
      ctx,
    );

    expect(metrics.refunds).toBe(25);
    expect(metrics.cardPayments).toBe(0);
  });

  it('carries those rules through the spending comparison', () => {
    // July: $100 spent, $40 refunded → $60. August: a $300 card payment only.
    const result = buildSpendingComparison({
      transactions: [
        tx('2026-07-02', -100, { category_id: 10 }),
        tx('2026-07-03', 40, { category_id: 10 }),
        tx('2026-08-01', 300, { account_id: 2 }),
      ],
      month: '2026-08',
      today: EARLY_AUGUST,
      ctx,
      currentExpenses: 0,
    });

    expect(result.kind).toBe('prior-total');
    expect(result.text).toBe('July total: $60.00');
  });

  it('agrees with the analytics month total it is built from', () => {
    const monthTx = [
      tx('2026-08-01', 3000, { category_id: 11 }),
      tx('2026-08-02', -120, { category_id: 10 }),
      tx('2026-08-03', 20, { category_id: 10 }),
      tx('2026-08-04', 300, { account_id: 2 }),
    ];
    const metrics = calculatePeriodMetrics(monthTx, ctx);
    const activity = buildMonthActivity({
      transactions: monthTx,
      month: '2026-08',
      today: EARLY_AUGUST,
      income: metrics.income,
      expenses: metrics.expenses,
      dataIncomplete: false,
    });

    expect(metrics.income).toBe(3000);
    expect(metrics.expenses).toBe(100);
    expect(activity.state).toBe('active');
    expect(activity.postedCount).toBe(4);
  });
});
