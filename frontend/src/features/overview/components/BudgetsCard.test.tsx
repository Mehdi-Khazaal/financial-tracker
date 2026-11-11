import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BudgetsCard from './BudgetsCard';
import type { BudgetProgress, BudgetProgressSummary } from '../../../types';

const progress = (over: Partial<BudgetProgress>): BudgetProgress => ({
  id: 1, category_id: 10, category_name: 'Groceries', category_color: '#fff', month: '2026-09',
  amount: '400.00', carried: '0.00', available: '400.00', spent: '120.00', remaining: '280.00',
  percent: '30.0', over: false, rollover: false, ...over,
});

const today = new Date(2026, 8, 15);

describe('BudgetsCard', () => {
  it('invites the first budget when there are none', () => {
    const onManage = vi.fn();
    render(<BudgetsCard summary={{ month: '2026-09', budgeted: '0', spent: '0', remaining: '0', over_count: 0, budgets: [] }} today={today} onManage={onManage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a budget →' }));
    expect(onManage).toHaveBeenCalled();
  });

  it('lists the worst budget first with a plain-words status', () => {
    const summary: BudgetProgressSummary = {
      month: '2026-09', budgeted: '600.00', spent: '380.00', remaining: '220.00', over_count: 1,
      budgets: [
        progress({ id: 1, category_name: 'Groceries' }),
        progress({ id: 2, category_name: 'Dining', amount: '200.00', available: '200.00', spent: '260.00', remaining: '-60.00', over: true }),
      ],
    };
    render(<BudgetsCard summary={summary} today={today} onManage={vi.fn()} />);
    const rows = screen.getAllByText(/^(Groceries|Dining)$/).map(el => el.textContent);
    expect(rows).toEqual(['Dining', 'Groceries']);
    expect(screen.getByText('$60.00 over')).toBeInTheDocument();
    expect(screen.getByText('$280.00 left')).toBeInTheDocument();
    expect(screen.getByText('1 over')).toBeInTheDocument();
  });

  it('totals two or more budgets, and leaves a single one to speak for itself', () => {
    const one: BudgetProgressSummary = {
      month: '2026-09', budgeted: '200.00', spent: '0.00', remaining: '200.00', over_count: 0,
      budgets: [progress({ category_name: 'Whish', amount: '200.00', available: '200.00', spent: '0.00', remaining: '200.00', percent: '0.0' })],
    };
    const { unmount } = render(<BudgetsCard summary={one} today={today} onManage={vi.fn()} />);
    expect(screen.queryByText('All budgets')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: "Share of this month's budgets spent" })).not.toBeInTheDocument();
    expect(screen.getByText('Whish')).toBeInTheDocument();
    unmount();

    const two: BudgetProgressSummary = {
      ...one, budgeted: '600.00', spent: '120.00',
      budgets: [...one.budgets, progress({ id: 2, category_name: 'Groceries' })],
    };
    render(<BudgetsCard summary={two} today={today} onManage={vi.fn()} />);
    expect(screen.getByText('All budgets')).toBeInTheDocument();
  });

  it('says so when the source failed instead of pretending there are no budgets', () => {
    render(<BudgetsCard summary={null} today={today} onManage={vi.fn()} unavailable />);
    expect(screen.getByText('Budgets could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Set a budget →')).not.toBeInTheDocument();
  });
});
