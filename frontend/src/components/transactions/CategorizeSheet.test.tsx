import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Category, Transaction } from '../../types';
import CategorizeSheet, { type CategorizeSuggestion } from './CategorizeSheet';

/**
 * The categorization workflow.
 *
 * These tests describe the flow rather than the markup: file one, land on the
 * next, take one back, and be told when the queue is empty. The old sheet
 * closed after every assignment, so "advances to the next transaction" is the
 * behaviour that has to be pinned down.
 */

const categories: Category[] = [
  { id: 10, user_id: 1, name: 'Groceries', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: 11, user_id: 1, name: 'Transport', type: 'expense', color: '#11e', is_system: false, created_at: '' },
  { id: 12, user_id: 1, name: 'Dining', type: 'expense', color: '#1e1', is_system: false, created_at: '' },
];

const suggestions: CategorizeSuggestion[] = [{ ...categories[0], count: 7 }];

const tx = (id: number, amount: number, description: string): Transaction => ({
  id, user_id: 1, account_id: 1, category_id: null, amount,
  description, transaction_date: '2026-08-0' + id, created_at: '',
});

const queue = [tx(1, -12.5, 'Corner Shop'), tx(2, -40, 'Petrol'), tx(3, -9, 'Coffee')];

interface Overrides {
  initialTransaction?: Transaction | null;
  queue?: Transaction[];
  onAssign?: jest.Mock;
  onClose?: jest.Mock;
  onDelete?: jest.Mock;
  onEdit?: jest.Mock;
}

const setup = (overrides: Overrides = {}) => {
  const onAssign = overrides.onAssign ?? jest.fn().mockResolvedValue(true);
  const onClose = overrides.onClose ?? jest.fn();
  const onDelete = overrides.onDelete ?? jest.fn();
  const onEdit = overrides.onEdit ?? jest.fn();

  const view = render(
    <CategorizeSheet
      initialTransaction={overrides.initialTransaction ?? queue[0]}
      queue={overrides.queue ?? queue}
      categories={categories}
      suggestions={suggestions}
      onAssign={onAssign}
      onClose={onClose}
      onDelete={onDelete}
      onEdit={onEdit}
    />,
  );

  return { ...view, onAssign, onClose, onDelete, onEdit };
};

describe('auto-advance', () => {
  it('moves to the next uncategorized transaction instead of closing', async () => {
    const { onAssign, onClose } = setup();

    expect(screen.getByText('Corner Shop')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));

    await waitFor(() => expect(screen.getByText('Petrol')).toBeInTheDocument());
    expect(screen.queryByText('Corner Shop')).not.toBeInTheDocument();
    expect(onAssign).toHaveBeenCalledWith(1, 10);
    // The sheet stays open — that is the whole point.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps walking forward through the queue', async () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await waitFor(() => expect(screen.getByText('Petrol')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Transport/ }));

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
  });

  it('starts at the transaction that was tapped, not the top of the queue', () => {
    setup({ initialTransaction: queue[2] });

    expect(screen.getByText('Coffee')).toBeInTheDocument();
  });

  it('counts down how many are left', async () => {
    setup();

    expect(screen.getByText('2 more to review')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));

    await waitFor(() => expect(screen.getByText('1 more to review')).toBeInTheDocument());
  });
});

describe('final item', () => {
  it('shows a success state instead of a fourth empty sheet', async () => {
    const { onClose } = setup({ initialTransaction: queue[2], queue: [queue[2]] });

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));

    await waitFor(() => expect(screen.getByText('All transactions categorized')).toBeInTheDocument());
    expect(screen.getByText('1 transaction filed')).toBeInTheDocument();
    // Success is a state the user dismisses, not an automatic disappearance.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers a clear way out of the success state', async () => {
    const { onClose } = setup({ initialTransaction: queue[2], queue: [queue[2]] });

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await waitFor(() => expect(screen.getByText('All transactions categorized')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('reports the number filed across a whole session', async () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await waitFor(() => expect(screen.getByText('Petrol')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Transport/ }));
    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Dining/ }));

    await waitFor(() => expect(screen.getByText('3 transactions filed')).toBeInTheDocument());
  });
});

describe('undo', () => {
  it('offers undo after an assignment and names the category', async () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));

    await waitFor(() => expect(screen.getByText(/Filed under/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('returns to the transaction and clears its category', async () => {
    const { onAssign } = setup();

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await waitFor(() => expect(screen.getByText('Petrol')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(screen.getByText('Corner Shop')).toBeInTheDocument());
    expect(onAssign).toHaveBeenLastCalledWith(1, null);
  });

  it('can undo out of the success state', async () => {
    const { onAssign } = setup({ initialTransaction: queue[2], queue: [queue[2]] });

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await waitFor(() => expect(screen.getByText('All transactions categorized')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Undo last' }));

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
    expect(onAssign).toHaveBeenLastCalledWith(3, null);
  });
});

describe('rollback on failure', () => {
  it('returns to the transaction whose write failed', async () => {
    const onAssign = jest.fn().mockResolvedValue(false);
    setup({ onAssign });

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));

    // It advanced optimistically, then stepped back when the write failed.
    await waitFor(() => expect(screen.getByText('Corner Shop')).toBeInTheDocument());
    expect(screen.queryByText('Petrol')).not.toBeInTheDocument();
  });

  it('does not offer undo for an assignment that never landed', async () => {
    const onAssign = jest.fn().mockResolvedValue(false);
    setup({ onAssign });

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));

    await waitFor(() => expect(screen.getByText('Corner Shop')).toBeInTheDocument());
    expect(screen.queryByText(/Filed under/)).not.toBeInTheDocument();
  });

  it('does not reach the success state when the last write failed', async () => {
    const onAssign = jest.fn().mockResolvedValue(false);
    setup({ initialTransaction: queue[2], queue: [queue[2]], onAssign });

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
    expect(screen.queryByText('All transactions categorized')).not.toBeInTheDocument();
  });
});

describe('suggested categories', () => {
  it('never repeats a suggestion in the full list', () => {
    setup();

    // "Groceries" is the suggestion, so it appears exactly once.
    expect(screen.getAllByRole('button', { name: /Groceries/ })).toHaveLength(1);
    expect(screen.getByText('Suggested')).toBeInTheDocument();
    expect(screen.getByText('All other categories')).toBeInTheDocument();
  });

  it('lists every category exactly once between the two groups', () => {
    setup();

    categories.forEach(cat => {
      expect(screen.getAllByRole('button', { name: new RegExp(cat.name) })).toHaveLength(1);
    });
  });

  it('does not shift the suggestions mid-session', async () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await waitFor(() => expect(screen.getByText('Petrol')).toBeInTheDocument());

    // The button the thumb is aimed at has not moved to a different group.
    expect(screen.getByText('Suggested')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Groceries/ })).toHaveLength(1);
  });

  it('titles the list plainly when there is nothing to suggest', () => {
    render(
      <CategorizeSheet
        initialTransaction={queue[0]}
        queue={queue}
        categories={categories}
        suggestions={[]}
        onAssign={jest.fn().mockResolvedValue(true)}
        onClose={jest.fn()}
        onDelete={jest.fn()}
        onEdit={jest.fn()}
      />,
    );

    expect(screen.getByText('All categories')).toBeInTheDocument();
    expect(screen.queryByText('Suggested')).not.toBeInTheDocument();
  });
});

describe('manual escape hatches stay available', () => {
  it('can delete the transaction in front of you', async () => {
    const { onDelete } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledWith(queue[0]);
  });

  it('can open the full editor', async () => {
    const { onEdit } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));

    expect(onEdit).toHaveBeenCalledWith(queue[0]);
  });
});
