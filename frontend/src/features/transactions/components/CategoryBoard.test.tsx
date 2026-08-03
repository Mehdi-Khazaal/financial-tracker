import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, Category, Transaction } from '../../../types';
import { buildClassificationContext } from '../../analytics/calculations/transactions';
import { buildBoard } from '../calculations/board';
import CategoryBoard from './CategoryBoard';

/**
 * The redesigned review board.
 *
 * The point of these tests is that the redesign kept its contract: dropping
 * still categorizes, clicking still opens the drawer, and an empty category is
 * still reachable — collapsed by default, but never lost.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 0, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
];

const cat = (id: number, name: string): Category =>
  ({ id, user_id: 1, name, type: 'expense', color: '#e11', is_system: false, created_at: '' });

const groceries = cat(10, 'Groceries');
const rent = cat(11, 'Rent');
const zoo = cat(30, 'Zoo Trips');
const categories = [groceries, rent, zoo];
const ctx = buildClassificationContext(accounts, categories);

let nextId = 1;
const tx = (amount: number, categoryId: number, description = 'Entry'): Transaction => ({
  id: nextId++, user_id: 1, account_id: 1, category_id: categoryId, amount,
  description, transaction_date: '2026-08-05', created_at: '',
});

const month = [tx(-80, groceries.id), tx(-20, groceries.id), tx(-1400, rent.id)];

const renderBoard = (overrides: Partial<React.ComponentProps<typeof CategoryBoard>> = {}) => {
  const onDrop = jest.fn(() => jest.fn());
  const onOpenCategory = jest.fn();
  const props: React.ComponentProps<typeof CategoryBoard> = {
    layout: buildBoard(categories, month, ctx),
    maxPreview: 3,
    draggingTxId: null,
    dragOverTarget: null,
    onDragOver: () => () => {},
    onDragLeave: () => {},
    onDrop,
    onOpenCategory,
    makeDragHandlers: () => ({
      onDragStart: () => {},
      onDragEnd: () => {},
      onClick: () => {},
      onDelete: () => {},
    }),
    ...overrides,
  };

  return { ...render(<CategoryBoard {...props} />), onDrop, onOpenCategory };
};

describe('layout', () => {
  it('renders active categories as columns, biggest spending first', () => {
    renderBoard();

    const headings = screen.getAllByRole('button', { name: /Open details/ });
    expect(headings[0]).toHaveAccessibleName(/Rent/);
    expect(headings[1]).toHaveAccessibleName(/Groceries/);
  });

  it('uses a wrapping grid rather than a horizontal track', () => {
    const { container } = renderBoard();
    const grid = container.querySelector<HTMLElement>('div.grid');

    // `auto-fill` is what makes the board responsive without a breakpoint per
    // device; `grid-auto-flow: column` is what made the old one scroll sideways.
    expect(grid?.style.gridTemplateColumns).toContain('auto-fill');
    expect(grid?.style.gridAutoFlow).toBe('');
  });

  it('keeps counts and totals on each column', () => {
    renderBoard();

    expect(screen.getByRole('button', { name: /Groceries: \$100\.00 across 2 transactions/ })).toBeInTheDocument();
    expect(screen.getByText('$1,400.00')).toBeInTheDocument();
  });

  it('offers a "more" action when a column overflows its preview', () => {
    const many = [tx(-10, groceries.id), tx(-10, groceries.id), tx(-10, groceries.id), tx(-10, groceries.id)];
    const { onOpenCategory } = renderBoard({ layout: buildBoard(categories, many, ctx) });

    fireEvent.click(screen.getByText('+1 more →'));

    expect(onOpenCategory).toHaveBeenCalledWith(groceries);
  });
});

describe('empty categories', () => {
  it('collapses them instead of giving each a full card', () => {
    renderBoard();

    expect(screen.getByText('1 category with nothing this month')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zoo Trips/ })).not.toBeInTheDocument();
  });

  it('reveals them on request', () => {
    renderBoard();

    fireEvent.click(screen.getByText('1 category with nothing this month'));

    expect(screen.getByRole('button', { name: 'Zoo Trips' })).toBeInTheDocument();
  });

  it('reveals them automatically during a drag so they stay droppable', () => {
    renderBoard({ draggingTxId: 5 });

    // No click needed — a hidden drop target would be a dead end mid-gesture.
    expect(screen.getByRole('button', { name: 'Zoo Trips' })).toBeInTheDocument();
  });

  it('says nothing when every category has activity', () => {
    renderBoard({ layout: buildBoard([groceries, rent], month, ctx) });

    expect(screen.queryByText(/nothing this month/)).not.toBeInTheDocument();
  });
});

describe('drag and drop survives the redesign', () => {
  it('still drops onto an active column', () => {
    const onDrop = jest.fn(() => jest.fn());
    renderBoard({ onDrop });

    const column = screen.getByRole('button', { name: /Rent: .* Open details/ }).closest('div');
    fireEvent.drop(column as HTMLElement);

    expect(onDrop).toHaveBeenCalledWith(rent.id);
  });

  it('still drops onto a collapsed empty category once revealed', () => {
    const onDrop = jest.fn(() => jest.fn());
    renderBoard({ onDrop, draggingTxId: 5 });

    fireEvent.drop(screen.getByRole('button', { name: 'Zoo Trips' }));

    expect(onDrop).toHaveBeenCalledWith(zoo.id);
  });

  it('shows a drop affordance on the column being hovered', () => {
    renderBoard({ dragOverTarget: rent.id, draggingTxId: 5 });

    expect(screen.getByText('Drop here')).toBeInTheDocument();
  });
});

describe('opening a category', () => {
  it('opens the drawer from the column header', () => {
    const { onOpenCategory } = renderBoard();

    fireEvent.click(screen.getByRole('button', { name: /Rent: .* Open details/ }));

    expect(onOpenCategory).toHaveBeenCalledWith(rent);
  });

  it('opens the drawer from a collapsed empty category', () => {
    const { onOpenCategory } = renderBoard();

    fireEvent.click(screen.getByText('1 category with nothing this month'));
    fireEvent.click(screen.getByRole('button', { name: 'Zoo Trips' }));

    expect(onOpenCategory).toHaveBeenCalledWith(zoo);
  });
});

describe('no categories at all', () => {
  it('explains what to do instead of showing an empty grid', () => {
    renderBoard({ layout: buildBoard([], [], ctx) });

    expect(screen.getByText('No categories yet')).toBeInTheDocument();
    expect(screen.getByText(/Add categories in Settings/)).toBeInTheDocument();
  });
});

describe('long merchant names', () => {
  it('truncates the row and keeps the full text reachable', () => {
    const longName = 'SQ *THE VERY LONG COFFEE ROASTERY AND BAKERY COMPANY LIMITED';
    const layout = buildBoard(categories, [tx(-9, groceries.id, longName)], ctx);
    const { container } = renderBoard({ layout });

    const row = within(container).getByTitle(longName);
    expect(row).toHaveClass('truncate');
  });
});
