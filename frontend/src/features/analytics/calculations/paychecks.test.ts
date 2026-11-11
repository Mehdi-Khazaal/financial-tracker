import type { Account, Category, RecurringTransaction, Transaction } from '../../../types';
import { buildClassificationContext } from './transactions';
import { calculatePeriodMetrics } from './metrics';
import { expectedPaychecks, payerRhythms } from './paychecks';
import { calculateForecast } from './forecast';
import { resolvePeriod } from '../period';

/**
 * Pay shaped like the owner's: two employers, both every other Friday-ish.
 * Philips went part time in August (≈$957 a paycheck, with one overtime check
 * of $1,835 on Nov 7) and paid nothing on Oct 24. Passavant varies with
 * overtime and once split a paycheck into two deposits on the same day.
 * On Nov 10 the Dashboard said "spend $33.41 more than you earn" because the
 * Nov 21 paychecks were not counted.
 */
const CHECKING = 1;
const SALARY = 11;
const INTEREST = 12;
const SCHOLARSHIP = 13;
const GROCERIES = 14;

const accounts: Account[] = [
  { id: CHECKING, user_id: 1, name: 'Spend', type: 'checking', balance: 700, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
];
const categories: Category[] = [
  { id: SALARY, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
  { id: INTEREST, user_id: 1, name: 'Interest', type: 'income', color: '#1e1', is_system: false, created_at: '' },
  { id: SCHOLARSHIP, user_id: 1, name: 'Scholarships', type: 'income', color: '#1e1', is_system: false, created_at: '' },
  { id: GROCERIES, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' },
];
const ctx = buildClassificationContext(accounts, categories);

let nextId = 1;
const deposit = (transaction_date: string, amount: number, description: string, category_id = SALARY): Transaction => ({
  id: nextId++, user_id: 1, account_id: CHECKING, category_id, amount, description, transaction_date, created_at: '',
  merchant_key: description.toLowerCase(),
});

const philips = [
  ...['2026-05-22', '2026-06-05', '2026-06-19', '2026-07-03', '2026-07-18', '2026-07-31'].map(d => deposit(d, 1835.29, 'PHILIPS')),
  ...['2026-08-14', '2026-08-28', '2026-09-26', '2026-10-10'].map(d => deposit(d, 957.05, 'PHILIPS')),
  deposit('2026-09-12', 957.04, 'PHILIPS'),
  // Oct 24: nothing. Nov 7: overtime.
  deposit('2026-11-07', 1835.29, 'PHILIPS'),
];
const passavant = [
  deposit('2026-07-03', 1694.81, 'Passavant'),
  deposit('2026-07-18', 1126.83, 'Passavant'),
  deposit('2026-07-31', 1487.21, 'Passavant'),
  deposit('2026-08-14', 1200, 'Passavant'),
  deposit('2026-08-28', 1150, 'Passavant'),
  deposit('2026-09-12', 1165.76, 'Passavant'),
  deposit('2026-09-26', 1917.24, 'Passavant'),
  deposit('2026-09-26', 87.71, 'Passavant'),
  deposit('2026-10-10', 2235.35, 'Passavant'),
  deposit('2026-10-24', 1298.41, 'Passavant'),
  deposit('2026-11-07', 1187.06, 'Passavant'),
];
const noise = [
  ...['2026-07-04', '2026-08-06', '2026-09-04', '2026-10-06', '2026-11-05'].map(d => deposit(d, 0.11, 'INTEREST PAYMENT', INTEREST)),
  deposit('2026-05-30', 4385.5, 'Passavant Scholarship', SCHOLARSHIP),
];
const pay = [...philips, ...passavant, ...noise];
const TODAY_KEY = '2026-11-10';

describe('payerRhythms', () => {
  const rhythms = payerRhythms(pay, ctx, TODAY_KEY);
  const byKey = Object.fromEntries(rhythms.map(r => [r.key, r]));

  it('finds the two employers and nothing else', () => {
    expect(rhythms.map(r => r.key).sort()).toEqual(['passavant', 'philips']);
  });

  it('sizes a paycheck by recent pay, so part time is not averaged with full time', () => {
    expect(byKey.philips.typical).toBeCloseTo(957.05, 2);
    expect(byKey.philips.low).toBeCloseTo(957.04, 2);
    expect(byKey.philips.high).toBeCloseTo(1835.29, 2);
  });

  it('keeps a two-week rhythm through a skipped payday', () => {
    expect(byKey.philips.gapDays).toBe(14);
    expect(byKey.philips.lastPaid).toBe('2026-11-07');
  });

  it('treats a split deposit on one day as one paycheck', () => {
    // Sep 26 is $2,004.95, not a $1,917.24 paycheck and an $87.71 one.
    expect(byKey.passavant.low).toBe(1150);
    expect(byKey.passavant.typical).toBe(1200);
    expect(byKey.passavant.high).toBeCloseTo(2235.35, 2);
  });

  it('stops projecting a payer that has gone quiet', () => {
    expect(payerRhythms(pay, ctx, '2026-12-20')).toEqual([]);
  });
});

describe('expectedPaychecks', () => {
  const rhythms = payerRhythms(pay, ctx, TODAY_KEY);

  it('expects both employers on Nov 21 and nothing else in November', () => {
    const due = expectedPaychecks(rhythms, TODAY_KEY, '2026-11-30');
    expect(due.map(p => [p.key, p.on])).toEqual([['passavant', '2026-11-21'], ['philips', '2026-11-21']]);
  });

  it('counts a payday that falls today until its deposit arrives', () => {
    const due = expectedPaychecks(rhythms, '2026-11-21', '2026-11-30');
    expect(due).toHaveLength(2);
  });

  it('leaves a payer with its own recurring income entry to that entry', () => {
    const declared: RecurringTransaction = {
      id: 1, user_id: 1, account_id: CHECKING, category_id: SALARY, amount: 1200, description: 'Passavant',
      period: 'biweekly', next_date: '2026-11-21', is_active: true, is_variable: true, created_at: '',
    };
    const due = expectedPaychecks(rhythms, TODAY_KEY, '2026-11-30', [declared]);
    expect(due.map(p => p.key)).toEqual(['philips']);
  });
});

describe('the November 10 outlook', () => {
  const today = new Date(2026, 10, 10);
  const spending = ['2026-08', '2026-09', '2026-10'].flatMap(m => [
    deposit(`${m}-03`, -1500, 'Groceries', GROCERIES),
    deposit(`${m}-18`, -1500, 'Groceries', GROCERIES),
  ]);
  const november = [deposit('2026-11-03', -1088.62, 'Groceries', GROCERIES)];
  const transactions = [...pay, ...spending, ...november];
  const forecast = calculateForecast({
    period: resolvePeriod('this-month', { today, customMonth: '2026-11', earliestMonth: '2026-05' }),
    transactions,
    recurring: [],
    categories: [],
    monthly: ['2026-08', '2026-09', '2026-10'].map(month => ({
      month,
      metrics: calculatePeriodMetrics(transactions.filter(t => t.transaction_date.startsWith(month)), ctx),
    })),
    ctx,
    today,
  });

  it('counts the paychecks still due at their typical size', () => {
    const income = forecast.income!;
    expect(income.soFar).toBeCloseTo(3022.35 + 0.11, 2);
    expect(income.paychecks).toBe(2);
    expect(income.expected).toBeCloseTo(957.05 + 1200, 2);
    expect(income.projected).toBeCloseTo(income.soFar + income.expected, 2);
  });

  it('gives a range from the lowest to the highest recent pay', () => {
    const income = forecast.income!;
    expect(income.low).toBeCloseTo(income.soFar + 957.04 + 1150, 2);
    expect(income.high).toBeCloseTo(income.soFar + 1835.29 + 2235.35, 2);
    expect(forecast.savingsRange!.low).toBeCloseTo(income.low - forecast.expenses!.projected, 2);
    expect(forecast.savingsRange!.high).toBeCloseTo(income.high - forecast.expenses!.projected, 2);
  });

  it('no longer says more is spent than earned', () => {
    expect(forecast.savings!).toBeGreaterThan(1000);
    expect(forecast.basis).toContain('2 paychecks still due are counted at your typical recent pay');
  });
});
