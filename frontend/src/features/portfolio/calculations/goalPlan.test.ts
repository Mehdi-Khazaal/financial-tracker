import type { SavingsGoal } from '../../../types';
import { byPriority, describePlannedGoal, planGoals } from './goalPlan';

/**
 * Same cases as `backend/tests/test_goal_plan.py`, so the Savings tab and Fin
 * cannot drift apart on when a goal is reached.
 */

const TODAY = new Date(2026, 10, 10);

const goal = (id: number, remaining: number, deadline: string | null = null, priority: number | null = id): SavingsGoal => ({
  id, user_id: 1, name: `Goal ${id}`, target_amount: remaining + 100, current_amount: 100,
  deadline, priority, created_at: '', allocations: [],
});

const byId = (goals: SavingsGoal[], saving: number | null, lines: [number, number][] = []) => {
  const plan = planGoals({ goals, monthlySaving: saving, fromPaychecks: new Map(lines), today: TODAY });
  return { plan, at: (id: number) => plan.goals.find(p => p.goal.id === id)! };
};

describe('planGoals', () => {
  it('adds up what the live account’s goals need: $6,405.69 a month', () => {
    const { plan, at } = byId([
      goal(1, 4500, '2026-07-01'),
      goal(2, 15090, '2027-06-30'),
      goal(3, 5499.96, '2027-01-31'),
      goal(4, 1500, '2026-12-31'),
    ], 783);

    expect(plan.neededMonthly).toBeCloseTo(6405.69, 2);
    expect(at(1).status).toBe('date-passed');
  });

  it('sends money down the list in order', () => {
    const goals = [goal(1, 1000), goal(2, 1000)];
    const first = byId(goals, 500);
    const swapped = byId([...goals].reverse(), 500);

    expect([first.at(1).monthsToFinish, first.at(2).monthsToFinish]).toEqual([2, 4]);
    expect([swapped.at(2).monthsToFinish, swapped.at(1).monthsToFinish]).toEqual([2, 4]);
  });

  it('lets a month’s leftover flow to the next goal', () => {
    const { at } = byId([goal(1, 300), goal(2, 1000)], 500);
    expect([at(1).monthsToFinish, at(2).monthsToFinish]).toEqual([1, 3]);
  });

  it('funds a paycheck line first and lets the rest flow', () => {
    const { at, plan } = byId([goal(1, 1000), goal(2, 3000)], 1000, [[2, 600]]);
    expect(at(1).monthsToFinish).toBe(3);
    expect(at(2).monthsToFinish).toBe(4);
    expect(plan.fromPaychecks).toBe(600);
  });

  it('measures on time and late against the finish month', () => {
    const { at } = byId([goal(1, 1000, '2027-01-31'), goal(2, 1000, '2027-01-31')], 500);
    expect(at(1).status).toBe('on-time');
    expect(at(2).status).toBe('late');
    expect(at(2).lateBy).toBe(2);
    expect(describePlannedGoal(at(2))).toBe('Finishes March 2027, 2 months after its date');
  });

  it('makes no judgement without saving or a plan', () => {
    const { at, plan } = byId([goal(1, 1000, '2027-06-01')], null);
    expect(plan.hasCapacity).toBe(false);
    expect(at(1).status).toBe('unknown');
  });

  it('calls a goal beyond ten years never', () => {
    expect(byId([goal(1, 1_000_000)], 100).at(1).status).toBe('never');
  });

  it('lets a funded goal’s line keep paying into the next', () => {
    const { at } = byId([goal(1, 0), goal(2, 1000)], 0, [[1, 500]]);
    expect(at(1).status).toBe('complete');
    expect(at(2).monthsToFinish).toBe(2);
  });
});

describe('byPriority', () => {
  it('orders by priority, unnumbered goals last', () => {
    const ordered = byPriority([goal(1, 1, null, 3), goal(2, 1, null, null), goal(3, 1, null, 1)]);
    expect(ordered.map(g => g.id)).toEqual([3, 1, 2]);
  });
});
