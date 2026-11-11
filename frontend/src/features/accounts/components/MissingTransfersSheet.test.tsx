import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AxiosError, AxiosHeaders } from 'axios';
import MissingTransfersSheet from './MissingTransfersSheet';
import { getMissingTransfers, restoreMissingTransfers } from '../../../utils/api';

vi.mock('../../../utils/api', () => ({
  getMissingTransfers: vi.fn(),
  restoreMissingTransfers: vi.fn(),
}));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), confirm: vi.fn() };
vi.mock('../../../context/ToastContext', () => ({ useToast: () => toast }));

const rows = [
  { plaid_transaction_id: 'pay-chk', account_id: 47, account_name: 'Spend', date: '2026-10-05', amount: '-384.92', description: 'CAPITAL ONE ONLINE PMT' },
  { plaid_transaction_id: 'pay-card', account_id: 49, account_name: 'VentureOne', date: '2026-10-05', amount: '384.92', description: 'PAYMENT - THANK YOU' },
  { plaid_transaction_id: 'move', account_id: 47, account_name: 'Spend', date: '2026-09-28', amount: '-1500', description: 'ONLINE TRANSFER TO RESERVE' },
];

const httpError = (status: number, detail?: string) => new AxiosError('failed', String(status), undefined, undefined, {
  status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: detail ? { detail } : {},
});

beforeEach(() => {
  vi.clearAllMocks();
  (getMissingTransfers as Mock).mockResolvedValue({ data: { rows, unavailable: [] } });
  (restoreMissingTransfers as Mock).mockResolvedValue({ data: { restored: 2 } });
});

const open = (onRestored = vi.fn(), onClose = vi.fn()) => {
  render(<MissingTransfersSheet isOpen onClose={onClose} onRestored={onRestored} />);
  return { onRestored, onClose };
};

describe('MissingTransfersSheet', () => {
  it('lists what the banks have, by account, every row chosen', async () => {
    open();

    const spend = await screen.findByRole('region', { name: 'Spend' });
    expect(within(spend).getByText('CAPITAL ONE ONLINE PMT')).toBeInTheDocument();
    expect(within(spend).getByText('−$1,500.00')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'VentureOne' })).getByText('+$384.92')).toBeInTheDocument();
    expect(screen.getByText(/never count as income or spending/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore 3 rows as transfers' })).toBeEnabled();
  });

  it('restores only the rows left ticked', async () => {
    const { onRestored, onClose } = open();
    fireEvent.click(await screen.findByRole('checkbox', { name: /ONLINE TRANSFER TO RESERVE/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Restore 2 rows as transfers' }));

    await waitFor(() => expect(restoreMissingTransfers).toHaveBeenCalledWith(['pay-chk', 'pay-card']));
    expect(onRestored).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Restored 2 transfers');
  });

  it('can untick everything, which leaves nothing to restore', async () => {
    open();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'All 3' }));

    expect(screen.getByRole('button', { name: 'Restore 0 rows as transfers' })).toBeDisabled();
  });

  it('says so when nothing is missing', async () => {
    (getMissingTransfers as Mock).mockResolvedValue({ data: { rows: [], unavailable: [] } });
    open();

    expect(await screen.findByText(/Nothing is missing/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();
  });

  it('names a bank it could not ask', async () => {
    (getMissingTransfers as Mock).mockResolvedValue({ data: { rows, unavailable: ['PNC'] } });
    open();

    expect(await screen.findByText(/PNC could not be asked/)).toBeInTheDocument();
  });

  it('explains when no bank is connected', async () => {
    (getMissingTransfers as Mock).mockRejectedValue(httpError(404));
    open();

    expect(await screen.findByText(/No bank is connected/)).toBeInTheDocument();
  });

  it('offers a retry when the banks cannot be reached', async () => {
    (getMissingTransfers as Mock).mockRejectedValueOnce(httpError(502));
    open();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('CAPITAL ONE ONLINE PMT')).toBeInTheDocument();
  });

  it('shows the server’s reason when a restore is refused', async () => {
    (restoreMissingTransfers as Mock).mockRejectedValue(httpError(409, 'Your bank synced while restoring. Open the list again.'));
    const { onRestored } = open();

    fireEvent.click(await screen.findByRole('button', { name: 'Restore 3 rows as transfers' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Your bank synced while restoring. Open the list again.'));
    expect(onRestored).not.toHaveBeenCalled();
  });
});
