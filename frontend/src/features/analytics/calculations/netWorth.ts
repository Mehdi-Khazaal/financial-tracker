/**
 * Net-worth trend analysis.
 *
 * The `contributors` list is deliberately evidence-only: each entry is a
 * number we can point at in the data (net cash flow, a specific large
 * transaction, a change in investment holdings). The UI labels them "likely
 * contributors" because a correlation in the same month is not proof of cause,
 * and nothing here attempts to close that gap.
 */

import type { Asset, MonthSnapshot, Transaction } from '../../../types';
import type {
  ClassificationContext,
  NetWorthAnalysis,
  NetWorthContributor,
  NetWorthPoint,
} from '../types';
import { shortMonthLabel } from '../format';
import { calculatePeriodMetrics } from './metrics';
import { classifyTransaction, merchantDisplayName, pctChange } from './transactions';

export const EMPTY_NET_WORTH: NetWorthAnalysis = {
  points: [],
  start: 0,
  end: 0,
  change: 0,
  pctChange: null,
  high: null,
  low: null,
  bestMonth: null,
  worstMonth: null,
  contributors: [],
};

export function calculateNetWorthChange(
  snapshots: MonthSnapshot[],
  options: {
    transactions: Transaction[];
    assets: Asset[];
    ctx: ClassificationContext;
    /** How many trailing months to chart. */
    months?: number;
  },
): NetWorthAnalysis {
  const window = options.months ?? 12;
  const trimmed = snapshots.slice(Math.max(0, snapshots.length - window));
  if (trimmed.length === 0) return EMPTY_NET_WORTH;

  const points: NetWorthPoint[] = trimmed.map((snap, index) => {
    const value = Number(snap.net_worth ?? snap.accounts ?? snap.balance ?? 0);
    const prev = index > 0
      ? Number(trimmed[index - 1].net_worth ?? trimmed[index - 1].accounts ?? trimmed[index - 1].balance ?? 0)
      : null;
    return {
      month: snap.month,
      label: shortMonthLabel(snap.month),
      value,
      change: prev == null ? null : value - prev,
      pctChange: prev == null ? null : pctChange(value, prev),
    };
  });

  const start = points[0].value;
  const end = points[points.length - 1].value;

  let high = points[0];
  let low = points[0];
  let bestMonth: NetWorthPoint | null = null;
  let worstMonth: NetWorthPoint | null = null;

  points.forEach(p => {
    if (p.value > high.value) high = p;
    if (p.value < low.value) low = p;
    if (p.change != null) {
      if (!bestMonth || (bestMonth.change ?? 0) < p.change) bestMonth = p;
      if (!worstMonth || (worstMonth.change ?? 0) > p.change) worstMonth = p;
    }
  });

  return {
    points,
    start,
    end,
    change: end - start,
    pctChange: pctChange(end, start),
    high,
    low,
    bestMonth,
    worstMonth,
    contributors: buildContributors(points, options),
  };
}

/**
 * What we can actually evidence about the most recent move. Returns an empty
 * list rather than speculating when the month has no notable activity.
 */
function buildContributors(
  points: NetWorthPoint[],
  options: { transactions: Transaction[]; assets: Asset[]; ctx: ClassificationContext },
): NetWorthContributor[] {
  const last = points[points.length - 1];
  if (!last || last.change == null) return [];

  const monthTxs = options.transactions.filter(t => t.transaction_date.slice(0, 7) === last.month);
  if (monthTxs.length === 0) return [];

  const metrics = calculatePeriodMetrics(monthTxs, options.ctx);
  const contributors: NetWorthContributor[] = [];

  contributors.push({
    label: metrics.net >= 0 ? 'Cash left over' : 'Spent more than earned',
    detail: `${shortMonthLabel(last.month)} income minus expenses`,
    value: metrics.net,
  });

  if (metrics.largestIncome) {
    const tx: Transaction = metrics.largestIncome;
    contributors.push({
      label: 'Largest deposit',
      detail: merchantDisplayName(tx.description),
      value: Number(tx.amount),
    });
  }
  if (metrics.largestExpense) {
    const tx: Transaction = metrics.largestExpense;
    contributors.push({
      label: 'Largest purchase',
      detail: merchantDisplayName(tx.description),
      value: -Math.abs(Number(tx.amount)),
    });
  }

  const cardPayments = monthTxs.filter(t => classifyTransaction(t, options.ctx) === 'card-payment');
  if (cardPayments.length > 0) {
    contributors.push({
      label: 'Credit-card payments',
      detail: `${cardPayments.length} payment${cardPayments.length === 1 ? '' : 's'} reduced card balances`,
      value: cardPayments.reduce((s, t) => s + Number(t.amount), 0),
    });
  }

  return contributors.slice(0, 4);
}
