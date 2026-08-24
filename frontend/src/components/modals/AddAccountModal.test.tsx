import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AddAccountModal from './AddAccountModal';
import { createAccount } from '../../utils/api';

jest.mock('../../utils/api', () => ({
  __esModule: true,
  createAccount: jest.fn(),
}));

jest.mock('../../context/ToastContext', () => ({
  useToast: () => ({ error: jest.fn(), success: jest.fn(), info: jest.fn(), confirm: jest.fn() }),
}));

// CRA's Jest preset sets `resetMocks: true`, so the factory implementation is
// cleared before each test and has to be re-established here.
beforeEach(() => {
  (createAccount as jest.Mock).mockResolvedValue({ data: {} });
});

/**
 * How a starting balance is entered.
 *
 * This form used to ask for the raw stored value — "enter the current balance
 * as a negative number (for example, -450) when you owe money" — which put a
 * database sign convention in front of the user, and disagreed with Edit
 * Account, which asks for a positive amount plus a direction. Two dialogs, one
 * field, two mental models.
 *
 * Both now ask the same way: how much, and which side of zero.
 */

const setup = () =>
  render(<AddAccountModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} />);

const chooseCreditCard = () =>
  fireEvent.click(screen.getByRole('button', { name: /^credit card:/i }));

const nameIt = (value = 'Quicksilver') =>
  fireEvent.change(screen.getByLabelText('Account name'), { target: { value } });

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create account/i }));

describe('AddAccountModal balance entry', () => {
  it('asks for what is owed as a plain positive amount', async () => {
    setup();
    chooseCreditCard();

    expect(screen.getByText('Balance owed')).toBeInTheDocument();
    expect(screen.getByText(/no minus sign needed/i)).toBeInTheDocument();
    // The old instruction is gone.
    expect(screen.queryByText(/as a negative number/i)).not.toBeInTheDocument();
  });

  it('stores a typed debt as a negative balance', async () => {
    setup();
    chooseCreditCard();
    nameIt();
    fireEvent.change(screen.getByLabelText(/balance owed/i), { target: { value: '450' } });
    submit();

    await waitFor(() => expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ balance: -450 }),
    ));
  });

  it('lets a card be created already in credit', async () => {
    setup();
    chooseCreditCard();
    nameIt();
    fireEvent.click(screen.getByRole('checkbox', { name: /overpaid|in credit/i }));
    fireEvent.change(screen.getByLabelText(/credit balance/i), { target: { value: '28.94' } });
    submit();

    await waitFor(() => expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 28.94 }),
    ));
  });

  it('ignores a minus sign the user types anyway', async () => {
    // Anyone who remembers the old instruction must not end up with a credit.
    setup();
    chooseCreditCard();
    nameIt();
    fireEvent.change(screen.getByLabelText(/balance owed/i), { target: { value: '-450' } });
    submit();

    await waitFor(() => expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ balance: -450 }),
    ));
  });

  it('leaves a chequing balance exactly as typed', async () => {
    setup();
    nameIt('Everyday');
    fireEvent.change(screen.getByLabelText(/^balance$/i), { target: { value: '1200.50' } });
    submit();

    await waitFor(() => expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 1200.5, type: 'checking' }),
    ));
  });

  it('offers no credit option for a chequing account', () => {
    setup();
    expect(screen.queryByRole('checkbox', { name: /overpaid|in credit/i })).not.toBeInTheDocument();
  });
});
