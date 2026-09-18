import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TransferModal from './TransferModal';
import { createTransfer, getAccounts } from '../../utils/api';

vi.mock('../../utils/api', () => ({
  __esModule: true,
  createTransfer: vi.fn(),
  getAccounts: vi.fn(),
}));

const ACCOUNTS = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 5000, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Venture Card', type: 'credit_card', balance: -1500, credit_limit: 6000, currency: 'USD', created_at: '', updated_at: '' },
];

// CRA's Jest preset sets `resetMocks: true`, which clears implementations
// defined in the factory before every test. They have to be re-established
// here or `getAccounts()` resolves to undefined.
beforeEach(() => {
  (getAccounts as Mock).mockResolvedValue({ data: ACCOUNTS });
  (createTransfer as Mock).mockResolvedValue({ data: {} });
});

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), confirm: vi.fn() }),
}));

/**
 * The transfer modal's wording.
 *
 * This writes a `Transfer` row between two Fintrack accounts. It initiates
 * nothing with any bank, so no control in the flow may imply that it does —
 * not the trigger on the account card, and not the button that completes it.
 * The trigger is covered in `AccountCard.test.tsx`; this covers the confirm.
 */

const setup = (props: Partial<React.ComponentProps<typeof TransferModal>> = {}) =>
  render(
    <TransferModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} {...props} />,
  );

describe('card-payment wording', () => {
  it('never claims to pay the card', async () => {
    setup({ preselectedToId: 2 });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Pay Card' })).not.toBeInTheDocument();
  });

  it('still calls a plain transfer a transfer', async () => {
    // Destination is the chequing account. Without a preselection the modal
    // defaults to the second account, which here is the card — so the old
    // assertion only held while the accounts were still loading.
    setup({ preselectedFromId: 2, preselectedToId: 1 });

    // Wait until the accounts have actually loaded into the selects.
    await waitFor(() => expect(screen.getAllByRole('option', { name: /Everyday/ }).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
});
