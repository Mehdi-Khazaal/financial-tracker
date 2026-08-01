/**
 * The plain-English period review.
 *
 * Templated, not generated. Every clause is attached to a number computed
 * elsewhere on the page, which means the summary can never drift from the
 * charts underneath it — and it costs nothing to produce. The project already
 * has an AI assistant on its own route for open-ended questions; a summary
 * that must agree with a table is a job for arithmetic.
 *
 * Clauses are only emitted when they clear a materiality threshold, so a quiet
 * month produces two short sentences instead of five hedged ones.
 */

import type {
  CategoryComparison,
  NetWorthAnalysis,
  PeriodMetrics,
  PeriodSummaryData,
  RecurringOutlook,
  ResolvedPeriod,
  SavingsMetrics,
} from '../types';
import {
  dollars, monthLabel, percent, percentagePoints, rateTransition, signedPercent,
} from '../format';
import { pctChange } from './transactions';

const MATERIAL_DOLLARS = 25;
const MATERIAL_PCT = 0.05;

export interface SummaryContext {
  period: ResolvedPeriod;
  metrics: PeriodMetrics;
  previousMetrics: PeriodMetrics | null;
  categories: CategoryComparison[];
  savings: SavingsMetrics;
  netWorth: NetWorthAnalysis;
  recurring: RecurringOutlook;
}

const periodName = (period: ResolvedPeriod): string =>
  period.isSingleMonth ? monthLabel(period.months[0]) : period.label;

const comparisonName = (period: ResolvedPeriod): string | null => {
  if (!period.previous) return null;
  return period.previous.months.length === 1
    ? monthLabel(period.previous.months[0])
    : period.previous.label;
};

export function buildPeriodSummary(ctx: SummaryContext): PeriodSummaryData {
  const { period, metrics, previousMetrics, categories, savings, netWorth } = ctx;
  const name = periodName(period);
  const versus = comparisonName(period);
  const sentences: string[] = [];

  // Nothing to describe.
  if (metrics.transactionCount === 0) {
    return {
      headline: `No activity recorded for ${name}`,
      sentences: ['Once transactions land in this period, a written review will appear here.'],
      verdict: null,
      suggestion: null,
      hasComparison: false,
    };
  }

  const hasComparison = !!previousMetrics && (previousMetrics.income > 0 || previousMetrics.expenses > 0);
  const expenseChange = previousMetrics ? pctChange(metrics.expenses, previousMetrics.expenses) : null;
  const incomeChange = previousMetrics ? pctChange(metrics.income, previousMetrics.income) : null;

  // ── Verdict ─────────────────────────────────────────────────────────────────
  let verdict: PeriodSummaryData['verdict'] = null;
  if (hasComparison && previousMetrics) {
    const netDelta = metrics.net - previousMetrics.net;
    const scale = Math.max(Math.abs(previousMetrics.net), metrics.income, MATERIAL_DOLLARS * 4);
    if (netDelta > scale * 0.1) verdict = 'stronger';
    else if (netDelta < -scale * 0.1) verdict = 'weaker';
    else verdict = 'steady';
  }

  // "May – Jul 2026 was a strong month" would be wrong, so the noun follows
  // the shape of the range.
  const unit = period.isSingleMonth ? 'month' : 'period';
  const headline = verdict === 'stronger'
    ? `${name} was a strong ${unit}.`
    : verdict === 'weaker'
      ? `${name} was a tighter ${unit} than usual.`
      : verdict === 'steady'
        ? `${name} tracked close to ${versus}.`
        : `Here is how ${name} looked.`;

  // ── Income and expense movement ─────────────────────────────────────────────
  if (hasComparison && previousMetrics && versus) {
    const parts: string[] = [];
    if (expenseChange != null && Math.abs(expenseChange) >= MATERIAL_PCT
      && Math.abs(metrics.expenses - previousMetrics.expenses) >= MATERIAL_DOLLARS) {
      parts.push(
        `spending ${expenseChange < 0 ? 'fell' : 'rose'} ${percent(Math.abs(expenseChange), 1)} to ${dollars(metrics.expenses)}`,
      );
    }
    if (incomeChange != null && Math.abs(incomeChange) >= MATERIAL_PCT
      && Math.abs(metrics.income - previousMetrics.income) >= MATERIAL_DOLLARS) {
      parts.push(
        `income ${incomeChange < 0 ? 'fell' : 'rose'} ${percent(Math.abs(incomeChange), 1)} to ${dollars(metrics.income)}`,
      );
    }
    if (parts.length > 0) {
      sentences.push(`Compared with ${versus}, ${parts.join(' and ')}.`);
    } else {
      sentences.push(`Income and spending both held close to ${versus}.`);
    }
  } else {
    sentences.push(
      `You brought in ${dollars(metrics.income)} and spent ${dollars(metrics.expenses)}.`,
    );
  }

  // ── What moved the most, and why, when a single category explains it ────────
  const movers = [...categories]
    .filter(c => Math.abs(c.deltaVsPrevious) >= MATERIAL_DOLLARS)
    .sort((a, b) => Math.abs(b.deltaVsPrevious) - Math.abs(a.deltaVsPrevious));
  const topDrop = movers.filter(c => c.deltaVsPrevious < 0)[0];
  const topRise = movers.filter(c => c.deltaVsPrevious > 0)[0];

  if (topDrop && Math.abs(topDrop.deltaVsPrevious) >= Math.abs(topRise?.deltaVsPrevious ?? 0)) {
    const tail = topDrop.average > 0 && topDrop.current <= topDrop.average * 1.1
      ? ' — back around its usual level'
      : '';
    sentences.push(
      `The biggest single change was ${topDrop.name}, down ${dollars(Math.abs(topDrop.deltaVsPrevious))}${tail}.`,
    );
  } else if (topRise) {
    const oneOff = topRise.drivenByOneTransaction ? ', almost all of it a single purchase' : '';
    sentences.push(
      `The biggest single change was ${topRise.name}, up ${dollars(topRise.deltaVsPrevious)}${oneOff}.`,
    );
  }

  // ── Savings ─────────────────────────────────────────────────────────────────
  if (metrics.savingsRate != null) {
    const left = `leaving ${dollars(metrics.net)} after expenses`;
    // A rate change is reported in percentage points, never as a percentage of
    // itself — 27.2% to 79.1% is a 51.9-point rise, not a 191% one.
    if (savings.rateDelta != null && savings.previousRate != null && Math.abs(savings.rateDelta) >= 0.03) {
      sentences.push(
        `Your savings rate was ${percent(metrics.savingsRate)}, ${savings.rateDelta > 0 ? 'up' : 'down'} `
        + `${percentagePoints(Math.abs(savings.rateDelta), 1)} compared with ${versus} `
        + `(${rateTransition(savings.previousRate, metrics.savingsRate)}), ${left}.`,
      );
    } else {
      sentences.push(`Your savings rate was ${percent(metrics.savingsRate)}, ${left}.`);
    }
  } else if (metrics.expenses > 0) {
    sentences.push('No income was recorded in this period, so a savings rate cannot be calculated.');
  }

  // ── Net worth ───────────────────────────────────────────────────────────────
  if (netWorth.points.length >= 2 && Math.abs(netWorth.change) >= MATERIAL_DOLLARS) {
    sentences.push(
      `Net worth is ${netWorth.change >= 0 ? 'up' : 'down'} ${dollars(Math.abs(netWorth.change))} across the charted window${netWorth.pctChange != null ? ` (${signedPercent(netWorth.pctChange)})` : ''}.`,
    );
  }

  // ── One suggested action ────────────────────────────────────────────────────
  const suggestion = buildSuggestion(ctx, topRise);

  return {
    headline,
    sentences: sentences.slice(0, 4),
    verdict,
    suggestion,
    hasComparison,
  };
}

function buildSuggestion(
  ctx: SummaryContext,
  topRise: CategoryComparison | undefined,
): string | null {
  const { metrics, savings, recurring } = ctx;

  if (metrics.uncategorizedCount >= 3) {
    return `Filing the ${metrics.uncategorizedCount} uncategorized transactions would sharpen every comparison on this page.`;
  }
  if (recurring.subscriptions.increased.length > 0) {
    const top = recurring.subscriptions.increased[0];
    return `Worth reviewing ${top.name} — its charge went up by ${dollars(top.delta)}.`;
  }
  if (topRise && !topRise.drivenByOneTransaction && topRise.baselineMonths >= 3) {
    return `If you want one thing to watch next period, ${topRise.name} is the category that moved most.`;
  }
  if (savings.primaryGoal && savings.saved > 0) {
    return `You could move some of the ${dollars(savings.saved)} you kept toward ${savings.primaryGoal.name}, which needs ${dollars(savings.primaryGoal.remaining)} more.`;
  }
  if (savings.goalCount === 0 && savings.saved > 0) {
    return `You saved ${dollars(savings.saved)} without a goal attached — setting one makes the progress visible.`;
  }
  return null;
}
