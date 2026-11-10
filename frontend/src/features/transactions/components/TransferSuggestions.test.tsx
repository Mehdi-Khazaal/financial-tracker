import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TransferSuggestions, { describeMove } from './TransferSuggestions';
import { getTransferSuggestions, markTransfers } from '../../../utils/api';
import type { Account, TransferSuggestion } from '../../../types';

vi.mock('../../../utils/api', () => ({
  __esModule: true,
  getTransferSuggestions: vi.fn(),
  markTransfers: vi.fn(),
  cleanDescription: (s: string) => s,
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => toast }));

const accounts = [
  { id: 47, user_id: 1, name: 'Spend', type: 'checking', balance: 693.28, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 49, user_id: 1, name: 'VentureOne', type: 'credit_card', balance: -384.92, credit_limit: 2750, currency: 'USD', created_at: '', updated_at: '' },
] as Account[];

const pair: TransferSuggestion = {
  transaction_ids: [1, 2], reason: 'pair', amount: '384.92', date: '2026-11-03',
  detail: 'The same amount left Spend and arrived in VentureOne 1 day later.',
  from_account_id: 47, to_account_id: 49, descriptions: ['CAPITAL ONE ONLINE PMT', 'PAYMENT THANK YOU'],
};
const single: TransferSuggestion = {
  transaction_ids: [3], reason: 'card-payment', amount: '120.00', date: '2026-10-28',
  detail: 'A payment into VentureOne.', from_account_id: null, to_account_id: 49, descriptions: ['AUTOPAY'],
};

beforeEach(() => {
  (getTransferSuggestions as Mock).mockResolvedValue({ data: [pair, single] });
  (markTransfers as Mock).mockResolvedValue({ data: { updated: 2, category_id: 9 } });
});

describe('TransferSuggestions', () => {
  it('lists each suggested move with where the money went', async () => {
    render(<TransferSuggestions accounts={accounts} onChanged={vi.fn()} />);

    expect(await screen.findByText('Spend → VentureOne')).toBeInTheDocument();
    expect(screen.getByText('Into VentureOne')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /moves between your accounts/i })).toBeInTheDocument();
  });

  it('files one suggestion — both rows of a pair — and reloads the page', async () => {
    const onChanged = vi.fn();
    render(<TransferSuggestions accounts={accounts} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: /mark spend → ventureone \$384\.92 as a transfer/i }));

    await waitFor(() => expect(markTransfers).toHaveBeenCalledWith([1, 2]));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Marked as a transfer');
  });

  it('files every suggestion at once', async () => {
    render(<TransferSuggestions accounts={accounts} onChanged={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all 2 as transfers' }));

    await waitFor(() => expect(markTransfers).toHaveBeenCalledWith([1, 2, 3]));
  });

  it('says so when filing fails, and leaves the list in place', async () => {
    (markTransfers as Mock).mockRejectedValue(new Error('500'));
    render(<TransferSuggestions accounts={accounts} onChanged={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all 2 as transfers' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText('Spend → VentureOne')).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to suggest, or the request fails', async () => {
    (getTransferSuggestions as Mock).mockResolvedValue({ data: [] });
    const { container, unmount } = render(<TransferSuggestions accounts={accounts} onChanged={vi.fn()} />);
    await waitFor(() => expect(getTransferSuggestions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    (getTransferSuggestions as Mock).mockRejectedValue(new Error('offline'));
    const second = render(<TransferSuggestions accounts={accounts} onChanged={vi.fn()} />);
    await waitFor(() => expect(getTransferSuggestions).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });

  it('shows three at first and the rest on request', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...single, transaction_ids: [10 + i] }));
    (getTransferSuggestions as Mock).mockResolvedValue({ data: many });
    render(<TransferSuggestions accounts={accounts} onChanged={vi.fn()} />);

    expect(await screen.findAllByRole('button', { name: /^mark into ventureone/i })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
    expect(screen.getAllByRole('button', { name: /^mark into ventureone/i })).toHaveLength(5);
  });
});

describe('describeMove', () => {
  it('names the account the money left when only that side is known', () => {
    expect(describeMove({ ...single, from_account_id: 47, to_account_id: null }, accounts)).toBe('Out of Spend');
  });

  it('falls back to the bank description for accounts it does not know', () => {
    expect(describeMove({ ...single, from_account_id: null, to_account_id: null }, accounts)).toBe('AUTOPAY');
  });
});
