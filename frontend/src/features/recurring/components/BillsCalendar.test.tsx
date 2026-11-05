import { vi, type Mock } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { RecurringBill, RecurringOverview } from '../../../types';
import BillsCalendar from './BillsCalendar';

vi.mock('../../../utils/api', () => ({
  getAccounts: vi.fn(),
  getCategories: vi.fn(),
  fetchAllTransactions: vi.fn(),
  getPreferences: vi.fn(),
}));

import { fetchAllTransactions, getAccounts, getCategories, getPreferences } from '../../../utils/api';

const bill = (over: Partial<RecurringBill>): RecurringBill => ({
  id: 1, user_id: 1, account_id: 1, category_id: null, amount: '-1850.00', description: 'Landlord',
  period: 'monthly', next_date: '2026-12-01', is_active: true, is_variable: false, created_at: '',
  account_name: 'Everyday', category_name: 'Rent', ...over,
} as unknown as RecurringBill);

const overview = {
  today: '2026-11-05',
  groups: [{ key: 'housing', label: 'Housing', monthly_total: '1850', paid_this_month: '0', remaining_this_month: '1850', bills: [bill({})] }],
  income: [bill({ id: 2, amount: '5200.00', description: 'Payroll', next_date: '2026-12-02' })],
} as unknown as RecurringOverview;

const groceries = (date: string) => ({
  id: Math.random(), user_id: 1, account_id: 1, category_id: 10, amount: -304.4, description: 'Market', transaction_date: date, created_at: '',
});

beforeEach(() => {
  (getAccounts as Mock).mockResolvedValue({ data: [
    { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 2000, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
    { id: 2, user_id: 1, name: 'Card', type: 'credit_card', balance: -400, credit_limit: 3000, currency: 'USD', created_at: '', updated_at: '' },
  ] });
  (getCategories as Mock).mockResolvedValue({ data: [{ id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' }] });
  (fetchAllTransactions as Mock).mockResolvedValue({ transactions: [], truncated: false, loaded: 0 });
  (getPreferences as Mock).mockResolvedValue({ data: { low_balance_threshold: '500.00' } });
});

describe('BillsCalendar', () => {
  it('walks checking and cash through each bill and payday', async () => {
    render(<BillsCalendar overview={overview} />);
    await screen.findByRole('heading', { name: 'Cash calendar' });

    // Only checking counts as spendable; the card balance is not cash.
    expect(screen.getByText('In checking and cash').nextSibling).toHaveTextContent('$2,000');
    expect(screen.getByText('Lowest point').nextSibling).toHaveTextContent('$150');
    expect(screen.getByText(/Expected to dip below your \$500 line on Tuesday, December 1, to \$150\./)).toBeInTheDocument();
    expect(screen.getByText('Next pay').nextSibling).toHaveTextContent('+$5,200');
  });

  it('can count typical day-to-day spending, and leave it out', async () => {
    (fetchAllTransactions as Mock).mockResolvedValue({
      transactions: [groceries('2026-08-10'), groceries('2026-09-10'), groceries('2026-10-10')],
      truncated: false,
      loaded: 3,
    });
    render(<BillsCalendar overview={overview} />);
    const toggle = await screen.findByRole('checkbox', { name: /about \$10 a day/ });

    // 26 days at $10 before rent on Dec 1.
    expect(screen.getByText('Lowest point').nextSibling).toHaveTextContent('−$110');
    fireEvent.click(toggle);
    expect(screen.getByText('Lowest point').nextSibling).toHaveTextContent('$150');
  });

  it('explains itself when balances could not be loaded', async () => {
    (getAccounts as Mock).mockRejectedValue(new Error('offline'));
    render(<BillsCalendar overview={overview} />);
    expect(await screen.findByText(/needs your account balances/)).toBeInTheDocument();
  });
});
