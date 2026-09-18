import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import SetupChecklist from './SetupChecklist';

const setup = (props: Partial<React.ComponentProps<typeof SetupChecklist>> = {}) => {
  const onSetBudget = vi.fn();
  render(
    <MemoryRouter>
      <SetupChecklist userId={7} hasAccounts={false} hasBudget={false} onSetBudget={onSetBudget} {...props} />
    </MemoryRouter>,
  );
  return { onSetBudget };
};

beforeEach(() => { localStorage.clear(); });

describe('SetupChecklist', () => {
  it('shows the three steps with the data-driven ones ticked', () => {
    setup({ hasAccounts: true });
    expect(screen.getByText('2 steps left')).toBeInTheDocument();
    expect(screen.getByText('Add an account or connect a bank')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.getByText('Open categories →')).toBeInTheDocument();
  });

  it('routes the budget step to the sheet', () => {
    const { onSetBudget } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Set a budget →' }));
    expect(onSetBudget).toHaveBeenCalled();
  });

  it('remembers a category review and a dismissal per user', () => {
    setup({ hasAccounts: true, hasBudget: true });
    fireEvent.click(screen.getByText('Open categories →'));
    expect(localStorage.getItem('ft_setup_categories_7')).toBe('1');
  });

  it('disappears once everything is done, and stays hidden after Hide', () => {
    localStorage.setItem('ft_setup_categories_7', '1');
    const { container } = render(
      <MemoryRouter><SetupChecklist userId={7} hasAccounts hasBudget onSetBudget={vi.fn()} /></MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();

    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide setup checklist' }));
    expect(screen.queryByText('Get set up')).not.toBeInTheDocument();
    expect(localStorage.getItem('ft_setup_dismissed_7')).toBe('1');
  });
});
