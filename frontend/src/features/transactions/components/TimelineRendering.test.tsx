import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, Category, Transaction } from '../../../types';
import { buildClassificationContext, classifyTransaction } from '../../analytics/calculations/transactions';
import { groupByDay } from '../calculations/timeline';
import DayHeader from './DayHeader';
import TransactionCard from '../../../components/transactions/TransactionCard';

/**
 * Timeline rendering: the day header and the row.
 *
 * The row tests cover the two things that make a long list scannable — a
 * merchant name that truncates instead of shoving the amount off-screen, and a
 * label on the two classifications whose sign lies about what they are.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 0, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Rewards Card', type: 'credit_card', balance: -200, credit_limit: 1500, currency: 'USD', created_at: '', updated_at: '' },
];

const groceries: Category = { id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' };
const salary: Category = { id: 11, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' };
const ctx = buildClassificationContext(accounts, [groceries, salary]);

let nextId = 1;
const tx = (amount: number, overrides: Partial<Transaction> = {}): Transaction => ({
  id: nextId++, user_id: 1, account_id: 1, category_id: groceries.id, amount,
  description: 'Corner Shop', transaction_date: '2026-08-12', created_at: '', ...overrides,
});

const TODAY = new Date(2026, 7, 12);

const renderRow = (transaction: Transaction, categoryName: string | null = 'Groceries') =>
  render(
    <TransactionCard
      tx={transaction}
      accounts={accounts}
      isDragging={false}
      noDrag
      kind={classifyTransaction(transaction, ctx)}
      categoryName={categoryName}
      onDragStart={() => {}}
      onDragEnd={() => {}}
      onClick={() => {}}
      onDelete={() => {}}
    />,
  );

describe('DayHeader', () => {
  it('names the day and counts its transactions', () => {
    const [day] = groupByDay([tx(-10), tx(-20)], ctx, TODAY);
    render(<DayHeader day={day} />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('2 transactions')).toBeInTheDocument();
  });

  it('uses the singular for a single transaction', () => {
    const [day] = groupByDay([tx(-10)], ctx, TODAY);
    render(<DayHeader day={day} />);

    expect(screen.getByText('1 transaction')).toBeInTheDocument();
  });

  it('shows income and spending separately, with a net when both moved', () => {
    const [day] = groupByDay([tx(3000, { category_id: salary.id }), tx(-120)], ctx, TODAY);
    render(<DayHeader day={day} />);

    expect(screen.getByText('+$3,000.00')).toBeInTheDocument();
    expect(screen.getByText('−$120.00')).toBeInTheDocument();
    expect(screen.getByText('+$2,880.00')).toBeInTheDocument();
  });

  it('omits the net on a spending-only day, where it would just repeat', () => {
    const [day] = groupByDay([tx(-120)], ctx, TODAY);
    render(<DayHeader day={day} />);

    expect(screen.getByText('−$120.00')).toBeInTheDocument();
    expect(screen.queryByText('+$0.00')).not.toBeInTheDocument();
  });

  it('excludes a card payment from the day’s income', () => {
    const [day] = groupByDay([tx(300, { account_id: 2, category_id: null })], ctx, TODAY);
    render(<DayHeader day={day} />);

    expect(screen.queryByText('+$300.00')).not.toBeInTheDocument();
  });
});

describe('transaction row', () => {
  it('shows merchant, account, category and date without crowding', () => {
    renderRow(tx(-42.5));

    expect(screen.getByText('Corner Shop')).toBeInTheDocument();
    expect(screen.getByText(/Everyday · Groceries · Aug 12/)).toBeInTheDocument();
  });

  it('truncates a long merchant name and keeps the full value in a tooltip', () => {
    const longName = 'SQ *THE VERY LONG COFFEE ROASTERY AND BAKERY COMPANY LIMITED';
    renderRow(tx(-9, { description: longName }));

    const name = screen.getByTitle(longName);
    expect(name).toHaveClass('truncate');
    expect(name).toHaveTextContent(longName);
  });

  it('keeps the amount out of the truncating column', () => {
    const { container } = renderRow(tx(-9, { description: 'A'.repeat(200) }));

    // The amount lives in a `shrink-0` sibling, so no description can push it
    // off the right edge however long it gets.
    const amount = screen.getByText('-$9.00');
    expect(amount.parentElement?.className).toContain('shrink-0');
    expect(container.querySelector('.min-w-0')).toBeInTheDocument();
  });

  it('labels a refund, which a positive sign alone would call income', () => {
    renderRow(tx(25, { category_id: groceries.id }));

    expect(screen.getByText('Refund')).toBeInTheDocument();
  });

  it('labels a card payment for the same reason', () => {
    renderRow(tx(300, { account_id: 2, category_id: null }), null);

    expect(screen.getByText('Card payment')).toBeInTheDocument();
  });

  it('does not label plain spending or plain income', () => {
    const { unmount } = renderRow(tx(-42));
    expect(screen.queryByText('Expense')).not.toBeInTheDocument();
    unmount();

    renderRow(tx(3000, { category_id: salary.id }), 'Salary');
    expect(screen.queryByText('Income')).not.toBeInTheDocument();
  });

  it('omits an absent category rather than printing a placeholder', () => {
    renderRow(tx(-42, { category_id: null }), null);

    expect(screen.getByText(/Everyday · Aug 12/)).toBeInTheDocument();
    expect(screen.queryByText(/Uncategorized/)).not.toBeInTheDocument();
  });
});
