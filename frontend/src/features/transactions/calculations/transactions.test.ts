import type { Account, Category, Transaction } from '../../../types';
import { buildClassificationContext } from '../../analytics/calculations/transactions';
import { buildBoard, categoryTotal } from './board';
import { dayHeading, groupByDay } from './timeline';

/**
 * Review-board ordering and Timeline day grouping.
 *
 * Both are pure, so both are tested here rather than through the page. The
 * grouping tests lean hard on local dates: `transaction_date` is a plain
 * `YYYY-MM-DD` string, and the moment anything routes it through `Date` and
 * back, evening transactions start landing on the wrong day for half the world.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 4200, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Rewards Card', type: 'credit_card', balance: -200, credit_limit: 1500, currency: 'USD', created_at: '', updated_at: '' },
];

const cat = (id: number, name: string, type: 'income' | 'expense'): Category =>
  ({ id, user_id: 1, name, type, color: '#abc', is_system: false, created_at: '' });

const groceries = cat(10, 'Groceries', 'expense');
const rent = cat(11, 'Rent', 'expense');
const dining = cat(12, 'Dining', 'expense');
const salary = cat(20, 'Salary', 'income');
const unused = cat(30, 'Zoo Trips', 'expense');
const alsoUnused = cat(31, 'Aardvark Fund', 'expense');

const categories = [groceries, rent, dining, salary, unused, alsoUnused];
const ctx = buildClassificationContext(accounts, categories);

let nextId = 1;
const tx = (date: string, amount: number, overrides: Partial<Transaction> = {}): Transaction => ({
  id: nextId++, user_id: 1, account_id: 1, category_id: null, amount,
  description: 'Entry', transaction_date: date, created_at: '', ...overrides,
});

// ── Board ─────────────────────────────────────────────────────────────────────

describe('buildBoard ordering', () => {
  const month = [
    tx('2026-08-02', -80, { category_id: groceries.id }),
    tx('2026-08-03', -1400, { category_id: rent.id }),
    tx('2026-08-04', -25, { category_id: dining.id }),
    tx('2026-08-01', 3000, { category_id: salary.id }),
  ];

  it('puts the biggest spending first', () => {
    const { active } = buildBoard(categories, month, ctx);

    expect(active.map(c => c.category.name).slice(0, 3)).toEqual(['Rent', 'Groceries', 'Dining']);
  });

  it('keeps income after spending rather than interleaving by magnitude', () => {
    const { active } = buildBoard(categories, month, ctx);

    // Salary is the largest number on the board but it is not spending, so
    // ranking it first would compare unlike things.
    expect(active[active.length - 1].category.name).toBe('Salary');
    expect(active[0].category.name).toBe('Rent');
  });

  it('separates categories with no activity', () => {
    const { active, empty } = buildBoard(categories, month, ctx);

    expect(active.map(c => c.category.name)).not.toContain('Zoo Trips');
    expect(empty.map(c => c.name)).toEqual(['Aardvark Fund', 'Zoo Trips']);
  });

  it('sorts empty categories alphabetically for findability', () => {
    const { empty } = buildBoard(categories, [], ctx);

    expect(empty.map(c => c.name)).toEqual(
      ['Aardvark Fund', 'Dining', 'Groceries', 'Rent', 'Salary', 'Zoo Trips'],
    );
  });

  it('keeps a fully refunded category active rather than hiding it', () => {
    const refunded = [
      tx('2026-08-02', -40, { category_id: groceries.id }),
      tx('2026-08-06', 40, { category_id: groceries.id }),
    ];
    const { active, empty } = buildBoard(categories, refunded, ctx);

    const column = active.find(c => c.category.id === groceries.id);
    expect(column).toBeDefined();
    expect(column?.count).toBe(2);
    expect(column?.total).toBe(0);
    expect(empty.map(c => c.id)).not.toContain(groceries.id);
  });

  it('ignores uncategorized transactions', () => {
    const { active } = buildBoard(categories, [tx('2026-08-02', -80)], ctx);

    expect(active).toHaveLength(0);
  });

  it('breaks ties by name so the board does not reshuffle', () => {
    const tied = [
      tx('2026-08-02', -50, { category_id: rent.id }),
      tx('2026-08-02', -50, { category_id: dining.id }),
    ];
    const { active } = buildBoard(categories, tied, ctx);

    expect(active.map(c => c.category.name)).toEqual(['Dining', 'Rent']);
  });
});

describe('categoryTotal', () => {
  it('nets a refund against the category it came from', () => {
    const rows = [
      tx('2026-08-02', -120, { category_id: groceries.id }),
      tx('2026-08-09', 20, { category_id: groceries.id }),
    ];

    expect(categoryTotal(rows, groceries, ctx)).toBe(100);
  });

  it('does not count a card payment as income', () => {
    const rows = [
      tx('2026-08-01', 3000, { category_id: salary.id }),
      tx('2026-08-05', 300, { account_id: 2, category_id: salary.id }),
    ];

    expect(categoryTotal(rows, salary, ctx)).toBe(3000);
  });
});

// ── Timeline ──────────────────────────────────────────────────────────────────

const TODAY = new Date(2026, 7, 12); // 12 August 2026

describe('groupByDay', () => {
  it('groups transactions by calendar day, newest first', () => {
    const days = groupByDay([
      tx('2026-08-10', -10, { category_id: groceries.id }),
      tx('2026-08-12', -20, { category_id: groceries.id }),
      tx('2026-08-11', -30, { category_id: groceries.id }),
      tx('2026-08-12', -40, { category_id: groceries.id }),
    ], ctx, TODAY);

    expect(days.map(d => d.date)).toEqual(['2026-08-12', '2026-08-11', '2026-08-10']);
    expect(days[0].count).toBe(2);
  });

  it('preserves the order transactions arrive in within a day', () => {
    const first = tx('2026-08-12', -20, { category_id: groceries.id });
    const second = tx('2026-08-12', -40, { category_id: groceries.id });

    const [day] = groupByDay([first, second], ctx, TODAY);

    expect(day.transactions.map(t => t.id)).toEqual([first.id, second.id]);
  });

  it('uses the shared classifier for daily totals', () => {
    const [day] = groupByDay([
      tx('2026-08-12', 3000, { category_id: salary.id }),
      tx('2026-08-12', -120, { category_id: groceries.id }),
      tx('2026-08-12', 20, { category_id: groceries.id }),   // refund
      tx('2026-08-12', 300, { account_id: 2 }),               // card payment
    ], ctx, TODAY);

    expect(day.income).toBe(3000);
    expect(day.expenses).toBe(100);
    expect(day.net).toBe(2900);
    expect(day.cardPayments).toBe(300);
  });

  it('lets a refund reduce the day rather than inflate both sides', () => {
    const [day] = groupByDay([
      tx('2026-08-12', -50, { category_id: groceries.id }),
      tx('2026-08-12', 15, { category_id: groceries.id }),
    ], ctx, TODAY);

    expect(day.income).toBe(0);
    expect(day.expenses).toBe(35);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByDay([], ctx, TODAY)).toEqual([]);
  });
});

describe('dayHeading', () => {
  it('names today and yesterday', () => {
    expect(dayHeading('2026-08-12', TODAY)).toBe('Today');
    expect(dayHeading('2026-08-11', TODAY)).toBe('Yesterday');
  });

  it('omits the year within the current year and shows it otherwise', () => {
    expect(dayHeading('2026-07-31', TODAY)).toBe('Jul 31');
    expect(dayHeading('2025-07-31', TODAY)).toBe('Jul 31, 2025');
  });

  it('crosses a month boundary without drifting', () => {
    const firstOfMonth = new Date(2026, 7, 1);

    expect(dayHeading('2026-08-01', firstOfMonth)).toBe('Today');
    expect(dayHeading('2026-07-31', firstOfMonth)).toBe('Yesterday');
  });

  it('crosses a year boundary without drifting', () => {
    const newYearsDay = new Date(2026, 0, 1);

    expect(dayHeading('2026-01-01', newYearsDay)).toBe('Today');
    expect(dayHeading('2025-12-31', newYearsDay)).toBe('Yesterday');
  });

  it('does not shift a late-evening transaction into the next day', () => {
    // 23:30 local on the 12th. Anything that round-trips through UTC would
    // call this the 13th for every timezone east of UTC.
    const lateEvening = new Date(2026, 7, 12, 23, 30);

    expect(dayHeading('2026-08-12', lateEvening)).toBe('Today');
  });

  it('groups by the stored local date regardless of the clock', () => {
    const days = groupByDay(
      [tx('2026-08-12', -10, { category_id: groceries.id })],
      ctx,
      new Date(2026, 7, 12, 23, 59),
    );

    expect(days[0].date).toBe('2026-08-12');
    expect(days[0].label).toBe('Today');
  });
});
