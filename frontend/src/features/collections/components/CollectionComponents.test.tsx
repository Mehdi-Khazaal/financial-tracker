import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, Collection, CollectionAddResult } from '../../../types';
import { addToCollection, createCollection } from '../../../utils/api';
import TransactionCard from '../../../components/transactions/TransactionCard';
import CollectionPicker from './CollectionPicker';
import AddToCollectionSheet, { addedMessage } from './AddToCollectionSheet';

const { mockSuccess, mockError } = vi.hoisted(() => ({ mockSuccess: vi.fn(), mockError: vi.fn() }));

vi.mock('../../../utils/api', () => ({
  __esModule: true,
  addToCollection: vi.fn(),
  createCollection: vi.fn(),
  cleanDescription: (s: string | null) => s ?? '',
}));

vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({ success: mockSuccess, error: mockError, info: vi.fn(), confirm: vi.fn() }),
}));

const collection = (id: number, name: string, overrides: Partial<Collection> = {}): Collection => ({
  id, name, emoji: null, color: null, note: null, start_date: null, end_date: null, budget: null,
  is_archived: false, created_at: null, active: false, suggestion_count: 0,
  totals: { spent: '0', returned: '0', net: '0', count: 0, first_date: null, last_date: null }, ...overrides,
});

const result = (overrides: Partial<CollectionAddResult> = {}): CollectionAddResult => ({
  added: 2, already: 0, skipped_card_payments: 0, collection: collection(1, 'Ohio trip'), ...overrides,
});

const account: Account = {
  id: 1, user_id: 1, name: 'Checking', type: 'checking', balance: 0, credit_limit: null, currency: 'USD', created_at: '', updated_at: '',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TransactionCard with collections', () => {
  const tx = { id: 5, user_id: 1, account_id: 1, category_id: null, amount: -12, description: 'Diner', transaction_date: '2026-11-03', created_at: '' };

  it('shows up to two chips and a count for the rest', () => {
    render(
      <TransactionCard tx={tx} accounts={[account]} isDragging={false} noDrag onDragStart={() => {}} onDragEnd={() => {}}
        onClick={() => {}} onDelete={() => {}}
        collections={[
          { id: 1, name: 'Ohio trip', emoji: '🚗', color: null },
          { id: 2, name: 'Work', emoji: null, color: '#ff0000' },
          { id: 3, name: 'Gifts', emoji: null, color: null },
        ]} />,
    );
    expect(screen.getByText('Ohio trip')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.queryByText('Gifts')).not.toBeInTheDocument();
    expect(screen.getByText('+1')).toHaveAttribute('title', 'Gifts');
  });

  it('toggles selection instead of opening the transaction in select mode', () => {
    const onClick = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <TransactionCard tx={tx} accounts={[account]} isDragging={false} noDrag onDragStart={() => {}} onDragEnd={() => {}}
        onClick={onClick} onDelete={() => {}} selectable selected={false} onToggleSelect={onToggleSelect} />,
    );
    fireEvent.click(screen.getByText('Diner'));
    fireEvent.click(screen.getByLabelText('Select Diner'));
    expect(onToggleSelect).toHaveBeenCalledTimes(2);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('CollectionPicker', () => {
  it('toggles collections, running ones first, and creates a new one in place', async () => {
    const onToggle = vi.fn();
    const onCreate = vi.fn().mockResolvedValue(true);
    render(
      <CollectionPicker
        collections={[collection(1, 'Old move'), collection(2, 'Ohio trip', { active: true, emoji: '🚗' })]}
        selected={[1]}
        onToggle={onToggle}
        onCreate={onCreate}
      />,
    );
    const chips = screen.getAllByRole('button', { pressed: true }).concat(screen.getAllByRole('button', { pressed: false }));
    expect(chips.map(c => c.textContent)).toContain('Old move');
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('🚗 Ohio trip');
    fireEvent.click(screen.getByRole('button', { name: /Ohio trip/ }));
    expect(onToggle).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    fireEvent.change(screen.getByLabelText('New collection name'), { target: { value: '  Christmas ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Christmas'));
    await waitFor(() => expect(screen.queryByLabelText('New collection name')).not.toBeInTheDocument());
  });
});

describe('AddToCollectionSheet', () => {
  const setup = (collections: Collection[]) => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <AddToCollectionSheet isOpen onClose={onClose} collections={collections} transactionIds={[4, 9]}
        span={{ from: '2026-11-03', to: '2026-11-09' }} todayKey="2026-11-12" onAdded={onAdded} />,
    );
    return { onAdded, onClose };
  };

  it('adds the selection to a picked collection, leaving archived ones out', async () => {
    (addToCollection as Mock).mockResolvedValue({ data: result() });
    const { onAdded, onClose } = setup([collection(1, 'Ohio trip'), collection(2, 'Archived one', { is_archived: true })]);

    expect(screen.queryByText('Archived one')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ohio trip/ }));

    await waitFor(() => expect(addToCollection).toHaveBeenCalledWith(1, [4, 9]));
    expect(mockSuccess).toHaveBeenCalledWith('Added 2 transactions to Ohio trip');
    expect(onAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('creates a new collection over the selected dates, or without them', async () => {
    (createCollection as Mock).mockResolvedValue({ data: collection(5, 'Ohio trip') });
    (addToCollection as Mock).mockResolvedValue({ data: result() });
    setup([]);

    expect(screen.getByLabelText(/Use these dates \(Nov 3 – 9\)/)).toBeChecked();
    fireEvent.change(screen.getByLabelText('New collection'), { target: { value: 'Ohio trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createCollection).toHaveBeenCalledWith({ name: 'Ohio trip', start_date: '2026-11-03', end_date: '2026-11-09' }));
    await waitFor(() => expect(addToCollection).toHaveBeenCalledWith(5, [4, 9]));
  });

  it('reports a failure', async () => {
    (addToCollection as Mock).mockRejectedValue({ response: { data: { detail: 'Collection not found' } } });
    setup([collection(1, 'Ohio trip')]);
    fireEvent.click(screen.getByRole('button', { name: /Ohio trip/ }));
    await waitFor(() => expect(mockError).toHaveBeenCalledWith('Collection not found'));
  });

  it('says what was skipped', () => {
    expect(addedMessage(result({ added: 0, already: 2, skipped_card_payments: 1 })))
      .toBe('Nothing new added to Ohio trip · 2 already there · 1 card payment left out');
  });
});
