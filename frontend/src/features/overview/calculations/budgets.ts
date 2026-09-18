import type { BudgetProgress, BudgetProgressSummary } from '../../../types';

/**
 * How a budget reads on screen.
 *
 * Spending against an allowance is *utilisation*: more is worse. But the
 * credit-card utilisation scale (amber at 30 %) is wrong here — a third of a
 * budget gone by the tenth of the month is fine. So the colour changes only
 * where a decision changes: ember while there is room, amber when it is
 * nearly gone, red once it is over. Each state also has a word, so the bar's
 * colour is never the only signal.
 */
export type BudgetTone = 'room' | 'tight' | 'over';

export interface BudgetView {
  id: number;
  categoryId: number;
  name: string;
  spent: number;
  available: number;
  remaining: number;
  /** 0–100 for the bar; can exceed 100 in `rawPercent`. */
  percent: number;
  rawPercent: number;
  tone: BudgetTone;
  statusLabel: string;
  color: string;
  rollover: boolean;
  carried: number;
}

const TIGHT_AT = 90;

export function describeBudget(item: BudgetProgress): BudgetView {
  const spent = Number(item.spent) || 0;
  const available = Number(item.available) || 0;
  const remaining = Number(item.remaining) || 0;
  const rawPercent = available > 0 ? (spent / available) * 100 : spent > 0 ? 100 : 0;
  const tone: BudgetTone = item.over || rawPercent > 100 ? 'over' : rawPercent >= TIGHT_AT ? 'tight' : 'room';
  const color = tone === 'over' ? 'var(--neg)' : tone === 'tight' ? '#f59e0b' : 'var(--accent)';
  const statusLabel = tone === 'over'
    ? `${money(spent - available)} over`
    : tone === 'tight'
      ? `${money(remaining)} left`
      : `${money(remaining)} left`;
  return {
    id: item.id,
    categoryId: item.category_id,
    name: item.category_name,
    spent,
    available,
    remaining,
    percent: Math.min(100, Math.max(0, rawPercent)),
    rawPercent,
    tone,
    statusLabel,
    color,
    rollover: item.rollover,
    carried: Number(item.carried) || 0,
  };
}

export interface BudgetsOverview {
  items: BudgetView[];
  budgeted: number;
  spent: number;
  remaining: number;
  overCount: number;
  /** Fraction of the month elapsed, for the pace line. */
  monthElapsed: number;
  /** Total spending pace: ahead of the calendar means trouble. */
  paceLabel: string;
}

export function summarizeBudgets(summary: BudgetProgressSummary | null | undefined, today: Date): BudgetsOverview {
  const items = (summary?.budgets ?? []).map(describeBudget)
    // Worst first: the ones over, then the tightest, then by share spent.
    .sort((a, b) => toneRank(b.tone) - toneRank(a.tone) || b.rawPercent - a.rawPercent);
  const budgeted = Number(summary?.budgeted) || 0;
  const spent = Number(summary?.spent) || 0;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthElapsed = Math.min(1, Math.max(0, today.getDate() / daysInMonth));
  const spentShare = budgeted > 0 ? spent / budgeted : 0;
  let paceLabel = 'No budgets yet';
  if (budgeted > 0) {
    if (spentShare > 1) paceLabel = 'Over for the month';
    else if (spentShare > monthElapsed + 0.1) paceLabel = 'Spending ahead of the month';
    else if (spentShare < monthElapsed - 0.1) paceLabel = 'Under pace';
    else paceLabel = 'On pace';
  }
  return {
    items,
    budgeted,
    spent,
    remaining: Number(summary?.remaining) || 0,
    overCount: summary?.over_count ?? 0,
    monthElapsed,
    paceLabel,
  };
}

function toneRank(tone: BudgetTone): number {
  return tone === 'over' ? 2 : tone === 'tight' ? 1 : 0;
}

function money(value: number): string {
  const abs = Math.abs(value);
  return `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
