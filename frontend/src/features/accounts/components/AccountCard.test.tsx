import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, MonthSnapshot } from '../../../types';
import AccountCard from './AccountCard';

jest.mock('react-router-dom', () => {
  const react = jest.requireActual('react');
  return {
    Link: ({ to, children, ...rest }: { to: string; children: unknown }) =>
      react.createElement('a', { href: to, ...rest }, children),
  };
});

/**
 * The shared account card.
 *
 * Credit cards used to render twice with different wording and different
 * emphasis. These tests pin the single implementation: what each state says,
 * that a destructive control never dominates, and that the deep link carries
 * the account it came from.
 */

let nextId = 1;
const account = (overrides: Partial<Account> = {}): Account => ({
  id: nextId++,
  user_id: 1,
  name: 'Everyday Checking',
  type: 'checking',
  balance: 4200,
  credit_limit: null,
  currency: 'USD',
  created_at: '',
  updated_at: '',
  ...overrides,
});

const snap = (month: string, balance: number): MonthSnapshot => ({ month, balance });

const renderCard = (
  acct: Account,
  history?: MonthSnapshot[],
  extra: Partial<React.ComponentProps<typeof AccountCard>> = {},
) => {
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  const onRecordPayment = jest.fn();
  const view = render(
    <AccountCard
      account={acct}
      history={history}
      onEdit={onEdit}
      onDelete={onDelete}
      onRecordPayment={onRecordPayment}
      {...extra}
    />,
  );
  return { ...view, onEdit, onDelete, onRecordPayment };
};

describe('every account type', () => {
  it('shows a positive balance plainly', () => {
    renderCard(account());

    expect(screen.getByText('Everyday Checking')).toBeInTheDocument();
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('$4,200.00')).toBeInTheDocument();
  });

  it('flags an overdrawn everyday account', () => {
    renderCard(account({ balance: -80 }));

    expect(screen.getByText('Overdrawn')).toBeInTheDocument();
    expect(screen.getByText(/Overdrawn by \$80\.00/)).toBeInTheDocument();
  });

  it('renders savings and cash through the same component', () => {
    const { unmount } = renderCard(account({ type: 'savings', name: 'Emergency', balance: 12000 }));
    expect(screen.getByText('Savings')).toBeInTheDocument();
    unmount();

    renderCard(account({ type: 'cash', name: 'Wallet', balance: 180 }));
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });
});

describe('credit cards', () => {
  const card = (balance: number, limit: number | null = 6000) =>
    account({ type: 'credit_card', name: 'Venture Card', balance, credit_limit: limit });

  it('leads with the amount owed, never a negative sign', () => {
    renderCard(card(-213.37));

    expect(screen.getByText('$213.37 owed')).toBeInTheDocument();
    expect(screen.queryByText('−$213.37')).not.toBeInTheDocument();
    expect(screen.queryByText('-$213.37')).not.toBeInTheDocument();
  });

  it('shows available credit and utilisation as secondary information', () => {
    const { container } = renderCard(card(-1500));

    // The amount sits in its own span so only it blurs, so match on the text
    // content of the row rather than a single node.
    expect(container.textContent).toContain('$4,500.00');
    expect(container.textContent).toContain('available');
    expect(container.textContent).toContain('25% of $6,000.00');
  });

  it('reads a paid-off card as positive', () => {
    renderCard(card(0));

    expect(screen.getByText('Paid off')).toBeInTheDocument();
    expect(screen.getByText(/Paid off, nothing owed/)).toBeInTheDocument();
  });

  it('handles a card in credit', () => {
    renderCard(card(42));

    expect(screen.getByText('$42.00 in credit')).toBeInTheDocument();
    expect(screen.getByText(/credit balance, nothing owed/)).toBeInTheDocument();
  });

  it('says utilisation is unavailable rather than showing 0%', () => {
    renderCard(card(-400, null));

    expect(screen.getByText(/No credit limit recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/0% of/)).not.toBeInTheDocument();
  });

  it('names high use in words, not colour alone', () => {
    renderCard(card(-5400));

    expect(screen.getByText('High use')).toBeInTheDocument();
  });

  it('calls low use low, without congratulating', () => {
    renderCard(card(-600));

    expect(screen.getByText('Low use')).toBeInTheDocument();
  });

  it('describes utilisation to a screen reader on the bar itself', () => {
    renderCard(card(-1500));

    expect(
      screen.getByRole('progressbar', { name: /Venture Card credit use: 25% of limit\. Low use\./ }),
    ).toBeInTheDocument();
  });

  it('offers "Record a payment", not a claim that Fintrack pays the card', () => {
    const { onRecordPayment } = renderCard(card(-213.37));

    // The action writes a transfer between two Fintrack accounts; it contacts
    // no bank, so neither this trigger nor the modal's confirm button may be
    // labelled as though it does. `TransferModal` carries the matching test.
    expect(screen.queryByText('Pay Card')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Record a payment'));
    expect(onRecordPayment).toHaveBeenCalled();
  });

  it('offers no payment action on a non-card account', () => {
    renderCard(account());

    expect(screen.queryByText('Record a payment')).not.toBeInTheDocument();
  });
});

describe('recent change', () => {
  it('states the movement and the window', () => {
    renderCard(account(), [snap('2026-03', 4000), snap('2026-04', 4200)]);

    expect(screen.getByText('+$200.00')).toBeInTheDocument();
    expect(screen.getByText(/over 2 months/)).toBeInTheDocument();
  });

  it('admits missing history instead of printing a zero change', () => {
    renderCard(account(), undefined);

    expect(screen.getByText('Not enough history for a trend yet')).toBeInTheDocument();
    expect(screen.queryByText('+$0.00')).not.toBeInTheDocument();
  });

  it('does the same for a single snapshot', () => {
    renderCard(account(), [snap('2026-04', 4200)]);

    expect(screen.getByText('Not enough history for a trend yet')).toBeInTheDocument();
  });

  it('says "No change" only when the balance genuinely held', () => {
    renderCard(account(), [snap('2026-03', 4200), snap('2026-04', 4200)]);

    expect(screen.getByText('No change')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('links to the timeline filtered to this account', () => {
    const acct = account({ id: 7 });
    renderCard(acct);

    expect(screen.getByRole('link', { name: /View transactions for Everyday Checking/ }))
      .toHaveAttribute('href', '/transactions?tab=list&account=7');
  });

  it('carries the right id for every account type', () => {
    const types: Account['type'][] = ['checking', 'savings', 'cash', 'credit_card', 'investment'];

    types.forEach((type, index) => {
      const { unmount } = renderCard(account({ id: 100 + index, type }));
      expect(screen.getByRole('link', { name: /View transactions/ }))
        .toHaveAttribute('href', `/transactions?tab=list&account=${100 + index}`);
      unmount();
    });
  });

  it('does not make the whole card a link, which would swallow edit and delete', () => {
    const { container } = renderCard(account());

    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/View transactions/);
  });
});

describe('actions', () => {
  it('exposes edit and delete as real buttons with names', () => {
    const { onEdit, onDelete } = renderCard(account());

    fireEvent.click(screen.getByRole('button', { name: 'Edit Everyday Checking' }));
    expect(onEdit).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Everyday Checking' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('does not give the destructive control colour emphasis', () => {
    renderCard(account());

    const del = screen.getByRole('button', { name: 'Delete Everyday Checking' });
    const edit = screen.getByRole('button', { name: 'Edit Everyday Checking' });

    // jsdom drops `var()` values from inline styles, so the token colour is not
    // assertable here. What is assertable — and what actually matters — is that
    // the destructive control is no louder than the benign one beside it, and
    // that neither is rendered as a full-width primary button.
    expect(del.className).toBe(edit.className);
    expect(del.className).not.toContain('btn-gradient');
    expect(del.className).not.toContain('flex-1');
  });

  it('keeps actions in the DOM on touch, where hover does not exist', () => {
    const { container } = renderCard(account());
    const actions = container.querySelector('.opacity-100.md\\:opacity-0');

    expect(actions).toBeInTheDocument();
    expect(within(actions as HTMLElement).getAllByRole('button')).toHaveLength(2);
  });
});

describe('privacy mode', () => {
  it('puts the blur hook on the balance', () => {
    renderCard(account());

    // The visible figure is a span inside the styled paragraph; the blur class
    // lives on the paragraph so the whole amount goes soft together.
    expect(screen.getByText('$4,200.00').closest('p')).toHaveClass('tabular-nums');
  });

  it('leaves the account name and type readable', () => {
    const { container } = renderCard(account());

    expect(screen.getByText('Everyday Checking')).not.toHaveClass('tabular-nums');
    expect(screen.getByText('Checking')).not.toHaveClass('tabular-nums');
    // The "over 2 months" wording stays legible; only the amount blurs.
    expect(container.querySelectorAll('.tabular-nums').length).toBeGreaterThan(0);
  });
});
