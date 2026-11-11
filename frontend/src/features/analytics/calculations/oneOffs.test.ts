import type { Account, Category, Transaction } from '../../../types';
import { buildClassificationContext } from './transactions';
import { automaticOneOff, findOneOffs, usualMonth } from './oneOffs';
import { calculateSavingsMetrics } from './savings';
import { resolvePeriod } from '../period';

/**
 * Big one-offs, mirrored from `tests/test_one_offs.py` on the server. The
 * live ledger kept $783 a month on a plain average; a $7,000 motorcycle, a
 * $3,050 car repair and $10,510 of tuition made the difference.
 */
const CHECKING = 1;
const SHOP = 10;
const SALARY = 11;
const TRANSFER = 12;
const GOLD = 13;

const accounts: Account[] = [
  { id: CHECKING, user_id: 1, name: 'Spend', type: 'checking', balance: 700, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
];
const categories: Category[] = [
  { id: SHOP, user_id: 1, name: 'Shopping', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: SALARY, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
  { id: TRANSFER, user_id: 1, name: 'Transfer', type: 'transfer', color: '#888', is_system: true, created_at: '' },
  { id: GOLD, user_id: 1, name: 'Gold', type: 'investment', color: '#fa0', is_system: false, created_at: '' },
];
const ctx = buildClassificationContext(accounts, categories);

let nextId = 1;
const tx = (date: string, amount: number, description: string, category_id = SHOP, one_off: boolean | null = null): Transaction => ({
  id: nextId++, user_id: 1, account_id: CHECKING, category_id, amount, description, transaction_date: date, created_at: '',
  merchant_key: description.toLowerCase(), one_off,
});

describe('findOneOffs', () => {
  const motorcycle = tx('2026-06-27', -7000, 'Withdrawal');
  const repair = tx('2026-04-11', -3050, 'Pulat Auto');
  const tuitionSummer = tx('2026-05-20', -2055, 'PSU Tuition');
  const tuitionFall = tx('2026-08-29', -8455, 'PSU Tuition');
  const rent = ['06', '07', '08'].map(m => tx(`2026-${m}-01`, -1500, 'Landlord'));
  const small = tx('2026-07-03', -999, 'Costco');
  const notSpending = [
    tx('2026-10-14', -8000, '2 Ounce Gold', GOLD),
    tx('2026-09-28', -1750, 'To Home', TRANSFER),
    tx('2026-05-30', 4385.5, 'Scholarship', SALARY),
  ];
  const all = [motorcycle, repair, tuitionSummer, tuitionFall, ...rent, small, ...notSpending];

  it('finds large charges that do not repeat, like the server', () => {
    const found = findOneOffs(all, ctx);
    expect([...found.keys()].sort()).toEqual([motorcycle.id, repair.id, tuitionSummer.id, tuitionFall.id].sort());
    expect(found.get(tuitionFall.id)).toMatchObject({ amount: 8455, month: '2026-08', automatic: true });
  });

  it('never counts rent, a small charge, gold, a transfer or income', () => {
    const found = findOneOffs(all, ctx);
    [...rent, small, ...notSpending].forEach(t => expect(found.has(t.id)).toBe(false));
  });

  it('follows the user’s mark either way', () => {
    const flight = tx('2026-10-19', -640, 'Turkish Airlines', SHOP, true);
    const routineBig = tx('2026-06-27', -7000, 'Withdrawal', SHOP, false);
    const found = findOneOffs([flight, routineBig], ctx);
    expect([...found.keys()]).toEqual([flight.id]);
    expect(found.get(flight.id)!.automatic).toBe(false);
  });

  it('says what the rule alone would decide, and nothing for money that is not spending', () => {
    const marked = { ...motorcycle, one_off: false };
    expect(automaticOneOff(marked, all, ctx)).toBe(true);
    expect(automaticOneOff(rent[0], all, ctx)).toBe(false);
    expect(automaticOneOff(notSpending[0], all, ctx)).toBeNull();
  });
});

describe('a usual month', () => {
  // Four months keeping $1,000, one of them with a $7,000 motorcycle.
  const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
  const transactions = months.flatMap(m => [tx(`${m}-01`, 4000, 'Employer', SALARY), tx(`${m}-06`, -3000, 'Everything')]);
  transactions.push(tx('2026-08-10', -7000, 'Withdrawal'));
  const today = new Date(2026, 10, 10);
  const savings = calculateSavingsMetrics({
    transactions,
    goals: [],
    period: resolvePeriod('this-month', { today, customMonth: '2026-11', earliestMonth: '2026-07' }),
    baseline: months,
    ctx,
    today,
  });

  it('adds the one-offs back, so goals are funded from what a month keeps', () => {
    const usual = usualMonth(transactions, ctx, months, savings.averageMonthlySaved);
    expect(savings.averageMonthlySaved).toBe(-750);
    expect(usual.usualMonthlySaved).toBe(1000);
    expect(usual.oneOffMonthly).toBe(1750);
    expect(usual.oneOffs.map(o => o.transaction.description)).toEqual(['Withdrawal']);
  });

  it('has no usual month without months to average', () => {
    expect(usualMonth(transactions, ctx, [], null)).toEqual({ usualMonthlySaved: null, oneOffs: [], oneOffMonthly: 0 });
  });
});
