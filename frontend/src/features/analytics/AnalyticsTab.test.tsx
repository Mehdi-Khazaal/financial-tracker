import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, Category, Collection, RecurringTransaction, SavingsGoal, Transaction } from '../../types';
import { TabProvider } from '../../context/TabContext';
import AnalyticsTab from './AnalyticsTab';

// react-router-dom v7 exposes `react-router/dom` through package exports that
// CRA's Jest resolver cannot follow, so importing it here fails to resolve.
// AnalyticsTab only needs `useNavigate`, so stubbing the module keeps the
// smoke tests running without touching the shared Jest config.
// The factory must not close over anything outside itself — `vi.mock` is
// hoisted above the imports, so an outer const would still be in its TDZ.
vi.mock('react-router-dom', async () => {
  const ReactModule = await import('react');
  return {
    useNavigate: () => () => {},
    Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) =>
      ReactModule.createElement('a', { href: to, className }, children),
  };
});

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

/**
 * Dates are generated relative to today. `AnalyticsTab` reads the real clock,
 * so hard-coded months silently fall outside "this month" and the fixture
 * quietly becomes an empty-state test.
 */
const monthOffset = (months: number): string => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const dayIn = (months: number, day = 5): string => `${monthOffset(months)}-${String(day).padStart(2, '0')}`;

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
  description: 'Rent', period: 'monthly', next_date: dayIn(-1, 1),
  is_active: true, is_variable: false, created_at: '',
}];

const populated = {
  // Four completed months plus the month in progress — enough history for the
  // health score and the forecast to be available rather than withheld.
  transactions: [
    tx(dayIn(4, 1), 4000, 11), tx(dayIn(4, 4), -1600, 10),
    tx(dayIn(3, 1), 4000, 11), tx(dayIn(3, 4), -1700, 10),
    tx(dayIn(2, 1), 4000, 11), tx(dayIn(2, 4), -1500, 10),
    tx(dayIn(1, 1), 4000, 11), tx(dayIn(1, 4), -1800, 10),
    tx(dayIn(0, 1), 4000, 11), tx(dayIn(0, 4), -900, 10),
  ],
  categories,
  accounts,
  goals,
  recurring,
  snapshots: [
    { month: monthOffset(4), net_worth: 6000 },
    { month: monthOffset(3), net_worth: 7500 },
    { month: monthOffset(2), net_worth: 9000 },
    { month: monthOffset(1), net_worth: 11000 },
    { month: monthOffset(0), net_worth: 13000 },
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

describe('AnalyticsTab collections', () => {
  const trip: Collection = {
    id: 7, name: 'Ohio trip', emoji: '🚗', color: null, note: null, start_date: null, end_date: null, budget: null,
    is_archived: false, created_at: null, active: false, suggestion_count: 0,
    totals: { spent: '600', returned: '0', net: '600', count: 1, first_date: null, last_date: null },
  };

  it('hides the collections card when the period has none', () => {
    renderTab({ collections: [trip] });
    expect(screen.queryByText(/Trips and events in/)).not.toBeInTheDocument();
  });

  it('shows what collections added, and can leave them out of the page', () => {
    const withTrip = [...populated.transactions, { ...tx(dayIn(0, 6), -600, 10), collection_ids: [7] }];
    localStorage.setItem('ft_analytics_period', 'this-month');
    renderTab({ transactions: withTrip, collections: [trip] });

    expect(screen.getByText(/Trips and events in/)).toBeInTheDocument();
    expect(screen.getByText('$600.00 of $1,500.00 spending (40%) went to collections. It still counts in its categories.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ohio trip/ })).toHaveAttribute('href', '/collections/7');

    fireEvent.click(screen.getByRole('switch', { name: 'Leave collection spending out of this page' }));
    expect(screen.getByText('Showing the period without collections')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Leave collection spending out of this page' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('AnalyticsTab', () => {
  it('reads as a report, one titled section after another', () => {
    renderTab();
    ['Cash flow', 'Statement', 'What to look at next', 'How your position has moved',
      'Charges due in the next 30 days', 'What repeats on a schedule', 'Key ratios'].forEach(name => {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    });
    // The views the statement replaced are gone rather than repeated below it.
    expect(screen.queryByText('Where the money went')).not.toBeInTheDocument();
    expect(screen.queryByText('Your overall position')).not.toBeInTheDocument();
  });

  it('shows where the month is heading only while it is still running', () => {
    localStorage.setItem('ft_analytics_period', 'this-month');
    const { unmount } = renderTab();
    expect(screen.getByRole('heading', { name: 'Month-end outlook' })).toBeInTheDocument();
    unmount();

    // A finished month has nothing left to project.
    localStorage.setItem('ft_analytics_period', 'custom');
    localStorage.setItem('ft_analytics_month', monthOffset(1));
    renderTab();
    expect(screen.queryByRole('heading', { name: 'Month-end outlook' })).not.toBeInTheDocument();
    localStorage.setItem('ft_analytics_period', 'this-month');
  });

  it('keeps the schedule collapsed until asked, and really hidden', () => {
    renderTab();
    const toggle = screen.getByRole('button', { name: 'What repeats on a schedule' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // A stylesheet `display: flex` once beat the user-agent `[hidden]` rule
    // and left a "collapsed" panel fully visible.
    expect(document.getElementById('analytics-recurring-body')).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
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
    expect(screen.getByText(/Categories unavailable/)).toBeInTheDocument();
    // Totals do not depend on the category list, so cash flow still renders.
    expect(screen.getByRole('heading', { name: 'Cash flow' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /^Total spending/ })).toBeInTheDocument();
  });

  it('changes the period and keeps every section on the new range', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Last 3 months' }));
    expect(screen.getByRole('button', { name: 'Last 3 months' })).toHaveAttribute('aria-pressed', 'true');
    // The statement now reads the three months up to today.
    expect(screen.getByRole('heading', { name: 'Statement' }).parentElement?.parentElement)
      .toHaveTextContent(/ – .* so far/);
  });

  it('opens the category drawer from the spending list', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /open details/i })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
