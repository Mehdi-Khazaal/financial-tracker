/**
 * Savings-goal pace.
 *
 * The Savings tab used to be about account balances — how much money exists,
 * how much of it is earmarked. That is the Dashboard's question. This module
 * answers Portfolio's: *am I progressing, and will I get there*.
 *
 * Two figures do that work, and each has a guard that matters more than the
 * arithmetic:
 *
 *   • **Required monthly contribution** — what you would have to put aside each
 *     month to hit the target date. Needs a *future* date and a real remaining
 *     amount. Without a deadline there is nothing to be required by, and a date
 *     in the past cannot be met by any contribution.
 *
 *   • **Projected completion** — when the goal lands at your recent rate. Comes
 *     from `calculateSavingsMetrics`, the same average the Analytics savings
 *     card and the Morning Brief quote. Needs enough completed months behind it
 *     to mean anything, and a positive rate: a flat or negative history gives
 *     no date rather than an infinite one.
 *
 * "Saved" here never means "left after expenses". Money set aside is a goal
 * allocation — a label on a balance you already hold. Income minus expenses is
 * a different quantity and is not used anywhere in this file.
 */

import type { SavingsGoal } from '../../../types';
import { clamp } from '../../analytics/calculations/transactions';
import { dateKey } from '../../analytics/period';
import { describeGoal } from '../../overview/calculations/goals';
import type { GoalPresentation } from '../../overview/types';

/** Completed months required before a projected date is trustworthy. */
export const MIN_PROJECTION_MONTHS = 3;

export type GoalPace =
  /** Fully funded. */
  | 'complete'
  /** Funded beyond the target. */
  | 'overfunded'
  /** No deadline, so there is no schedule to be ahead or behind of. */
  | 'no-deadline'
  /** The target date has passed and the goal is unmet. */
  | 'date-passed'
  /** Recent rate comfortably clears the required contribution. */
  | 'ahead'
  /** Recent rate meets the required contribution. */
  | 'on-track'
  /** Recent rate falls short of the required contribution. */
  | 'behind'
  /** A deadline exists but there is no reliable rate to judge against. */
  | 'unknown';

export interface GoalProgress {
  goal: SavingsGoal;
  /** Shared status, colour and clamped progress. */
  presentation: GoalPresentation;
  /** Money labelled against this goal. */
  setAside: number;
  target: number;
  /** Still to find. Zero once funded. */
  remaining: number;
  /** Whole months until the deadline, or null without one. */
  monthsRemaining: number | null;
  /** Deadline as `YYYY-MM-DD`, or null. */
  deadline: string | null;
  /** True when the deadline is in the past. */
  deadlinePassed: boolean;
  /**
   * What must be set aside each month to hit the deadline.
   * Null when there is no future deadline or nothing left to find.
   */
  requiredMonthly: number | null;
  /**
   * Months to completion at the recent savings rate, or null when the rate is
   * unusable or the history too thin.
   */
  monthsAtCurrentRate: number | null;
  /** `March 2027`, or null on the same conditions. */
  projectedCompletion: string | null;
  /**
   * True when the projection is worth showing alongside the target date.
   *
   * A goal needing $2,222/month while saving $2,000 is genuinely behind, but
   * its projection still rounds into the target month — and "Behind schedule"
   * printed beside a projected date identical to the target reads as a
   * contradiction. When they land in the same month the projection adds
   * nothing, so the pace label carries the story alone.
   */
  projectionAddsInformation: boolean;
  pace: GoalPace;
  /** Status in words, never colour alone. */
  paceLabel: string;
  /** One sentence explaining the pace, or why none could be judged. */
  paceDetail: string;
}

const PACE_LABELS: Record<GoalPace, string> = {
  complete: 'Complete',
  overfunded: 'Overfunded',
  'no-deadline': 'No target date',
  'date-passed': 'Target date passed',
  ahead: 'Ahead of schedule',
  'on-track': 'On track',
  behind: 'Behind schedule',
  unknown: 'Not enough history',
};

/** Whole months from `today` to `deadline`, rounded up, floored at zero. */
export function monthsUntil(deadline: string, today: Date): number {
  const end = new Date(`${deadline.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(end.getTime())) return 0;
  const months = (end.getFullYear() - today.getFullYear()) * 12
    + (end.getMonth() - today.getMonth());
  // A deadline later this month still leaves part of a month to save in.
  const partial = end.getDate() >= today.getDate() ? 0 : -1;
  return Math.max(0, months + partial);
}

const monthLabelFrom = (today: Date, monthsAhead: number): string => {
  const d = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export interface GoalProgressOptions {
  today: Date;
  /**
   * Average monthly amount saved, from `calculateSavingsMetrics`. Null when
   * unavailable. Never recomputed here.
   */
  averageMonthlySaved: number | null;
  /** Completed months behind that average. */
  averageMonths: number;
  /**
   * True when the transaction history failed to load.
   *
   * Without it, a failed fetch produces zero baseline months and the card says
   * "you have 0 completed months" — a statement about the user's history when
   * it is really a statement about the request. The two must not be confused.
   */
  historyUnavailable?: boolean;
}

export function describeGoalProgress(
  goal: SavingsGoal,
  options: GoalProgressOptions,
): GoalProgress {
  const { today, averageMonthlySaved, averageMonths, historyUnavailable = false } = options;

  const presentation = describeGoal(goal, today);
  const target = Number(goal.target_amount) || 0;
  const setAside = Number(goal.current_amount) || 0;
  const remaining = Math.max(0, target - setAside);

  const deadline = goal.deadline ? goal.deadline.slice(0, 10) : null;
  const deadlinePassed = deadline != null && deadline < dateKey(today);
  const monthsRemaining = deadline != null && !deadlinePassed
    ? monthsUntil(deadline, today)
    : null;

  // Required contribution: only with a future date and something left to find.
  const requiredMonthly = remaining > 0 && monthsRemaining != null
    // A deadline inside this month means the whole remainder is due now.
    ? remaining / Math.max(1, monthsRemaining)
    : null;

  // Projection: only from a rate we are willing to stand behind.
  const rateUsable = averageMonthlySaved != null
    && averageMonthlySaved > 0
    && averageMonths >= MIN_PROJECTION_MONTHS;
  const monthsAtCurrentRate = rateUsable && remaining > 0
    ? Math.ceil(remaining / (averageMonthlySaved as number))
    : null;
  const projectedCompletion = monthsAtCurrentRate != null && monthsAtCurrentRate <= 600
    ? monthLabelFrom(today, monthsAtCurrentRate)
    : null;

  const pace: GoalPace = presentation.status === 'complete'
    ? (presentation.rawProgress > 100 ? 'overfunded' : 'complete')
    : deadlinePassed
      ? 'date-passed'
      : deadline == null
        ? 'no-deadline'
        : requiredMonthly == null || !rateUsable
          ? 'unknown'
          : (averageMonthlySaved as number) >= requiredMonthly * 1.1
            ? 'ahead'
            : (averageMonthlySaved as number) >= requiredMonthly
              ? 'on-track'
              : 'behind';

  const targetMonth = deadline != null ? deadline.slice(0, 7) : null;
  const projectedMonth = monthsAtCurrentRate != null
    ? (() => {
      const d = new Date(today.getFullYear(), today.getMonth() + monthsAtCurrentRate, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })()
    : null;

  return {
    goal,
    presentation,
    setAside,
    target,
    remaining,
    monthsRemaining,
    deadline,
    deadlinePassed,
    requiredMonthly,
    monthsAtCurrentRate,
    projectedCompletion,
    projectionAddsInformation: projectedCompletion != null
      && (targetMonth == null || projectedMonth !== targetMonth),
    pace,
    paceLabel: PACE_LABELS[pace],
    paceDetail: paceDetailFor(pace, { monthsRemaining, averageMonths, historyUnavailable }),
  };
}

function paceDetailFor(
  pace: GoalPace,
  ctx: { monthsRemaining: number | null; averageMonths: number; historyUnavailable: boolean },
): string {
  switch (pace) {
    case 'complete':
      return 'Fully funded.';
    case 'overfunded':
      return 'More has been set aside than the target.';
    case 'no-deadline':
      // Not a problem — plenty of goals have no date. Say so neutrally.
      return 'No target date set, so there is no schedule to measure against.';
    case 'date-passed':
      return 'The target date has passed. Adjusting the date keeps the goal useful.';
    case 'ahead':
      return `Your recent rate clears what this goal needs${ctx.monthsRemaining != null ? ` over the next ${ctx.monthsRemaining} months` : ''}.`;
    case 'on-track':
      return 'Your recent rate matches what this goal needs.';
    case 'behind':
      return 'Your recent rate is below what this goal needs to hit its date.';
    default:
      if (ctx.historyUnavailable) {
        return 'Your transaction history could not be loaded, so pace cannot be calculated right now.';
      }
      return ctx.averageMonths < MIN_PROJECTION_MONTHS
        ? `Pace needs ${MIN_PROJECTION_MONTHS} completed months of history. You have ${ctx.averageMonths}.`
        : 'Not enough recent saving to judge a pace.';
  }
}

/** Portfolio-wide savings picture. */
export interface SavingsSummary {
  goals: GoalProgress[];
  /** Total labelled against goals. */
  totalSetAside: number;
  /** Combined targets. */
  totalTarget: number;
  /** Combined shortfall across unfunded goals. */
  totalRemaining: number;
  /** 0–100 across all goals combined, or null with no targets. */
  overallProgress: number | null;
  completeCount: number;
  behindCount: number;
}

export function summariseGoals(
  goals: SavingsGoal[],
  options: GoalProgressOptions,
): SavingsSummary {
  const rows = goals.map(g => describeGoalProgress(g, options));

  const totalSetAside = rows.reduce((s, g) => s + g.setAside, 0);
  const totalTarget = rows.reduce((s, g) => s + g.target, 0);

  return {
    goals: rows,
    totalSetAside,
    totalTarget,
    totalRemaining: rows.reduce((s, g) => s + g.remaining, 0),
    overallProgress: totalTarget > 0 ? clamp((totalSetAside / totalTarget) * 100, 0, 100) : null,
    completeCount: rows.filter(g => g.pace === 'complete' || g.pace === 'overfunded').length,
    behindCount: rows.filter(g => g.pace === 'behind' || g.pace === 'date-passed').length,
  };
}
