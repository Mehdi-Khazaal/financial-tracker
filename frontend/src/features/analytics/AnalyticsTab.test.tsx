import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, Category, RecurringTransaction, SavingsGoal, Transaction } from '../../types';
import { TabProvider } from '../../context/TabContext';
import AnalyticsTab from './AnalyticsTab';

// react-router-dom v7 exposes `react-router/dom` through package exports that
// CRA's Jest resolver cannot follow, so importing it here fails to resolve.
// AnalyticsTab only needs `useNavigate`, so stubbing the module keeps the
// smoke tests running without touching the shared Jest config.
// The factory must not close over anything outside itself — `jest.mock` is
// hoisted above the imports, so an outer const would still be in its TDZ.
jest.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

/**
 * Mount smoke tests.
 *
 * The unit tests prove the arithmetic; these prove the page survives contact
 * with real render conditions — including the two states most likely to throw:
 * a brand-new account with no data at all, and a partial load where a source
 * failed.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 4200, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
];

const categories: Category[] = [
  { id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: 11, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
];

let id = 1;
const tx = (date: string, amount: number, category_id: number | null = null): Transaction => ({
  id: id++, user_id: 1, account_id: 1, category_id, amount,
  description: 'Test entry', transaction_date: date, created_at: '',
});

const goals: SavingsGoal[] = [{
  id: 1, user_id: 1, name: 'Emergency Fund', target_amount: 12000,
  deadline: null, created_at: '', allocations: [], current_amount: 8400,
}];

const recurring: RecurringTransaction[] = [{
  id: 1, user_id: 1, account_id: 1, category_id: 10, amount: -1200,
  description: 'Rent', period: 'monthly', next_date: '2026-08-01',
  is_active: true, is_variable: false, created_at: '',
}];

const populated = {
  transactions: [
    tx('2026-05-01', 4000, 11), tx('2026-05-04', -1500, 10),
    tx('2026-06-01', 4000, 11), tx('2026-06-04', -1800, 10),
    tx('2026-07-01', 4000, 11), tx('2026-07-04', -900, 10),
  ],
  categories,
  accounts,
  goals,
  recurring,
  snapshots: [
    { month: '2026-05', net_worth: 9000 },
    { month: '2026-06', net_worth: 11000 },
    { month: '2026-07', net_worth: 13000 },
  ],
  assets: [],
  failedSources: [],
};

const renderTab = (props: Partial<React.ComponentProps<typeof AnalyticsTab>> = {}) =>
  render(
    <TabProvider>
      <AnalyticsTab {...populated} {...props} />
    </TabProvider>,
  );

describe('AnalyticsTab', () => {
  it('renders every major section without throwing', () => {
    renderTab();
    ['Your period at a glance', 'Things to review', 'Savings', 'Cash flow', 'Spending',
      'Net worth', 'Compared with your usual', 'Coming up', 'Subscriptions',
      'Recent activity', 'Financial health'].forEach(section => {
      expect(screen.getAllByText(section).length).toBeGreaterThan(0);
    });
  });

  it('survives a completely empty account', () => {
    renderTab({
      transactions: [], goals: [], recurring: [], snapshots: [], assets: [],
    });
    expect(screen.getByText(/No activity recorded/)).toBeInTheDocument();
    expect(screen.getByText('Nothing needs your attention')).toBeInTheDocument();
  });

  it('refuses to render figures when transactions failed to load', () => {
    renderTab({ failedSources: ['transactions'] });
    expect(screen.getByText('Analytics needs your transactions')).toBeInTheDocument();
    expect(screen.queryByText('Cash flow')).not.toBeInTheDocument();
  });

  it('degrades to a partial page when only categories failed', () => {
    renderTab({ failedSources: ['categories'] });
    expect(screen.getByText('Categories unavailable')).toBeInTheDocument();
    // Totals do not depend on the category list, so cash flow still renders.
    expect(screen.getByText('Cash flow')).toBeInTheDocument();
  });

  it('changes the period and keeps every section on the new range', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Last 3 months' }));
    expect(screen.getByRole('button', { name: 'Last 3 months' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Income and spending by month')).toBeInTheDocument();
  });

  it('opens the category drawer from the spending list', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /open details/i })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
