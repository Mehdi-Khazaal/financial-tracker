import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SplitEditor from './SplitEditor';
import { clearTransactionSplits, setTransactionSplits } from '../../../utils/api';
import type { Category, Transaction } from '../../../types';

const { mockSuccess, mockError } = vi.hoisted(() => ({ mockSuccess: vi.fn(), mockError: vi.fn() }));

vi.mock('../../../utils/api', () => ({
  __esModule: true,
  setTransactionSplits: vi.fn(),
  clearTransactionSplits: vi.fn(),
}));
vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({ error: mockError, success: mockSuccess, info: vi.fn(), confirm: vi.fn() }),
}));

const cat = (id: number, name: string, type: Category['type'] = 'expense'): Category => ({ id, name, type, color: '#fff', user_id: 1, is_system: false, created_at: '' });
const categories = [cat(10, 'Groceries'), cat(11, 'Household'), cat(12, 'Salary', 'income')];
const shop: Transaction = { id: 7, user_id: 1, account_id: 1, category_id: 10, amount: -100, description: 'COSTCO', transaction_date: '2026-07-08', created_at: '' };

beforeEach(() => {
  (setTransactionSplits as Mock).mockResolvedValue({ data: {} });
  (clearTransactionSplits as Mock).mockResolvedValue({ data: {} });
});

describe('SplitEditor', () => {
  it('offers only categories for the direction and balances the first part as others are typed', async () => {
    const onDone = vi.fn();
    render(<SplitEditor transaction={shop} categories={categories} onDone={onDone} onCancel={vi.fn()} />);
    const firstCategory = screen.getByLabelText('Part 1 category') as HTMLSelectElement;
    expect(Array.from(firstCategory.options).map(o => o.textContent)).toEqual(['Category', 'Groceries', 'Household']);
    expect(screen.getByLabelText('Part 1 amount')).toHaveValue('100.00');
    expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Part 2 category'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Part 2 amount'), { target: { value: '40' } });
    expect(screen.getByLabelText('Part 1 amount')).toHaveValue('60.00');
    expect(screen.getByRole('status')).toHaveTextContent('Adds up');

    fireEvent.change(screen.getByLabelText('Part 2 note'), { target: { value: 'bin bags' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save split' }));
    await waitFor(() => expect(setTransactionSplits).toHaveBeenCalledWith(7, [
      { category_id: 10, amount: '-60.00', note: null },
      { category_id: 11, amount: '-40.00', note: 'bin bags' },
    ]));
    expect(onDone).toHaveBeenCalled();
    expect(mockSuccess).toHaveBeenCalledWith('Split saved');
  });

  it('stops balancing once the first part is typed in, and says which way it is off', () => {
    render(<SplitEditor transaction={shop} categories={categories} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Part 1 amount'), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText('Part 2 category'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Part 2 amount'), { target: { value: '40' } });
    expect(screen.getByLabelText('Part 1 amount')).toHaveValue('70');
    expect(screen.getByRole('status')).toHaveTextContent('$10.00 too much');
    expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled();
  });

  it('shows the server reason, and can remove an existing split', async () => {
    (setTransactionSplits as Mock).mockRejectedValue({ response: { data: { detail: 'Category not found' } } });
    const onDone = vi.fn();
    const split: Transaction = { ...shop, splits: [{ id: 1, category_id: 10, amount: '-60.00', note: null }, { id: 2, category_id: 11, amount: '-40.00', note: null }] };
    render(<SplitEditor transaction={split} categories={categories} onDone={onDone} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Part 2 amount')).toHaveValue('40.00');
    fireEvent.click(screen.getByRole('button', { name: 'Save split' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Category not found');

    fireEvent.click(screen.getByRole('button', { name: /Remove split/ }));
    await waitFor(() => expect(clearTransactionSplits).toHaveBeenCalledWith(7));
    expect(onDone).toHaveBeenCalled();
  });

  it('adds and removes parts, keeping at least two', () => {
    render(<SplitEditor transaction={shop} categories={categories} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove part 1' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '+ Add a part' }));
    expect(screen.getByLabelText('Part 3 amount')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove part 3' }));
    expect(screen.queryByLabelText('Part 3 amount')).not.toBeInTheDocument();
  });
});
