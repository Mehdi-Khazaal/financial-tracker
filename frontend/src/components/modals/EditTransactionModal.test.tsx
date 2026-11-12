import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import EditTransactionModal from './EditTransactionModal';
import { updateTransaction, getAccounts, getCategories, getCollections } from '../../utils/api';
import type { Account, Category, Transaction } from '../../types';

vi.mock('../../utils/api', () => ({
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getAccounts: vi.fn(),
  getCategories: vi.fn(),
  getCollections: vi.fn(),
  createCollection: vi.fn(),
  setTransactionCollections: vi.fn(),
  clearTransactionSplits: vi.fn(),
  setTransactionSplits: vi.fn(),
  cleanDescription: (desc: string | null | undefined) =>
    (desc ? desc.replace(/^\[plaid:[^\]]+\]\s*/, '') : 'No description'),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => toast }));

/**
 * The transaction sheet: details, then edit, with only real changes saved.
 *
 * Saving used to send every field. A transaction with no description had the
 * placeholder "No note" written into it, and an untouched category was
 * re-marked as chosen by hand, so a later bank sync treated it as the
 * user's decision.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday Checking', type: 'checking', balance: 4000, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
];
const categories: Category[] = [
  { id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#f59e0b', is_system: false, created_at: '' },
  { id: 11, user_id: 1, name: 'Dining', type: 'expense', color: '#a855f7', is_system: false, created_at: '' },
  { id: 12, user_id: 1, name: 'Salary', type: 'income', color: '#34d399', is_system: false, created_at: '' },
];
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 7, user_id: 1, account_id: 1, category_id: 10, amount: -86.42, description: 'Whole Foods Market',
  transaction_date: '2026-11-11', created_at: '', splits: [], collection_ids: [], ...over,
});

const setup = (transaction: Transaction) => {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <EditTransactionModal isOpen onClose={onClose} onSuccess={onSuccess} transaction={transaction} />
    </MemoryRouter>,
  );
  return { onSuccess, onClose };
};

const openEdit = async () => {
  // Accounts and categories load first; the details show the account name once they have.
  await screen.findByText('Everyday Checking');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: 'Edit transaction' });
};

beforeEach(() => {
  vi.clearAllMocks();
  (getAccounts as Mock).mockResolvedValue({ data: accounts });
  (getCategories as Mock).mockResolvedValue({ data: categories });
  (getCollections as Mock).mockResolvedValue({ data: [] });
  (updateTransaction as Mock).mockImplementation((id: number, changes: Partial<Transaction>) =>
    Promise.resolve({ data: { ...tx(), id, ...changes } }));
});

describe('EditTransactionModal', () => {
  it('saves only the field that changed', async () => {
    setup(tx());
    await openEdit();

    fireEvent.click(screen.getByRole('button', { name: /Dining/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    expect(updateTransaction).toHaveBeenCalledWith(7, { category_id: 11 });
  });

  it('never writes a placeholder into a transaction with no description', async () => {
    setup(tx({ description: null }));
    expect(await screen.findByText('No description')).toBeInTheDocument();
    await openEdit();

    expect(screen.getByLabelText('Description')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Dining/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    const [, changes] = (updateTransaction as Mock).mock.calls[0];
    expect(changes).not.toHaveProperty('description');
  });

  it('keeps Save disabled until something has changed', async () => {
    setup(tx());
    await openEdit();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '90' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('keeps the sign: an expense saves as money out', async () => {
    setup(tx());
    await openEdit();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '90.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledWith(7, { amount: -90.5 }));
  });

  it('goes back to the details after saving and shows the new values', async () => {
    const { onSuccess, onClose } = setup(tx());
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: /Dining/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('dialog', { name: 'Transaction' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Category: Dining/ })).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Changes saved');
  });

  it('Escape steps back to the details instead of closing', async () => {
    const { onClose } = setup(tx());
    await openEdit();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(await screen.findByRole('dialog', { name: 'Transaction' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.confirm).not.toHaveBeenCalled();
  });

  it('asks before throwing away unsaved changes, and stays if told to', async () => {
    toast.confirm.mockResolvedValue(false);
    setup(tx());
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: /Dining/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Back to details' }));

    await waitFor(() => expect(toast.confirm).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog', { name: 'Edit transaction' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dining/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a detail row opens the edit form on that field', async () => {
    setup(tx());
    await screen.findByText('Everyday Checking');

    fireEvent.click(screen.getByRole('button', { name: /^Category: Groceries/ }));

    expect(await screen.findByRole('dialog', { name: 'Edit transaction' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Category' })).toBeInTheDocument();
  });
});
