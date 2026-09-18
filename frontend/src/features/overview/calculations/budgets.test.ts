import { describe, expect, it } from 'vitest';
import type { BudgetProgress, BudgetProgressSummary } from '../../../types';
import { describeBudget, summarizeBudgets } from './budgets';

const progress = (over: Partial<BudgetProgress> = {}): BudgetProgress => ({
  id: 1, category_id: 10, category_name: 'Groceries', category_color: '#f5a623', month: '2026-09',
  amount: '400.00', carried: '0.00', available: '400.00', spent: '120.00', remaining: '280.00',
  percent: '30.0', over: false, rollover: false, ...over,
});

describe('describeBudget', () => {
  it('reads as room while under 90 %', () => {
    const view = describeBudget(progress());
    expect(view.tone).toBe('room');
    expect(view.percent).toBe(30);
    expect(view.statusLabel).toBe('$280.00 left');
    expect(view.color).toBe('var(--accent)');
  });

  it('turns tight at 90 % and over past the allowance', () => {
    expect(describeBudget(progress({ spent: '365.00', remaining: '35.00' })).tone).toBe('tight');
    const over = describeBudget(progress({ spent: '450.00', remaining: '-50.00', over: true }));
    expect(over.tone).toBe('over');
    expect(over.percent).toBe(100);
    expect(over.rawPercent).toBeCloseTo(112.5);
    expect(over.statusLabel).toBe('$50.00 over');
    expect(over.color).toBe('var(--neg)');
  });

  it('treats a zero allowance with spending as fully used', () => {
    expect(describeBudget(progress({ available: '0.00', spent: '5.00', remaining: '-5.00', over: true })).percent).toBe(100);
  });
});

describe('summarizeBudgets', () => {
  const summary: BudgetProgressSummary = {
    month: '2026-09', budgeted: '1000.00', spent: '700.00', remaining: '300.00', over_count: 1,
    budgets: [
      progress({ id: 1, category_name: 'Groceries', spent: '120.00', remaining: '280.00' }),
      progress({ id: 2, category_name: 'Dining', amount: '200.00', available: '200.00', spent: '260.00', remaining: '-60.00', over: true }),
      progress({ id: 3, category_name: 'Fuel', amount: '400.00', available: '400.00', spent: '370.00', remaining: '30.00' }),
    ],
  };

  it('orders worst first and carries the totals through', () => {
    const view = summarizeBudgets(summary, new Date(2026, 8, 20));
    expect(view.items.map(i => i.name)).toEqual(['Dining', 'Fuel', 'Groceries']);
    expect(view.budgeted).toBe(1000);
    expect(view.spent).toBe(700);
    expect(view.overCount).toBe(1);
  });

  it('judges pace against the calendar', () => {
    expect(summarizeBudgets(summary, new Date(2026, 8, 3)).paceLabel).toBe('Spending ahead of the month');
    expect(summarizeBudgets(summary, new Date(2026, 8, 21)).paceLabel).toBe('On pace');
    expect(summarizeBudgets(summary, new Date(2026, 8, 30)).paceLabel).toBe('Under pace');
    expect(summarizeBudgets({ ...summary, spent: '1200.00' }, new Date(2026, 8, 30)).paceLabel).toBe('Over for the month');
    expect(summarizeBudgets(null, new Date(2026, 8, 30)).paceLabel).toBe('No budgets yet');
  });
});
