/**
 * When each goal is really reached, funding goals in priority order.
 *
 * Mirrors `backend/services/goal_plan.py`.
 *
 * Every goal used to be projected as though it alone received everything kept
 * each month, so four goals could all "finish" on the same money. Here money
 * is spent once:
 *
 *   • A goal with a paycheck-plan line gets that line every month.
 *   • Typical monthly saving beyond the lines goes to the highest-priority
 *     unfinished goal, and whatever it does not need flows to the next.
 *   • A line keeps paying after its goal is funded; that money flows on too.
 *
 * The result is one finish month per goal, which is what can honestly be
 * compared with its date. The goal cards read their projection from here, so
 * the page never shows two different finish dates for one goal.
 */

import type { SavingsGoal } from '../../../types';
import { monthsUntil } from './goals';
import { dateKey } from '../../analytics/period';

export const PLAN_HORIZON_MONTHS = 120;

export type PlanStatus =
  | 'complete' | 'on-time' | 'late' | 'date-passed' | 'no-deadline' | 'never' | 'unknown';

export interface PlannedGoal {
  goal: SavingsGoal;
  remaining: number;
  /** Months from now until funded: 0 when it already is, null beyond the horizon. */
  monthsToFinish: number | null;
  /** `March 2027`, or null. */
  finishLabel: string | null;
  /** Months to a future deadline, or null. */
  monthsToDeadline: number | null;
  /** Monthly amount to finish by its date, or null without a future date. */
  neededMonthly: number | null;
  /** What the plan gives it each month from the paycheck plan. */
  fromPaychecks: number;
  status: PlanStatus;
  /** Months after its date, when late. */
  lateBy: number | null;
}

export interface GoalPlan {
  goals: PlannedGoal[];
  /** Sum of what goals with a future date need each month to finish on time. */
  neededMonthly: number;
  /** Typical monthly saving, or null when there is too little history. */
  monthlySaving: number | null;
  /** Monthly total of the paycheck-plan lines. */
  fromPaychecks: number;
  /** False when there is neither saving nor a paycheck plan to fund anything. */
  hasCapacity: boolean;
}

export interface GoalPlanInput {
  /** In priority order: first funded first. */
  goals: SavingsGoal[];
  monthlySaving: number | null;
  /** Monthly amount per goal id from the paycheck plan. */
  fromPaychecks?: ReadonlyMap<number, number>;
  today: Date;
}

const monthLabel = (today: Date, months: number) =>
  new Date(today.getFullYear(), today.getMonth() + months, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** Goals in the order they are funded: by priority, then as created. */
export function byPriority(goals: SavingsGoal[]): SavingsGoal[] {
  return [...goals].sort((a, b) => {
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || a.id - b.id;
  });
}

export function planGoals({ goals, monthlySaving, fromPaychecks = new Map(), today }: GoalPlanInput): GoalPlan {
  const todayKey = dateKey(today);
  const remaining = new Map<number, number>();
  const lines = new Map<number, number>();
  goals.forEach(g => {
    remaining.set(g.id, Math.max(0, (Number(g.target_amount) || 0) - (Number(g.current_amount) || 0)));
    lines.set(g.id, Math.max(0, fromPaychecks.get(g.id) ?? 0));
  });
  const linesTotal = Array.from(lines.values()).reduce((s, v) => s + v, 0);
  const flow = Math.max(0, (monthlySaving ?? 0) - linesTotal);
  const hasCapacity = flow > 0 || linesTotal > 0;

  const left = new Map(remaining);
  const finish = new Map<number, number | null>();
  goals.forEach(g => finish.set(g.id, left.get(g.id) === 0 ? 0 : null));

  if (hasCapacity) {
    for (let month = 1; month <= PLAN_HORIZON_MONTHS; month++) {
      let pool = flow;
      goals.forEach(g => {
        const line = lines.get(g.id) ?? 0;
        if (line <= 0) return;
        const paid = Math.min(line, left.get(g.id) ?? 0);
        left.set(g.id, (left.get(g.id) ?? 0) - paid);
        pool += line - paid;
      });
      for (const g of goals) {
        if (pool <= 0) break;
        const need = left.get(g.id) ?? 0;
        if (need > 0) {
          const paid = Math.min(pool, need);
          left.set(g.id, need - paid);
          pool -= paid;
        }
      }
      goals.forEach(g => {
        // A cent of floating-point dust is not a month of saving.
        if (finish.get(g.id) == null && (left.get(g.id) ?? 0) <= 0.005) finish.set(g.id, month);
      });
      if (goals.every(g => finish.get(g.id) != null)) break;
    }
  }

  const planned: PlannedGoal[] = goals.map(goal => {
    const rem = remaining.get(goal.id) ?? 0;
    const deadline = goal.deadline ? goal.deadline.slice(0, 10) : null;
    const passed = deadline != null && deadline < todayKey;
    const toDeadline = deadline != null && !passed ? monthsUntil(deadline, today) : null;
    const neededMonthly = toDeadline != null && rem > 0 ? rem / Math.max(1, toDeadline) : null;
    const months = finish.get(goal.id) ?? null;
    let status: PlanStatus;
    if (rem <= 0) status = 'complete';
    else if (passed) status = 'date-passed';
    else if (!hasCapacity) status = 'unknown';
    else if (months == null) status = 'never';
    else if (deadline == null) status = 'no-deadline';
    else if (months <= Math.max(1, toDeadline ?? 0)) status = 'on-time';
    else status = 'late';
    return {
      goal,
      remaining: rem,
      monthsToFinish: months,
      finishLabel: months != null && months > 0 ? monthLabel(today, months) : null,
      monthsToDeadline: toDeadline,
      neededMonthly,
      fromPaychecks: lines.get(goal.id) ?? 0,
      status,
      lateBy: status === 'late' && months != null && toDeadline != null ? months - toDeadline : null,
    };
  });

  return {
    goals: planned,
    neededMonthly: planned.reduce((s, p) => s + (p.neededMonthly ?? 0), 0),
    monthlySaving,
    fromPaychecks: linesTotal,
    hasCapacity,
  };
}

/** One line on where a goal lands in the plan. */
export function describePlannedGoal(p: PlannedGoal): string {
  switch (p.status) {
    case 'complete':
      return 'Fully funded';
    case 'on-time':
      return `Finishes ${p.finishLabel}, in time`;
    case 'late':
      return `Finishes ${p.finishLabel}, ${p.lateBy} ${p.lateBy === 1 ? 'month' : 'months'} after its date`;
    case 'date-passed':
      return p.finishLabel ? `Its date has passed · finishes ${p.finishLabel}` : 'Its date has passed';
    case 'no-deadline':
      return `Finishes ${p.finishLabel}`;
    case 'never':
      return 'Not within ten years at this rate';
    default:
      return 'Waiting for money left over each month';
  }
}
