import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, Category, Transaction } from '../../../types';
import OneOffToggle from './OneOffToggle';
import { updateTransaction } from '../../../utils/api';
import { buildClassificationContext } from '../../analytics/calculations/transactions';

vi.mock('../../../utils/api', () => ({ updateTransaction: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => toast }));

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Reserve', type: 'savings', balance: 4000, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
];
const categories: Category[] = [
  { id: 10, user_id: 1, name: 'Motorcycle', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: 11, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
];
const ctx = buildClassificationContext(accounts, categories);
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 7, user_id: 1, account_id: 1, category_id: 10, amount: -7000, description: 'WITHDRAWAL *7190',
  transaction_date: '2026-06-27', created_at: '', one_off: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (updateTransaction as Mock).mockResolvedValue({ data: {} });
});

describe('OneOffToggle', () => {
  it('shows the rule’s answer for a big charge that does not repeat', () => {
    render(<OneOffToggle transaction={tx()} history={[]} ctx={ctx} onSaved={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: /Big one-off/ })).toBeChecked();
    expect(screen.getByText(/Set automatically: \$1,000 or more, and it does not repeat\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Let Fintrack decide' })).not.toBeInTheDocument();
  });

  it('saves the user’s call and offers to hand it back', async () => {
    const onSaved = vi.fn();
    render(<OneOffToggle transaction={tx()} history={[]} ctx={ctx} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Big one-off/ }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith(7, { one_off: false }));
    expect(onSaved).toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /Big one-off/ })).not.toBeChecked();
    expect(screen.getByText(/Marked by you\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Let Fintrack decide' }));
    await waitFor(() => expect(updateTransaction).toHaveBeenLastCalledWith(7, { one_off: null }));
  });

  it('puts the box back when the save fails', async () => {
    (updateTransaction as Mock).mockRejectedValue(new Error('offline'));
    render(<OneOffToggle transaction={tx()} history={[]} ctx={ctx} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Big one-off/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save that'));
    expect(screen.getByRole('checkbox', { name: /Big one-off/ })).toBeChecked();
  });

  it('is not offered for income', () => {
    const { container } = render(
      <OneOffToggle transaction={tx({ amount: 4385.5, category_id: 11 })} history={[]} ctx={ctx} onSaved={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
