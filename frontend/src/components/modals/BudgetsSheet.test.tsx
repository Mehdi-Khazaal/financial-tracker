import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import BudgetsSheet from './BudgetsSheet';
import { createBudget, deleteBudget, getBudgets, updateBudget } from '../../utils/api';
import type { Category } from '../../types';

const { mockConfirm, mockError } = vi.hoisted(() => ({ mockConfirm: vi.fn(), mockError: vi.fn() }));

vi.mock('../../utils/api', () => ({
  __esModule: true,
  getBudgets: vi.fn(),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  deleteBudget: vi.fn(),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ error: mockError, success: vi.fn(), info: vi.fn(), confirm: mockConfirm }),
}));

const category = (id: number, name: string, type: Category['type'] = 'expense'): Category => ({
  id, name, type, user_id: 1, color: '#fff', is_system: false, created_at: '2026-01-01',
});
const categories = [category(1, 'Groceries'), category(2, 'Dining'), category(3, 'Salary', 'income')];

beforeEach(() => {
  (getBudgets as Mock).mockResolvedValue({ data: [] });
  (createBudget as Mock).mockResolvedValue({ data: {} });
  (updateBudget as Mock).mockResolvedValue({ data: {} });
  (deleteBudget as Mock).mockResolvedValue({ data: {} });
  mockConfirm.mockResolvedValue(true);
});

const setup = (props: Partial<React.ComponentProps<typeof BudgetsSheet>> = {}) => {
  const onChanged = vi.fn();
  render(<BudgetsSheet isOpen onClose={vi.fn()} onChanged={onChanged} categories={categories} progress={null} {...props} />);
  return { onChanged };
};

describe('BudgetsSheet', () => {
  it('offers only expense categories without a budget, and sends the amount as typed', async () => {
    (getBudgets as Mock).mockResolvedValue({ data: [{ id: 9, category_id: 2, amount: '150.00', rollover: false, starts_on: '2026-09-01', is_active: true }] });
    const { onChanged } = setup();
    await screen.findByText('Dining');

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.textContent);
    expect(options).toEqual(['Choose a category', 'Groceries']);

    fireEvent.change(select, { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Monthly amount'), { target: { value: '400.50' } });
    fireEvent.click(screen.getByLabelText(/Roll unspent money/));
    fireEvent.click(screen.getByRole('button', { name: 'Set budget' }));

    await waitFor(() => expect(createBudget).toHaveBeenCalledWith({ category_id: 1, amount: '400.50', rollover: true }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(getBudgets).toHaveBeenCalledTimes(2);
  });

  it('surfaces the server reason when a budget is rejected', async () => {
    (createBudget as Mock).mockRejectedValue({ response: { data: { detail: 'Budgets apply to expense categories only' } } });
    setup();
    await screen.findByText('No budgets yet. Pick a category above.');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Monthly amount'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set budget' }));
    await waitFor(() => expect(mockError).toHaveBeenCalledWith('Budgets apply to expense categories only'));
  });

  it('edits an amount inline and toggles rollover', async () => {
    (getBudgets as Mock).mockResolvedValue({ data: [{ id: 9, category_id: 1, amount: '400.00', rollover: false, starts_on: '2026-09-01', is_active: true }] });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Groceries budget' }));
    fireEvent.change(screen.getByLabelText('New amount for Groceries'), { target: { value: '450' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateBudget).toHaveBeenCalledWith(9, { amount: '450' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Rollover for Groceries' }));
    await waitFor(() => expect(updateBudget).toHaveBeenCalledWith(9, { rollover: true }));
  });

  it('asks before removing and honours a refusal', async () => {
    (getBudgets as Mock).mockResolvedValue({ data: [{ id: 9, category_id: 1, amount: '400.00', rollover: false, starts_on: '2026-09-01', is_active: true }] });
    mockConfirm.mockResolvedValue(false);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Groceries budget' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(deleteBudget).not.toHaveBeenCalled();

    mockConfirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Groceries budget' }));
    await waitFor(() => expect(deleteBudget).toHaveBeenCalledWith(9));
  });

  it('shows this month\'s spend next to each budget when progress is known', async () => {
    (getBudgets as Mock).mockResolvedValue({ data: [{ id: 9, category_id: 1, amount: '400.00', rollover: true, starts_on: '2026-09-01', is_active: true }] });
    setup({
      progress: {
        month: '2026-09', budgeted: '400.00', spent: '120.00', remaining: '280.00', over_count: 0,
        budgets: [{ id: 9, category_id: 1, category_name: 'Groceries', category_color: '#fff', month: '2026-09', amount: '400.00', carried: '25.00', available: '425.00', spent: '120.00', remaining: '305.00', percent: '28.2', over: false, rollover: true }],
      },
    });
    expect(await screen.findByText('$120.00 of $425.00 · $25.00 carried')).toBeInTheDocument();
  });
});
