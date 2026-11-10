import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GoalPlanCard from './GoalPlanCard';
import { setGoalOrder } from '../../../utils/api';
import { planGoals } from '../calculations/goalPlan';
import { summariseGoals } from '../calculations/goals';
import type { SavingsGoal } from '../../../types';

vi.mock('../../../utils/api', () => ({ __esModule: true, setGoalOrder: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => toast }));

const TODAY = new Date(2026, 10, 10);

const goal = (id: number, name: string, target: number, saved: number, deadline: string | null, extra: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id, user_id: 1, name, target_amount: target, current_amount: saved, deadline, priority: id,
  created_at: '', allocations: [], ...extra,
});

// The live account's four goals.
const goals = [
  goal(1, 'Emergency Funds', 5000, 500, '2026-07-01', { is_emergency_fund: true }),
  goal(2, 'Summer 2027', 20000, 4910, '2027-06-30'),
  goal(3, 'Education', 8000, 2500.04, '2027-01-31'),
  goal(4, 'Trip', 2500, 1000, '2026-12-31'),
];

const plan = (ordered = goals, saving: number | null = 783) =>
  planGoals({ goals: ordered, monthlySaving: saving, today: TODAY });

describe('GoalPlanCard', () => {
  it('states the gap once and lists goals in funding order', () => {
    render(<GoalPlanCard plan={plan()} onReordered={vi.fn()} />);

    expect(screen.getByText('$6,405.69')).toBeInTheDocument();
    expect(screen.getByText('$783.00')).toBeInTheDocument();
    expect(screen.getByText(/not every goal can make its date/i)).toBeInTheDocument();
    const names = screen.getAllByRole('listitem').map(li => li.textContent ?? '');
    expect(names[0]).toMatch(/^1Emergency Funds/);
    expect(names[3]).toMatch(/^4Trip/);
    expect(screen.getByText('emergency fund')).toBeInTheDocument();
  });

  it('moves a goal up and hands back the saved order', async () => {
    const reordered = [goals[0], goals[3], goals[1], goals[2]];
    (setGoalOrder as Mock).mockResolvedValue({ data: reordered });
    const onReordered = vi.fn();
    render(<GoalPlanCard plan={plan()} onReordered={onReordered} />);

    expect(screen.getByRole('button', { name: 'Move Emergency Funds up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Trip up' }));

    await waitFor(() => expect(setGoalOrder).toHaveBeenCalledWith([1, 2, 4, 3]));
    expect(onReordered).toHaveBeenCalledWith(reordered);
  });

  it('says so when the order cannot be saved', async () => {
    (setGoalOrder as Mock).mockRejectedValue(new Error('500'));
    render(<GoalPlanCard plan={plan()} onReordered={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Trip down' }));
    expect(screen.getByRole('button', { name: 'Move Trip down' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move Education down' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not change the order'));
  });

  it('is honest when there is no saving history yet', () => {
    render(<GoalPlanCard plan={plan(goals, null)} onReordered={vi.fn()} />);
    expect(screen.getByText(/not enough saving history yet/i)).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for money left over each month')).toHaveLength(3);
  });

  it('tells apart no history from history showing nothing kept', () => {
    render(<GoalPlanCard plan={plan(goals, -250)} onReordered={vi.fn()} />);
    expect(screen.getByText(/spent about what you earned/i)).toBeInTheDocument();
    expect(screen.queryByText(/not enough saving history/i)).not.toBeInTheDocument();
  });
});

describe('goal cards read the plan', () => {
  it('replaces the each-goal-alone projection with the plan date', () => {
    const ordered = [goals[3], goals[2], goals[1]];
    const planned = planGoals({ goals: ordered, monthlySaving: 783, today: TODAY });
    const summary = summariseGoals(ordered, {
      today: TODAY, averageMonthlySaved: 783, averageMonths: 6,
      plan: new Map(planned.goals.map(g => [g.goal.id, g])),
    });
    const alone = summariseGoals(ordered, { today: TODAY, averageMonthlySaved: 783, averageMonths: 6 });

    const summer = summary.goals.find(g => g.goal.id === 2)!;
    const summerAlone = alone.goals.find(g => g.goal.id === 2)!;
    // Waiting behind Trip and Education pushes Summer 2027 later than alone.
    expect(summer.monthsAtCurrentRate!).toBeGreaterThan(summerAlone.monthsAtCurrentRate!);
    expect(summer.projectedCompletion).toBe(planned.goals.find(g => g.goal.id === 2)!.finishLabel);
    expect(summer.pace).toBe('behind');
    expect(summer.paceDetail).toMatch(/^In your goal plan it is funded by .+ months after its date\./);
  });
});
