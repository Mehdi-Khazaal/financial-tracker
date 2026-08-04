import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { SavingsGoal } from '../../../types';
import { describeGoalProgress } from '../calculations/goals';
import GoalCard from './GoalCard';

jest.mock('react-router-dom', () => {
  const react = jest.requireActual('react');
  return {
    Link: ({ to, children, ...rest }: { to: string; children: unknown }) =>
      react.createElement('a', { href: to, ...rest }, children),
  };
});

/**
 * Goal cards.
 *
 * Every pace state gets a test, because the label is the whole product here:
 * the arithmetic is covered in `goals.test.ts`, and what matters at this layer
 * is that the card says the right thing, withholds what it cannot support, and
 * never contradicts itself.
 */

const TODAY = new Date(2026, 7, 3);

let nextId = 1;
const goal = (overrides: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: nextId++,
  user_id: 1,
  name: 'Summer 2027',
  target_amount: 12000,
  deadline: null,
  created_at: '',
  allocations: [],
  current_amount: 0,
  ...overrides,
});

const renderGoal = (
  g: SavingsGoal,
  averageMonthlySaved: number | null = 500,
  averageMonths = 6,
  allocationAccounts: { id: number; name: string; amount: number }[] = [],
) => {
  const progress = describeGoalProgress(g, { today: TODAY, averageMonthlySaved, averageMonths });
  const onManageAllocations = jest.fn();
  const onSpend = jest.fn();
  const onDelete = jest.fn();
  const view = render(
    <GoalCard
      progress={progress}
      allocationAccounts={allocationAccounts}
      onManageAllocations={onManageAllocations}
      onSpend={onSpend}
      onDelete={onDelete}
    />,
  );
  return { ...view, onManageAllocations, onSpend, onDelete, progress };
};

describe('pace states', () => {
  it('shows Complete for a funded goal, calmly', () => {
    renderGoal(goal({ current_amount: 12000 }));

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Fully funded.')).toBeInTheDocument();
    // Nothing left to chase, so the schedule facts are gone.
    expect(screen.queryByText('Remaining')).not.toBeInTheDocument();
  });

  it('shows Overfunded with the true percentage', () => {
    renderGoal(goal({ current_amount: 15000 }));

    expect(screen.getByText('Overfunded')).toBeInTheDocument();
    expect(screen.getByText('125%')).toBeInTheDocument();
  });

  it('caps the bar at full while reporting past 100%', () => {
    renderGoal(goal({ current_amount: 15000 }));

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('shows Ahead of schedule', () => {
    renderGoal(goal({ deadline: '2027-08-03' }), 2000);

    expect(screen.getByText('Ahead of schedule')).toBeInTheDocument();
  });

  it('shows On track', () => {
    // 12 months to Aug 2027 → $1,000/month needed.
    renderGoal(goal({ deadline: '2027-08-03' }), 1000);

    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('shows Behind schedule without alarming language', () => {
    renderGoal(goal({ deadline: '2027-08-03' }), 400);

    expect(screen.getByText('Behind schedule')).toBeInTheDocument();
    expect(screen.getByText(/Your recent rate is below what this goal needs/)).toBeInTheDocument();
  });

  it('reports a passed target date without blame, and points at the fix', () => {
    renderGoal(goal({ deadline: '2026-01-01' }));

    expect(screen.getByText('Target date passed')).toBeInTheDocument();
    expect(screen.getByText(/Adjusting the date keeps the goal useful/)).toBeInTheDocument();
  });

  it('treats a missing target date as normal, not a problem', () => {
    renderGoal(goal({ current_amount: 3000 }));

    expect(screen.getByText('No target date')).toBeInTheDocument();
    expect(screen.getByText(/no schedule to measure against/)).toBeInTheDocument();
  });

  it('says when there is not enough history to judge a pace', () => {
    renderGoal(goal({ deadline: '2027-08-03' }), 1000, 1);

    expect(screen.getByText('Not enough history')).toBeInTheDocument();
    expect(screen.getByText(/3 completed months/)).toBeInTheDocument();
  });
});

describe('schedule facts', () => {
  it('shows the required monthly contribution when a future date exists', () => {
    renderGoal(goal({ deadline: '2027-08-03' }), 1000);

    expect(screen.getByText('Needed monthly')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
  });

  it('withholds it without a target date', () => {
    renderGoal(goal({ current_amount: 3000 }));

    expect(screen.queryByText('Needed monthly')).not.toBeInTheDocument();
  });

  it('withholds it once the date has passed', () => {
    renderGoal(goal({ deadline: '2026-01-01' }));

    expect(screen.queryByText('Needed monthly')).not.toBeInTheDocument();
  });

  it('shows a projected completion when the history supports one', () => {
    renderGoal(goal({ current_amount: 2000 }), 1000);

    expect(screen.getByText('Projected')).toBeInTheDocument();
    expect(screen.getByText('June 2027')).toBeInTheDocument();
  });

  it('withholds the projection on a thin history', () => {
    renderGoal(goal({ current_amount: 2000 }), 1000, 2);

    expect(screen.queryByText('Projected')).not.toBeInTheDocument();
  });

  it('withholds the projection when it would contradict the pace label', () => {
    // Needs $2,222/month, saving $2,000 — behind, yet the projection rounds
    // into the same month as the target. Showing both reads as nonsense.
    renderGoal(goal({ target_amount: 20000, deadline: '2027-06-01' }), 2000);

    expect(screen.getByText('Behind schedule')).toBeInTheDocument();
    expect(screen.queryByText('Projected')).not.toBeInTheDocument();
  });

  it('shows the projection when it genuinely differs from the target', () => {
    renderGoal(goal({ target_amount: 20000, deadline: '2027-06-01' }), 800);

    expect(screen.getByText('Projected')).toBeInTheDocument();
  });

  it('always shows what remains on an unfinished goal', () => {
    renderGoal(goal({ current_amount: 4000 }));

    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(screen.getByText('$8,000.00')).toBeInTheDocument();
  });
});

describe('allocation links', () => {
  const accounts = [
    { id: 3, name: 'Emergency Fund', amount: 4000 },
    { id: 4, name: 'Everyday', amount: 500 },
  ];

  it('lists the accounts the money actually sits in', () => {
    renderGoal(goal({ current_amount: 4500 }), 500, 6, accounts);

    expect(screen.getByText('Held in')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Emergency Fund: \$4,000\.00 allocated/ })).toBeInTheDocument();
  });

  it('links each one to its filtered timeline', () => {
    renderGoal(goal({ current_amount: 4500 }), 500, 6, accounts);

    expect(screen.getByRole('link', { name: /Emergency Fund/ }))
      .toHaveAttribute('href', '/transactions?tab=list&account=3');
  });

  it('says nothing about allocations when there are none', () => {
    renderGoal(goal());

    expect(screen.queryByText('Held in')).not.toBeInTheDocument();
  });

  it('keeps allocation chips touch-sized', () => {
    renderGoal(goal({ current_amount: 4500 }), 500, 6, accounts);

    const link = screen.getByRole('link', { name: /Emergency Fund/ });
    expect(link.getAttribute('style')).toContain('min-height');
  });
});

describe('actions', () => {
  it('offers manage allocation as the primary action', () => {
    const { onManageAllocations } = renderGoal(goal());

    fireEvent.click(screen.getByRole('button', { name: 'Manage allocation' }));
    expect(onManageAllocations).toHaveBeenCalled();
  });

  it('offers Spend only when there is something allocated to spend', () => {
    const { unmount } = renderGoal(goal());
    expect(screen.queryByRole('button', { name: 'Spend' })).not.toBeInTheDocument();
    unmount();

    renderGoal(goal({ current_amount: 500 }), 500, 6, [{ id: 3, name: 'Fund', amount: 500 }]);
    expect(screen.getByRole('button', { name: 'Spend' })).toBeInTheDocument();
  });

  it('names the destructive action for assistive tech and keeps it quiet', () => {
    const { onDelete } = renderGoal(goal());

    const del = screen.getByRole('button', { name: 'Delete goal Summer 2027' });
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalled();

    // Plain text, not a filled or outlined control.
    expect(del.className).not.toContain('btn-gradient');
    expect(del.className).not.toContain('rounded-lg');
  });
});

describe('accessibility and privacy', () => {
  it('exposes progress and pace on the bar itself', () => {
    renderGoal(goal({ current_amount: 3000, deadline: '2027-08-03' }), 1000);

    expect(
      // $9,000 over 12 months needs $750/month; saving $1,000 is ahead.
      screen.getByRole('progressbar', { name: /Summer 2027: In progress, 25 percent funded\. Ahead of schedule\./ }),
    ).toBeInTheDocument();
  });

  it('states status in words as well as colour', () => {
    renderGoal(goal({ deadline: '2027-08-03' }), 400);

    // The pace chip is text; a colour-blind or greyscale reader loses nothing.
    expect(screen.getByText('Behind schedule')).toBeInTheDocument();
  });

  it('puts the blur hook on money and leaves the explanation readable', () => {
    renderGoal(goal({ current_amount: 3000, deadline: '2027-08-03' }), 400);

    expect(screen.getByText(/\$3,000\.00/).className).toContain('tabular-nums');
    expect(screen.getByText(/Your recent rate is below/).className).not.toContain('tabular-nums');
  });
});

describe('edge cases', () => {
  it('does not print a percentage for a goal with no target', () => {
    renderGoal(goal({ target_amount: 0, current_amount: 100 }));

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('never shows a negative remaining', () => {
    renderGoal(goal({ current_amount: 20000 }));

    // Overfunded, so the schedule block is hidden entirely.
    expect(screen.queryByText('Remaining')).not.toBeInTheDocument();
    expect(screen.getByText('Overfunded')).toBeInTheDocument();
  });
});
