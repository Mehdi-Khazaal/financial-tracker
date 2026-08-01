/**
 * Savings metrics.
 *
 * Fintrack has two distinct ideas that both get called "savings", and mixing
 * them is how dashboards start contradicting each other:
 *
 *   1. **Saved this period** — `income − expenses`. A flow. This is what the
 *      app has always meant by "savings rate" (see the dashboard hero), so it
 *      is what this module reports as `saved`.
 *
 *   2. **Allocated to goals** — the sum of `SavingsGoalAllocation` rows. A
 *      labelling of balances you already hold, not money that moved this
 *      month. Reported separately as `allocatedTotal`.
 *
 * They are never added together.
 */

import type { SavingsGoal, Transaction } from '../../../types';
import type {
  ClassificationContext,
  PrimaryGoal,
  ResolvedPeriod,
  SavingsMetrics,
} from '../types';
import { calculatePeriodMetrics, monthlyMetrics, transactionsInRange } from './metrics';
import { monthLabel } from '../format';
import { clamp } from './transactions';

export const SAVINGS_DEFINITION =
  'Left over = income − expenses for the selected period. Transfers between your own accounts and credit-card payments are excluded, and refunds reduce the category they came from. This measures what your income did not get spent — it does not mean money moved into a savings account. Amounts set aside against goals are shown separately, because those label balances you already hold.';

/**
 * Pick the goal to feature on Analytics.
 *
 * There is no `is_primary` column on `SavingsGoal`, so the rule is: the goal
 * with the nearest upcoming deadline wins; if no goal has a deadline, the one
 * furthest along wins. Completed goals are skipped so the card stays useful.
 */
export function selectPrimaryGoal(
  goals: SavingsGoal[],
  averageMonthlySaved: number | null,
  today: Date,
): PrimaryGoal | null {
  if (goals.length === 0) return null;

  const withProgress = goals.map(goal => {
    const target = Number(goal.target_amount) || 0;
    const current = Number(goal.current_amount) || 0;
    return {
      goal,
      target,
      current,
      progress: target > 0 ? clamp((current / target) * 100, 0, 100) : 0,
    };
  });

  const unfinished = withProgress.filter(g => g.progress < 100);
  const pool = unfinished.length > 0 ? unfinished : withProgress;

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dated = pool
    .filter(g => !!g.goal.deadline && g.goal.deadline >= todayKey)
    .sort((a, b) => (a.goal.deadline ?? '').localeCompare(b.goal.deadline ?? ''));

  const chosen = dated[0] ?? [...pool].sort((a, b) => b.progress - a.progress)[0];
  if (!chosen) return null;

  const remaining = Math.max(0, chosen.target - chosen.current);

  // Only project a completion date when there's a real, positive savings rate
  // behind it. Projecting from a single month would be noise dressed as a date.
  let projectedCompletion: string | null = null;
  let monthsToCompletion: number | null = null;
  if (remaining > 0 && averageMonthlySaved != null && averageMonthlySaved > 0) {
    const months = Math.ceil(remaining / averageMonthlySaved);
    if (months <= 600) {
      monthsToCompletion = months;
      const d = new Date(today.getFullYear(), today.getMonth() + months, 1);
      projectedCompletion = monthLabel(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      );
    }
  }

  return {
    id: chosen.goal.id,
    name: chosen.goal.name,
    target: chosen.target,
    current: chosen.current,
    progress: chosen.progress,
    remaining,
    deadline: chosen.goal.deadline,
    projectedCompletion,
    monthsToCompletion,
    basis: dated[0] ? 'deadline' : 'progress',
  };
}

export interface SavingsOptions {
  transactions: Transaction[];
  goals: SavingsGoal[];
  period: ResolvedPeriod;
  /** Completed months used for the monthly average. */
  baseline: string[];
  ctx: ClassificationContext;
  today: Date;
}

export function calculateSavingsMetrics(options: SavingsOptions): SavingsMetrics {
  const { transactions, goals, period, baseline, ctx, today } = options;

  const currentMetrics = calculatePeriodMetrics(transactionsInRange(transactions, period), ctx);
  const previousMetrics = period.previous
    ? calculatePeriodMetrics(transactionsInRange(transactions, period.previous), ctx)
    : null;

  // Average monthly saved across completed months only — the month in progress
  // would otherwise drag the average toward zero.
  const perMonth = monthlyMetrics(transactions, baseline, ctx);
  const averageMonthlySaved = perMonth.length > 0
    ? perMonth.reduce((s, m) => s + m.metrics.net, 0) / perMonth.length
    : null;

  const allocatedTotal = goals.reduce((s, g) => s + (Number(g.current_amount) || 0), 0);

  return {
    saved: currentMetrics.net,
    savingsRate: currentMetrics.savingsRate,
    previousSaved: previousMetrics ? previousMetrics.net : null,
    previousRate: previousMetrics ? previousMetrics.savingsRate : null,
    savedDelta: previousMetrics ? currentMetrics.net - previousMetrics.net : null,
    rateDelta:
      previousMetrics && previousMetrics.savingsRate != null && currentMetrics.savingsRate != null
        ? currentMetrics.savingsRate - previousMetrics.savingsRate
        : null,
    averageMonthlySaved,
    averageMonths: perMonth.length,
    allocatedTotal,
    goalCount: goals.length,
    primaryGoal: selectPrimaryGoal(goals, averageMonthlySaved, today),
  };
}
