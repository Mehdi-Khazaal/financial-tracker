import { billAmount, dueLine, needsAttention, num, paidShare, priceRise, shortDate } from './calculations';
import type { RecurringBill, RecurringOverview } from '../../types';

const bill = (overrides: Partial<RecurringBill>): RecurringBill => ({
  id: 1, user_id: 1, account_id: 1, category_id: null, amount: '-15.49', description: 'Netflix',
  period: 'monthly', next_date: '2026-10-03', is_active: true, is_variable: false, created_at: '2026-01-01',
  group_key: 'subscriptions', group_label: 'Subscriptions', account_name: 'Checking', category_name: null,
  linked: true, status: 'upcoming', status_label: 'Upcoming', days_until: 17, monthly_amount: '15.49',
  paid_this_month: '0', remaining_this_month: '0', last_paid_date: null, previous_amount: null,
  ...overrides,
});

describe('recurring calculations', () => {
  it('parses API decimal strings safely', () => {
    expect(num('12.50')).toBe(12.5);
    expect(num(null)).toBe(0);
    expect(num('nope')).toBe(0);
  });

  it('formats dates without timezone drift', () => {
    expect(shortDate('2026-09-01')).toBe('Sep 1');
    expect(shortDate('2026-12-31T00:00:00')).toBe('Dec 31');
  });

  it('describes each status in one line', () => {
    expect(dueLine(bill({ status: 'paid', last_paid_date: '2026-09-03' }))).toBe('Paid Sep 3 · next Oct 3');
    expect(dueLine(bill({ status: 'due_soon', days_until: 0 }))).toBe('Due today');
    expect(dueLine(bill({ status: 'due_soon', days_until: 1 }))).toBe('Due tomorrow');
    expect(dueLine(bill({ status: 'due_soon', days_until: 4 }))).toBe('Due in 4 days');
    expect(dueLine(bill({ status: 'missed', next_date: '2026-09-01' }))).toBe('Due Sep 1 · not seen from the bank');
    expect(dueLine(bill({ status: 'upcoming' }))).toBe('Due Oct 3');
  });

  it('clamps the paid share', () => {
    expect(paidShare({ paid_this_month: '50', expected_this_month: '200' })).toBe(0.25);
    expect(paidShare({ paid_this_month: '0', expected_this_month: '0' })).toBe(0);
    expect(paidShare({ paid_this_month: '300', expected_this_month: '200' })).toBe(1);
  });

  it('reports only real price rises on fixed bills', () => {
    expect(priceRise(bill({ amount: '-17.99', previous_amount: '-15.49' }))).toBeCloseTo(2.5);
    expect(priceRise(bill({ amount: '-12.99', previous_amount: '-15.49' }))).toBeNull();
    expect(priceRise(bill({ amount: '-99', previous_amount: '-80', is_variable: true }))).toBeNull();
  });

  it('orders what needs attention: missed, then overdue, then soonest due', () => {
    const overview = {
      groups: [
        { key: 'housing', label: 'Housing', monthly_total: '0', paid_this_month: '0', remaining_this_month: '0', bills: [
          bill({ id: 1, status: 'due_soon', days_until: 5 }),
          bill({ id: 2, status: 'missed', days_until: -12 }),
          bill({ id: 3, status: 'paid' }),
          bill({ id: 4, status: 'due_soon', days_until: 1 }),
        ] },
      ],
    } as unknown as RecurringOverview;
    expect(needsAttention(overview).map(b => b.id)).toEqual([2, 4, 1]);
  });

  it('marks estimated amounts', () => {
    const fmt = (n: number) => `$${n.toFixed(2)}`;
    expect(billAmount('-84.1', true, fmt)).toBe('~$84.10');
    expect(billAmount('-15.49', false, fmt)).toBe('$15.49');
  });
});
