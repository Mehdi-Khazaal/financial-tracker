import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  Account, Asset, Category, MonthSnapshot, RecurringTransaction, SavingsGoal, Transaction,
} from '../../types';
import { TabProvider } from '../../context/TabContext';
import OverviewTab from './OverviewTab';

// react-router-dom v7 exposes `react-router/dom` through package exports that
// CRA's Jest resolver cannot follow. Overview only needs `Link`, so the module
// is stubbed. The factory must not close over anything outside itself —
// `jest.mock` is hoisted above the imports.
jest.mock('react-router-dom', () => {
  const react = jest.requireActual('react');
  return {
    Link: ({ to, children, ...rest }: { to: string; children: unknown }) =>
      react.createElement('a', { href: to, ...rest }, children),
  };
});

/**
 * Mount tests for the Overview tab.
 *
 * The unit tests prove the wording; these prove the page puts it on screen in
 * the states that actually caused the complaints — the 2nd of a new month, a
 * card carrying a balance, and a finished goal.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 4200, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Rewards Card', type: 'credit_card', balance: -213.37, credit_limit: 1500, currency: 'USD', created_at: '', updated_at: '' },
];

const categories: Category[] = [
  { id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: 11, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
];

let nextId = 1;
const tx = (date: string, amount: number, overrides: Partial<Transaction> = {}): Transaction => ({
  id: nextId++, user_id: 1, account_id: 1, category_id: 10, amount,
  description: 'Entry', transaction_date: date, created_at: '', ...overrides,
});

const TODAY = new Date(2026, 7, 2); // 2 August 2026

const snapshots: MonthSnapshot[] = [
  { month: '2026-06', net_worth: 3500 },
  { month: '2026-07', net_worth: 3900 },
];

const baseProps = {
  accounts,
  transactions: [] as Transaction[],
  categories,
  goals: [] as SavingsGoal[],
  recurring: [] as RecurringTransaction[],
  snapshots,
  assets: [] as Asset[],
  failedSources: [] as string[],
  today: TODAY,
};

const renderTab = (overrides: Partial<typeof baseProps> = {}) =>
  render(
    <TabProvider>
      <OverviewTab {...baseProps} {...overrides} />
    </TabProvider>,
  );

describe('OverviewTab — beginning of month', () => {
  const julyOnly = [
    tx('2026-07-15', 3000, { category_id: 11 }),
    tx('2026-07-31', -2285.84),
  ];

  it('explains a zero month instead of showing bare zeroes', () => {
    renderTab({ transactions: julyOnly });

    expect(screen.getByText('No posted activity yet')).toBeInTheDocument();
    expect(screen.getByText(/August has just started/)).toBeInTheDocument();
  });

  it('shows the most recent posted transaction date', () => {
    renderTab({ transactions: julyOnly });

    expect(screen.getByText(/Last posted transaction: Jul 31/)).toBeInTheDocument();
  });

  it('keeps the income and expense values on screen rather than hiding them', () => {
    renderTab({ transactions: julyOnly });

    expect(screen.getByText('Income')).toBeInTheDocument();
    expect(screen.getByText('+$0.00')).toBeInTheDocument();
    expect(screen.getByText('−$0.00')).toBeInTheDocument();
  });

  it('quotes last month as a labelled prior total, not a signed difference', () => {
    renderTab({ transactions: julyOnly });

    expect(screen.getByText('July spending')).toBeInTheDocument();
    expect(screen.getByText('July total: $2,285.84')).toBeInTheDocument();
    expect(screen.queryByText(/−\$2,285\.84 spending/)).not.toBeInTheDocument();
  });

  it('refuses to call the month empty when the transaction source failed', () => {
    renderTab({ transactions: [], failedSources: ['transactions'] });

    expect(screen.getByText('Activity may be incomplete')).toBeInTheDocument();
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
  });

  it('qualifies the status insight when any source failed', () => {
    renderTab({ transactions: [], failedSources: ['recurring'] });

    expect(screen.getByText('Showing partial data')).toBeInTheDocument();
    // A failed recurring fetch says nothing about whether the month has
    // activity, so the hero is not falsely marked unknown.
    expect(screen.queryByText('Activity may be incomplete')).not.toBeInTheDocument();
  });
});

describe('OverviewTab — quick actions', () => {
  it('no longer offers Transfer, Withdraw or Deposit', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)] });

    expect(screen.queryByRole('button', { name: 'Transfer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deposit' })).not.toBeInTheDocument();
  });

  it('replaces them with a current-status activity card', () => {
    renderTab({ transactions: [tx('2026-08-01', -20), tx('2026-08-02', -30)] });

    expect(screen.getByText('August activity')).toBeInTheDocument();
    expect(screen.getByText('transactions posted')).toBeInTheDocument();
    expect(screen.getByText('Last posted')).toBeInTheDocument();
    expect(screen.getByText('Aug 2')).toBeInTheDocument();
  });

  it('states a zero count in a quiet month without repeating the hero message', () => {
    renderTab({ transactions: [tx('2026-07-31', -40)] });

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('transactions posted')).toBeInTheDocument();
    // The explanation lives in exactly one place.
    expect(screen.getAllByText(/August has just started/).length).toBe(1);
  });
});

describe('OverviewTab — imported transaction review', () => {
  it('compresses to a success state when everything is categorized', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)] });

    expect(screen.getByText('All imported transactions categorized')).toBeInTheDocument();
    // The placeholder metadata is gone for good.
    expect(screen.queryByText(/Top none/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Savings 0%/i)).not.toBeInTheDocument();
  });

  it('keeps a route into the review even when nothing is outstanding', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)] });

    // Carries the tab, so the link lands on the review queue itself.
    expect(screen.getByText('Review →')).toHaveAttribute('href', '/transactions?tab=transactions');
  });

  it('expands with a clear action when imports are unresolved', () => {
    renderTab({
      transactions: [tx('2026-08-01', -20, { category_id: null }), tx('2026-08-02', -30)],
    });

    expect(screen.getByText('1 transaction needs a category')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Review imported transactions\. 1 of 2 transactions in August need a category\./),
    ).toBeInTheDocument();
  });
});

describe('OverviewTab — credit cards', () => {
  it('renders a card balance as an amount owed', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)] });

    expect(screen.getByText('$213.37 owed')).toBeInTheDocument();
    expect(screen.getByText('$1,286.63 available')).toBeInTheDocument();
  });

  it('renders a cleared card as paid off', () => {
    renderTab({
      accounts: [accounts[0], { ...accounts[1], balance: 0 }],
      transactions: [tx('2026-08-01', -20)],
    });

    expect(screen.getByText('Paid off')).toBeInTheDocument();
  });
});

describe('OverviewTab — savings goals', () => {
  const goal = (overrides: Partial<SavingsGoal>): SavingsGoal => ({
    id: 1, user_id: 1, name: 'Education', target_amount: 10000,
    deadline: null, created_at: '', allocations: [], current_amount: 0, ...overrides,
  });

  it('marks a completed goal as complete, with a word not just a colour', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)], goals: [goal({ current_amount: 10000 })] });

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('labels a partially funded goal as in progress', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)], goals: [goal({ current_amount: 4000 })] });

    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('announces status and progress without relying on the bar colour', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)], goals: [goal({ current_amount: 10000 })] });

    // The card is one link, and its name carries the whole status.
    expect(
      screen.getByRole('link', { name: /Education: Complete, 100 percent funded\. Open goal\./ }),
    ).toBeInTheDocument();
  });

  it('caps the bar at full for an overfunded goal but reports the real figure', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)], goals: [goal({ current_amount: 12500 })] });

    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /125 percent funded/ }),
    ).toBeInTheDocument();
  });

  it('opens the Savings tab scrolled to the goal that was clicked', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)], goals: [goal({ id: 7, current_amount: 4000 })] });

    expect(screen.getByRole('link', { name: /Education/ }))
      .toHaveAttribute('href', '/portfolio?tab=savings&focusGoal=7');
  });
});

describe('OverviewTab — net worth hero', () => {
  it('states the timeframe behind the change', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)] });

    expect(screen.getByText('Since June 2026')).toBeInTheDocument();
  });

  it('explains itself when there is not enough history for a trend', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)], snapshots: [] });

    expect(screen.getByText('Not enough history yet')).toBeInTheDocument();
    expect(screen.getByText(/two months of history/)).toBeInTheDocument();
  });

  it('renames Spendable and offers a definition', () => {
    renderTab({ transactions: [tx('2026-08-01', -20)] });

    expect(screen.getByText('Available to spend')).toBeInTheDocument();
    expect(screen.queryByText('Spendable')).not.toBeInTheDocument();
    expect(screen.getByLabelText('What available to spend means')).toBeInTheDocument();
  });

  it('says that assets and investments sit outside net worth', () => {
    renderTab({
      transactions: [tx('2026-08-01', -20)],
      assets: [
        { id: 1, user_id: 1, name: 'Car', type: 'vehicle', asset_class: 'physical', quantity: null, value_per_unit: null, total_value: 8000, currency: 'USD', purchase_date: null, created_at: '', updated_at: '' },
      ],
    });

    expect(screen.getAllByText('Not in net worth').length).toBe(2);
  });
});

describe('OverviewTab — status insight', () => {
  it('shows exactly one insight at a time', () => {
    renderTab({ transactions: [tx('2026-08-01', -20, { category_id: null })] });

    expect(screen.getAllByLabelText('Status').length).toBe(1);
  });

  it('leads with unresolved imports and links to the review', () => {
    renderTab({ transactions: [tx('2026-08-01', -20, { category_id: null })] });

    expect(screen.getByText('1 imported transaction still needs a category')).toBeInTheDocument();
    expect(screen.getByText('Review imports')).toHaveAttribute('href', '/transactions?tab=transactions');
  });
});
