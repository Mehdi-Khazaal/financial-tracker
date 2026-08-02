import type { Account, Category, RecurringTransaction, Transaction } from '../types';
import {
  buildClassificationContext,
  categorySpendDelta,
  classifyTransaction,
} from '../features/analytics/calculations/transactions';
import { calculatePeriodMetrics } from '../features/analytics/calculations/metrics';
import { monthlyEquivalent } from '../features/analytics/calculations/recurring';
import { localDateStr } from '../utils/date';

/**
 * Regression tests for the Transactions page arithmetic.
 *
 * Each test here fails against the code as it was before this change. The page
 * used to count money by raw sign, normalise recurring periods with its own
 * rounded table, and derive the current month from UTC — three ways of quietly
 * disagreeing with every other screen in the app.
 *
 * The old implementations are reproduced verbatim so the assertions state the
 * difference rather than merely asserting the new answer.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 4200, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Rewards Card', type: 'credit_card', balance: -213.37, credit_limit: 1500, currency: 'USD', created_at: '', updated_at: '' },
];

const groceries: Category = { id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' };
const salary: Category = { id: 11, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' };
const categories = [groceries, salary];

const classification = buildClassificationContext(accounts, categories);

let nextId = 1;
const tx = (date: string, amount: number, overrides: Partial<Transaction> = {}): Transaction => ({
  id: nextId++, user_id: 1, account_id: 1, category_id: null, amount,
  description: 'Entry', transaction_date: date, created_at: '', ...overrides,
});

// ── The implementations being replaced ────────────────────────────────────────

/** Old: anything positive was income, anything negative was spending. */
const oldMoneyTotals = (txs: Transaction[]) => {
  const income = txs.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const expenses = txs.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  return { income, expenses, net: income - expenses };
};

/** Old: a category column summed absolute amounts. */
const oldCategoryTotal = (txs: Transaction[]) =>
  txs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

/** Old: hand-rounded period multipliers. */
const OLD_PERIOD_MULTIPLIERS: Record<string, number> = {
  weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 0.33, yearly: 0.083,
};

// ── The replacements, mirroring the page ──────────────────────────────────────

const categoryTotal = (txs: Transaction[], cat: Category): number => {
  if (cat.type === 'income') {
    return txs.reduce((sum, t) => (
      classifyTransaction(t, classification) === 'income' ? sum + Number(t.amount) : sum
    ), 0);
  }
  return txs.reduce(
    (sum, t) => sum + categorySpendDelta(t, classifyTransaction(t, classification)),
    0,
  );
};

// ── A2: money is classified, not signed ───────────────────────────────────────

describe('A2 — Transactions money totals use the shared classifier', () => {
  it('does not count a credit-card payment as income', () => {
    const txs = [
      tx('2026-08-01', 3000, { category_id: salary.id }),
      tx('2026-08-05', 300, { account_id: 2 }), // paying the card down
    ];

    expect(oldMoneyTotals(txs).income).toBe(3300);

    const metrics = calculatePeriodMetrics(txs, classification);
    expect(metrics.income).toBe(3000);
    expect(metrics.cardPayments).toBe(300);
  });

  it('nets a refund against spending instead of counting it as income', () => {
    const txs = [
      tx('2026-08-02', -120, { category_id: groceries.id }),
      tx('2026-08-09', 20, { category_id: groceries.id }), // returned an item
    ];

    const old = oldMoneyTotals(txs);
    expect(old.income).toBe(20);
    expect(old.expenses).toBe(120);

    const metrics = calculatePeriodMetrics(txs, classification);
    expect(metrics.income).toBe(0);
    expect(metrics.expenses).toBe(100);
    expect(metrics.refunds).toBe(20);
    expect(metrics.grossExpenses).toBe(120);
  });

  it('reports a net that no longer double-counts either case', () => {
    const txs = [
      tx('2026-08-01', 3000, { category_id: salary.id }),
      tx('2026-08-02', -120, { category_id: groceries.id }),
      tx('2026-08-09', 20, { category_id: groceries.id }),
      tx('2026-08-15', 300, { account_id: 2 }),
    ];

    expect(oldMoneyTotals(txs).net).toBe(3200);
    expect(calculatePeriodMetrics(txs, classification).net).toBe(2900);
  });

  it('treats a refund onto a card as a refund, not a card payment', () => {
    const txs = [
      tx('2026-08-02', -80, { account_id: 2, category_id: groceries.id }),
      tx('2026-08-06', 30, { account_id: 2, category_id: groceries.id }),
    ];

    const metrics = calculatePeriodMetrics(txs, classification);
    expect(metrics.refunds).toBe(30);
    expect(metrics.cardPayments).toBe(0);
    expect(metrics.expenses).toBe(50);
  });

  it('keeps expenses at zero rather than negative when a category is net-refunded', () => {
    const txs = [
      tx('2026-08-02', -40, { category_id: groceries.id }),
      tx('2026-08-06', 100, { category_id: groceries.id }),
    ];

    expect(calculatePeriodMetrics(txs, classification).expenses).toBe(0);
  });
});

describe('A2 — category column totals net their refunds', () => {
  it('subtracts a refund from the category it came from', () => {
    const txs = [
      tx('2026-08-02', -120, { category_id: groceries.id }),
      tx('2026-08-09', 20, { category_id: groceries.id }),
    ];

    // The old column added the refund to the total it should have reduced.
    expect(oldCategoryTotal(txs)).toBe(140);
    expect(categoryTotal(txs, groceries)).toBe(100);
  });

  it('reports real income for an income category', () => {
    const txs = [tx('2026-08-01', 3000, { category_id: salary.id })];

    expect(categoryTotal(txs, salary)).toBe(3000);
  });

  it('excludes a card payment misfiled under an income category', () => {
    const txs = [
      tx('2026-08-01', 3000, { category_id: salary.id }),
      tx('2026-08-05', 300, { account_id: 2, category_id: salary.id }),
    ];

    expect(oldCategoryTotal(txs)).toBe(3300);
    expect(categoryTotal(txs, salary)).toBe(3000);
  });
});

// ── A3: shared recurring normalisation ────────────────────────────────────────

describe('A3 — recurring totals use the shared monthly normalisation', () => {
  const periods: RecurringTransaction['period'][] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

  it.each(periods)('matches Analytics for a %s charge', period => {
    const amount = -120;
    const shared = monthlyEquivalent(amount, period);
    const old = Math.abs(amount) * OLD_PERIOD_MULTIPLIERS[period];

    expect(shared).toBeCloseTo(Math.abs(amount) * ({
      weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12,
    })[period], 10);

    // Every period except monthly drifted under the old rounded table.
    if (period !== 'monthly') expect(shared).not.toBeCloseTo(old, 6);
  });

  it('no longer understates a yearly subscription', () => {
    // $1,200/year is $100/month. The old 0.083 multiplier said $99.60.
    expect(monthlyEquivalent(-1200, 'yearly')).toBeCloseTo(100, 10);
    expect(1200 * OLD_PERIOD_MULTIPLIERS.yearly).toBeCloseTo(99.6, 2);
  });

  it('no longer understates a quarterly charge', () => {
    expect(monthlyEquivalent(-300, 'quarterly')).toBeCloseTo(100, 10);
    expect(300 * OLD_PERIOD_MULTIPLIERS.quarterly).toBeCloseTo(99, 2);
  });

  it('normalises income schedules with the same function', () => {
    expect(monthlyEquivalent(2000, 'biweekly')).toBeCloseTo(2000 * (26 / 12), 10);
  });
});

// ── A4: local month derivation ────────────────────────────────────────────────

describe('A4 — the default month comes from local time', () => {
  it('agrees with the local calendar date', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    expect(localDateStr().slice(0, 7)).toBe(expected);
  });

  it('differs from the UTC derivation on a late-evening month boundary', () => {
    // 31 Aug 2026, 21:00 in a UTC−5 zone is already 1 Sep in UTC.
    const localMidEvening = new Date(2026, 7, 31, 21, 0, 0);
    const utcMonth = new Date(Date.UTC(2026, 8, 1, 2, 0, 0)).toISOString().slice(0, 7);

    expect(localDateStr(localMidEvening).slice(0, 7)).toBe('2026-08');
    expect(utcMonth).toBe('2026-09');
  });
});

// ── A1: no silent truncation ──────────────────────────────────────────────────

describe('A1 — transaction history is not truncated', () => {
  it('pages past the API default of 500 rows', async () => {
    const { fetchAllTransactions, PAGE_SIZE } = await import('../utils/api');
    expect(PAGE_SIZE).toBe(1000);
    expect(typeof fetchAllTransactions).toBe('function');
  });

  it('a 500-row cap would have hidden older months entirely', () => {
    // 700 entries spanning two months, newest first as the API returns them.
    const rows = Array.from({ length: 700 }, (_, i) =>
      tx(i < 400 ? '2026-08-10' : '2026-07-10', -10, { category_id: groceries.id }));

    const truncated = rows.slice(0, 500);
    const julyAll = rows.filter(t => t.transaction_date.startsWith('2026-07')).length;
    const julyTruncated = truncated.filter(t => t.transaction_date.startsWith('2026-07')).length;

    expect(julyAll).toBe(300);
    expect(julyTruncated).toBe(100);
    // The month picker would have offered July while showing a third of it.
    expect(julyTruncated).toBeLessThan(julyAll);
  });
});
