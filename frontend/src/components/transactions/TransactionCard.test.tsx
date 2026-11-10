import { vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TransactionCard from './TransactionCard';
import type { Account, Transaction } from '../../types';

/**
 * Spending is never painted red (PRODUCT.md, design principle 4): money out
 * is the normal text colour, money in is green. The Timeline showed every
 * purchase in red until this was pinned.
 */

const accounts = [
  { id: 1, user_id: 1, name: 'Spend', type: 'checking', balance: 0, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
] as Account[];

const tx = (amount: number): Transaction => ({
  id: amount > 0 ? 1 : 2, user_id: 1, account_id: 1, category_id: null, amount,
  description: amount > 0 ? 'PHILIPS' : 'Koi', transaction_date: '2026-11-10', created_at: '',
});

const renderCard = (amount: number, mobileCard = false) =>
  render(
    <TransactionCard tx={tx(amount)} accounts={accounts} isDragging={false} mobileCard={mobileCard}
      onDragStart={vi.fn()} onDragEnd={vi.fn()} onClick={vi.fn()} onDelete={vi.fn()} />,
  );

describe('TransactionCard amount colour', () => {
  it.each([false, true])('shows spending in the normal colour (mobile: %s)', mobileCard => {
    renderCard(-32.87, mobileCard);
    expect(screen.getByText(/32\.87/)).toHaveStyle({ color: 'var(--fg)' });
  });

  it('shows money in as green', () => {
    renderCard(1835.29);
    expect(screen.getByText(/1,835\.29/)).toHaveStyle({ color: 'var(--pos)' });
  });
});
