/**
 * Cash flow — adapts to the selected range.
 *
 * One month gets a waterfall (income → fixed costs → variable spending → what
 * was left), which explains *where* the money went. Multiple months get an
 * income-vs-expense trend, which explains *how it's moving*. The old chart
 * showed two bars for a single month and answered neither question.
 *
 * "Fixed" means matched to a declared recurring transaction. If the user has
 * declared none, the split is suppressed rather than guessed at, and the
 * waterfall falls back to a single "spending" step.
 */

import type { RecurringTransaction, Transaction } from '../../../types';
import type {
  CashFlowData,
  CashFlowSeriesPoint,
  CashFlowStep,
  ClassificationContext,
  ResolvedPeriod,
} from '../types';
import { monthTick } from '../format';
import { calculatePeriodMetrics, monthlyMetrics, transactionsInRange } from './metrics';
import { categorySpendDelta, classifyTransaction, normalizeMerchantName } from './transactions';

/** Normalised descriptions of active recurring expenses — the "fixed" set. */
export function fixedCostKeys(recurring: RecurringTransaction[]): Set<string> {
  const keys = new Set<string>();
  recurring.forEach(r => {
    if (!r.is_active) return;
    if (Number(r.amount) >= 0) return;
    const key = normalizeMerchantName(r.description);
    if (key) keys.add(key);
  });
  return keys;
}

export function buildCashFlow(options: {
  transactions: Transaction[];
  recurring: RecurringTransaction[];
  period: ResolvedPeriod;
  ctx: ClassificationContext;
}): CashFlowData {
  const { transactions, recurring, period, ctx } = options;

  const periodTxs = transactionsInRange(transactions, period);
  const metrics = calculatePeriodMetrics(periodTxs, ctx);
  const keys = fixedCostKeys(recurring);
  const hasFixedBreakdown = keys.size > 0;

  let fixed = 0;
  periodTxs.forEach(tx => {
    const kind = classifyTransaction(tx, ctx);
    const delta = categorySpendDelta(tx, kind);
    if (delta === 0) return;
    const key = normalizeMerchantName(tx.description);
    if (key && keys.has(key)) fixed += delta;
  });
  fixed = Math.max(0, Math.min(fixed, metrics.expenses));
  const variable = Math.max(0, metrics.expenses - fixed);
  const remaining = metrics.net;

  const series: CashFlowSeriesPoint[] = monthlyMetrics(transactions, period.months, ctx).map(m => ({
    month: m.month,
    label: monthTick(m.month),
    Income: m.metrics.income,
    Expenses: m.metrics.expenses,
    net: m.metrics.net,
  }));

  // Waterfall bases: each cost step hangs from where the previous one ended.
  const steps: CashFlowStep[] = [];
  steps.push({
    key: 'income',
    label: 'Income',
    value: metrics.income,
    base: 0,
    kind: 'income',
    color: 'var(--pos)',
    hint: 'Money received, excluding transfers between your own accounts and credit-card payments.',
  });

  let cursor = metrics.income;
  if (hasFixedBreakdown) {
    cursor -= fixed;
    steps.push({
      key: 'fixed',
      label: 'Recurring',
      value: -fixed,
      base: cursor,
      kind: 'cost',
      color: '#f59e0b',
      hint: 'Spending matched to a bill or subscription you have set up as recurring.',
    });
    cursor -= variable;
    steps.push({
      key: 'variable',
      label: 'Everything else',
      value: -variable,
      base: cursor,
      kind: 'cost',
      color: 'var(--neg)',
      hint: 'Spending that is not matched to a recurring bill.',
    });
  } else {
    cursor -= metrics.expenses;
    steps.push({
      key: 'spending',
      label: 'Spending',
      value: -metrics.expenses,
      base: cursor,
      kind: 'cost',
      color: 'var(--neg)',
      hint: 'All spending in the period, with refunds already subtracted.',
    });
  }

  steps.push({
    key: 'remaining',
    label: remaining >= 0 ? 'Left over' : 'Shortfall',
    value: remaining,
    // A shortfall bar hangs below the axis, from the deficit up to zero.
    base: Math.min(0, remaining),
    kind: 'result',
    color: remaining >= 0 ? 'var(--accent)' : 'var(--neg)',
    hint: 'Income minus spending. This is what the savings rate is calculated from.',
  });

  return {
    mode: period.isSingleMonth ? 'waterfall' : 'series',
    steps,
    series,
    income: metrics.income,
    fixed,
    variable,
    remaining,
    hasFixedBreakdown,
  };
}
