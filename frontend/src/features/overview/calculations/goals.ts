/**
 * Savings-goal status.
 *
 * A finished goal used to render a red progress bar, because the shared
 * `ProgressBar` coloured itself on the credit-utilisation scale: green below
 * 30%, red above 70%. That scale is right for "how much of your credit limit
 * have you used" and exactly backwards for "how much of your goal have you
 * reached". Goals get their own scale here, where more is better.
 *
 * Red is reserved for something genuinely wrong — a deadline that has passed
 * with the goal unmet — never for success.
 */

import type { SavingsGoal } from '../../../types';
import { clamp } from '../../analytics/calculations/transactions';
import { dateKey } from '../../analytics/period';
import type { GoalPresentation, GoalStatus } from '../types';

const STATUS_LABELS: Record<GoalStatus, string> = {
  complete: 'Complete',
  'in-progress': 'In progress',
  'not-started': 'Not started',
  overdue: 'Past deadline',
  invalid: 'No target set',
};

const STATUS_COLORS: Record<GoalStatus, string> = {
  complete: 'var(--pos)',
  'in-progress': 'var(--accent)',
  // Subdued rather than alarming: not having started is not a failure.
  'not-started': 'var(--dim)',
  overdue: 'var(--neg)',
  invalid: 'var(--dim)',
};

export function describeGoal(goal: SavingsGoal, today: Date): GoalPresentation {
  const target = Number(goal.target_amount) || 0;
  const current = Number(goal.current_amount) || 0;

  // A goal with no positive target cannot have a percentage. The old code
  // divided by it anyway and rendered NaN%.
  if (target <= 0) {
    return {
      progress: 0,
      rawProgress: 0,
      status: 'invalid',
      statusLabel: STATUS_LABELS.invalid,
      color: STATUS_COLORS.invalid,
    };
  }

  const rawProgress = (current / target) * 100;
  const progress = clamp(rawProgress, 0, 100);

  const status: GoalStatus = rawProgress >= 100
    ? 'complete'
    : goal.deadline != null && goal.deadline.slice(0, 10) < dateKey(today)
      ? 'overdue'
      : current <= 0
        ? 'not-started'
        : 'in-progress';

  return {
    progress,
    rawProgress,
    status,
    statusLabel: STATUS_LABELS[status],
    color: STATUS_COLORS[status],
  };
}

/** True when the goal holds more than its target. */
export const isOverfunded = (presentation: GoalPresentation): boolean =>
  presentation.rawProgress > 100;
