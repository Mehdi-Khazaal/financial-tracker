import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import EditAccountModal from './EditAccountModal';
import { updateAccount } from '../../utils/api';
import type { Account } from '../../types';

jest.mock('../../utils/api', () => ({
  __esModule: true,
  updateAccount: jest.fn(),
}));

jest.mock('../../context/ToastContext', () => ({
  useToast: () => ({ error: jest.fn(), success: jest.fn(), info: jest.fn(), confirm: jest.fn() }),
}));

// CRA's Jest preset sets `resetMocks: true`, so factory implementations are
// cleared before each test and have to be re-established here.
beforeEach(() => {
  (updateAccount as jest.Mock).mockResolvedValue({ data: {} });
});

/**
 * Which side of zero a credit card sits on.
 *
 * Fintrack stores an account from the holder's side: money you owe is
 * negative, money owed to you is positive. A card is usually the former, and
 * this form asks for the amount as a plain positive number because that is how
 * people say it — but it must not assume the direction.
 *
 * It used to. Loading did `Math.abs` and saving did `-Math.abs`, so an
 * overpaid card — a positive balance — came back as a debt of the same size
 * the moment the form was saved, even if the only edit was the name.
 */

const card = (over: Partial<Account> = {}): Account => ({
  id: 2,
  user_id: 1,
  name: 'Venture Card',
  type: 'credit_card',
  balance: -1500,
  credit_limit: 6000,
  currency: 'USD',
  created_at: '',
  updated_at: '',
  ...over,
} as Account);

const setup = (account: Account) =>
  render(
    <EditAccountModal
      isOpen
      onClose={jest.fn()}
      onSuccess={jest.fn()}
      account={account}
    />,
  );

const save = () => fireEvent.click(screen.getByRole('button', { name: /save|update/i }));
const creditCheckbox = () => screen.getByRole('checkbox', { name: /overpaid|in credit/i });

describe('EditAccountModal credit card direction', () => {
  it('shows an ordinary debt as an amount owed', async () => {
    setup(card({ balance: -1500 }));

    expect(await screen.findByText('Balance Owed')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1500')).toBeInTheDocument();
    expect(creditCheckbox()).not.toBeChecked();
  });

  it('saves an unchanged debt as the same debt', async () => {
    setup(card({ balance: -1500 }));
    save();

    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith(
      2, expect.objectContaining({ balance: -1500 }),
    ));
  });

  it('recognises an overpaid card instead of calling it a debt', async () => {
    setup(card({ balance: 50 }));

    expect(await screen.findByText('Credit Balance')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
    expect(creditCheckbox()).toBeChecked();
    expect(screen.getByText(/issuer owes you/i)).toBeInTheDocument();
  });

  it('does not flip a credit into a debt when nothing was edited', async () => {
    // The reported bug, at its worst: renaming an overpaid card turned a
    // $50 credit into $50 of debt.
    setup(card({ balance: 50 }));
    fireEvent.change(screen.getByPlaceholderText('Account name'), {
      target: { value: 'Venture Card (old)' },
    });
    save();

    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith(
      2, expect.objectContaining({ balance: 50, name: 'Venture Card (old)' }),
    ));
  });

  it('lets a card that has just been overpaid be recorded as such', async () => {
    setup(card({ balance: -1500 }));
    fireEvent.change(screen.getByDisplayValue('1500'), { target: { value: '25' } });
    fireEvent.click(creditCheckbox());
    save();

    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith(
      2, expect.objectContaining({ balance: 25 }),
    ));
  });

  it('lets a credit be turned back into a debt', async () => {
    setup(card({ balance: 50 }));
    fireEvent.click(creditCheckbox());
    save();

    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith(
      2, expect.objectContaining({ balance: -50 }),
    ));
  });

  it('treats a typed minus sign as the amount, not the direction', async () => {
    // The checkbox is the only thing that decides the side of zero, so a
    // stray sign in the amount field cannot produce a surprise.
    setup(card({ balance: -1500 }));
    fireEvent.change(screen.getByDisplayValue('1500'), { target: { value: '-200' } });
    save();

    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith(
      2, expect.objectContaining({ balance: -200 }),
    ));
  });

  it('offers no credit option for a chequing account', async () => {
    setup(card({ id: 1, name: 'Everyday', type: 'checking', balance: 5000, credit_limit: null }));

    expect(await screen.findByText('Balance')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /overpaid|in credit/i })).not.toBeInTheDocument();
  });

  it('leaves a chequing balance signed as it is', async () => {
    setup(card({ id: 1, name: 'Everyday', type: 'checking', balance: 5000, credit_limit: null }));
    save();

    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith(
      1, expect.objectContaining({ balance: 5000 }),
    ));
  });
});
