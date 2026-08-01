/**
 * Category comparisons: this period vs the previous one, and vs a per-month
 * average built only from completed months.
 *
 * Two things this module is careful about:
 *   • Averages carry the number of months behind them, so the UI can say
 *     "based on 1 earlier month" instead of presenting it as settled fact.
 *   • An increase driven by a single large transaction is flagged, so a
 *     one-off purchase isn't dressed up as a spending problem.
 */

import type { Category, Transaction } from '../../../types';
import type {
  CategoryComparison,
  CategoryDetail,
  ClassificationContext,
  MerchantSummary,
  PeriodRange,
  ResolvedPeriod,
} from '../types';
import { confidenceFor } from '../period';
import { shortMonthLabel } from '../format';
import { transactionsInRange } from './metrics';
import {
  categorySpendDelta,
  classifyTransaction,
  merchantDisplayName,
  normalizeMerchantName,
  pctChange,
} from './transactions';

/** Spend per category id within a set of transactions, refunds netted out. */
function spendByCategory(
  transactions: Transaction[],
  ctx: ClassificationContext,
): Map<number, { total: number; count: number }> {
  const out = new Map<number, { total: number; count: number }>();
  transactions.forEach(tx => {
    if (tx.category_id == null) return;
    const kind = classifyTransaction(tx, ctx);
    const delta = categorySpendDelta(tx, kind);
    if (delta === 0) return;
    const rec = out.get(tx.category_id) ?? { total: 0, count: 0 };
    rec.total += delta;
    if (kind === 'expense') rec.count += 1;
    out.set(tx.category_id, rec);
  });
  return out;
}

// Range filtering lives in `metrics.ts`; duplicating the boundary logic here
// is how two parts of a page start disagreeing about what "in the period"
// means.
const inRangeFilter = (transactions: Transaction[], range: PeriodRange) =>
  transactionsInRange(transactions, range);

export interface CategoryComparisonOptions {
  transactions: Transaction[];
  categories: Category[];
  period: ResolvedPeriod;
  /** Completed month keys to average over — see `baselineMonths()`. */
  baseline: string[];
  ctx: ClassificationContext;
}

export function calculateCategoryComparisons(
  options: CategoryComparisonOptions,
): CategoryComparison[] {
  const { transactions, categories, period, baseline, ctx } = options;

  const currentTxs = inRangeFilter(transactions, period);
  const current = spendByCategory(currentTxs, ctx);
  const previous = period.previous
    ? spendByCategory(inRangeFilter(transactions, period.previous), ctx)
    : new Map<number, { total: number; count: number }>();

  // Baseline spend, summed across the completed months we're averaging.
  const baselineSet = new Set(baseline);
  const baselineTotals = spendByCategory(
    transactions.filter(t => baselineSet.has(t.transaction_date.slice(0, 7))),
    ctx,
  );

  // The period is longer than a month for multi-month ranges, so scale the
  // monthly average up to the same footing before comparing.
  const periodMonths = Math.max(1, period.months.length);

  const totalExpenses = Array.from(current.values()).reduce((s, r) => s + Math.max(0, r.total), 0);

  // Largest single transaction per category, for the one-off purchase check.
  const largestByCategory = new Map<number, Transaction>();
  currentTxs.forEach(tx => {
    if (tx.category_id == null) return;
    if (classifyTransaction(tx, ctx) !== 'expense') return;
    const existing = largestByCategory.get(tx.category_id);
    if (!existing || Math.abs(Number(tx.amount)) > Math.abs(Number(existing.amount))) {
      largestByCategory.set(tx.category_id, tx);
    }
  });

  return categories
    .filter(c => c.type === 'expense')
    .map<CategoryComparison>(category => {
      const cur = current.get(category.id) ?? { total: 0, count: 0 };
      const prev = previous.get(category.id) ?? { total: 0, count: 0 };
      const baseTotal = baselineTotals.get(category.id)?.total ?? 0;
      const perMonthAverage = baseline.length > 0 ? baseTotal / baseline.length : 0;
      const average = perMonthAverage * periodMonths;

      const deltaVsPrevious = cur.total - prev.total;
      const deltaVsAverage = cur.total - average;
      const largest = largestByCategory.get(category.id) ?? null;

      // A rise counts as one-off when a single purchase explains most of it.
      const largestAmount = largest ? Math.abs(Number(largest.amount)) : 0;
      const drivenByOneTransaction =
        deltaVsAverage > 0 && largestAmount >= deltaVsAverage * 0.6 && cur.count <= 3;

      return {
        id: category.id,
        name: category.name,
        color: category.color,
        current: cur.total,
        previous: prev.total,
        average,
        baselineMonths: baseline.length,
        confidence: confidenceFor(baseline.length),
        deltaVsPrevious,
        deltaVsAverage,
        pctVsPrevious: pctChange(cur.total, prev.total),
        pctVsAverage: pctChange(cur.total, average),
        share: totalExpenses > 0 ? Math.max(0, cur.total) / totalExpenses : 0,
        transactionCount: cur.count,
        largestTransaction: largest,
        drivenByOneTransaction,
      };
    })
    .filter(c => c.current !== 0 || c.previous !== 0 || c.average !== 0);
}

export type CategorySort = 'change' | 'amount' | 'name';

export function sortCategories(rows: CategoryComparison[], sort: CategorySort): CategoryComparison[] {
  const copy = [...rows];
  if (sort === 'amount') return copy.sort((a, b) => b.current - a.current);
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  return copy.sort((a, b) => Math.abs(b.deltaVsAverage) - Math.abs(a.deltaVsAverage));
}

/** Categories with spend in the period, largest first — for the donut. */
export function spendingBreakdown(rows: CategoryComparison[]): CategoryComparison[] {
  return rows.filter(r => r.current > 0).sort((a, b) => b.current - a.current);
}

/** Top merchants inside a set of transactions, by total spend. */
export function topMerchants(
  transactions: Transaction[],
  ctx: ClassificationContext,
  limit = 5,
): MerchantSummary[] {
  const groups = new Map<string, { name: string; total: number; count: number; largest: number }>();
  transactions.forEach(tx => {
    const kind = classifyTransaction(tx, ctx);
    const delta = categorySpendDelta(tx, kind);
    if (delta === 0) return;
    const key = normalizeMerchantName(tx.description) || '__unlabelled__';
    const rec = groups.get(key) ?? {
      name: key === '__unlabelled__' ? 'No description' : merchantDisplayName(tx.description),
      total: 0,
      count: 0,
      largest: 0,
    };
    rec.total += delta;
    if (kind === 'expense') {
      rec.count += 1;
      rec.largest = Math.max(rec.largest, Math.abs(Number(tx.amount)));
    }
    groups.set(key, rec);
  });

  return Array.from(groups.entries())
    .map(([key, rec]) => ({
      key,
      name: rec.name,
      total: rec.total,
      count: rec.count,
      average: rec.count > 0 ? rec.total / rec.count : 0,
      largest: rec.largest,
    }))
    .filter(m => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Everything the category drawer needs. Respects the active period for the
 * headline numbers, but draws the trend from the full history so the shape of
 * the category is visible.
 */
export function buildCategoryDetail(
  comparison: CategoryComparison,
  transactions: Transaction[],
  period: ResolvedPeriod,
  ctx: ClassificationContext,
  trendMonths = 6,
): CategoryDetail {
  const periodTxs = inRangeFilter(transactions, period)
    .filter(t => t.category_id === comparison.id)
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));

  const expenseCount = periodTxs.filter(t => classifyTransaction(t, ctx) === 'expense').length;

  // Trend: the period's months plus enough earlier months for context.
  const lastMonth = period.months[period.months.length - 1];
  const monthKeys: string[] = [];
  for (let i = trendMonths - 1; i >= 0; i -= 1) {
    const [y, m] = lastMonth.split('-').map(Number);
    const d = new Date(y, m - 1 - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const byMonth = new Map<string, number>();
  monthKeys.forEach(m => byMonth.set(m, 0));
  transactions.forEach(tx => {
    if (tx.category_id !== comparison.id) return;
    const month = tx.transaction_date.slice(0, 7);
    if (!byMonth.has(month)) return;
    byMonth.set(month, (byMonth.get(month) ?? 0) + categorySpendDelta(tx, classifyTransaction(tx, ctx)));
  });

  return {
    ...comparison,
    transactions: periodTxs,
    averageTransaction: expenseCount > 0 ? comparison.current / expenseCount : 0,
    topMerchants: topMerchants(periodTxs, ctx, 5),
    monthlyTrend: monthKeys.map(month => ({
      month,
      label: shortMonthLabel(month),
      value: Math.max(0, byMonth.get(month) ?? 0),
    })),
  };
}
