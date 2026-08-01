/**
 * Deterministic insights — the "what should I do next" half of the page.
 *
 * Every insight is derived from a number already on screen, so nothing here
 * needs an AI call to justify itself. Three rules keep the output from turning
 * into generic advice:
 *
 *   1. Thresholds are absolute *and* relative, so a $3 rise on a $4 baseline
 *      never becomes a "75% increase" headline.
 *   2. Claims about averages require enough completed months behind them.
 *   3. A jump caused by one large purchase is described as exactly that, in
 *      neutral language — buying a motorcycle is not a spending problem.
 *
 * Candidates are scored, sorted, and cut to three.
 */

import type {
  CategoryComparison,
  Insight,
  NetWorthAnalysis,
  PeriodMetrics,
  RecurringOutlook,
  ResolvedPeriod,
  SavingsMetrics,
} from '../types';
import { dollars, percent, plural, signedPercent, verbFor } from '../format';
import { merchantDisplayName } from './transactions';

export interface InsightContext {
  period: ResolvedPeriod;
  metrics: PeriodMetrics;
  previousMetrics: PeriodMetrics | null;
  categories: CategoryComparison[];
  savings: SavingsMetrics;
  recurring: RecurringOutlook;
  netWorth: NetWorthAnalysis;
}

/** Money movements below this are noise, whatever the percentage says. */
const MATERIAL_DOLLARS = 25;

export function generateDeterministicInsights(ctx: InsightContext): Insight[] {
  const candidates: Insight[] = [];
  const { metrics, categories, savings, recurring, netWorth, period } = ctx;
  const periodWord = period.isSingleMonth ? 'this month' : 'in this period';

  // ── Subscription price rises ────────────────────────────────────────────────
  const topIncrease = recurring.subscriptions.increased[0];
  if (topIncrease && topIncrease.delta >= 1) {
    candidates.push({
      id: 'subscription-increase',
      title: `${topIncrease.name} went up by ${dollars(topIncrease.delta)}`,
      body: `It last charged ${dollars(topIncrease.from)} and now charges ${dollars(topIncrease.to)}. Worth checking the plan is still the one you want.`,
      tone: 'warning',
      score: 80 + Math.min(20, topIncrease.delta),
      action: { label: 'Review recurring charges', to: '/transactions', tab: 'recurring' },
    });
  }

  // ── Categories running well above their own average ─────────────────────────
  const trustworthy = categories.filter(c => c.baselineMonths >= 3 && c.average > 0);
  const aboveAverage = [...trustworthy]
    .filter(c => c.deltaVsAverage >= MATERIAL_DOLLARS && (c.pctVsAverage ?? 0) >= 0.4)
    .sort((a, b) => b.deltaVsAverage - a.deltaVsAverage)[0];

  if (aboveAverage) {
    const pct = signedPercent(aboveAverage.pctVsAverage ?? 0);
    if (aboveAverage.drivenByOneTransaction && aboveAverage.largestTransaction) {
      // Neutral framing: a single purchase is an event, not a habit.
      candidates.push({
        id: `one-off-${aboveAverage.id}`,
        title: `${aboveAverage.name} was ${pct} above average`,
        body: `Almost all of it was one purchase — ${merchantDisplayName(aboveAverage.largestTransaction.description)} at ${dollars(Math.abs(Number(aboveAverage.largestTransaction.amount)))}. If that was a one-off, the rest of the category looks normal.`,
        tone: 'info',
        score: 62,
        action: { label: `View ${aboveAverage.name}`, categoryId: aboveAverage.id },
      });
    } else {
      candidates.push({
        id: `above-average-${aboveAverage.id}`,
        title: `${aboveAverage.name} is ${pct} above your usual`,
        body: `You spent ${dollars(aboveAverage.current)} against an average of ${dollars(aboveAverage.average)} across ${plural(aboveAverage.baselineMonths, 'month')}. Spread over ${plural(aboveAverage.transactionCount, 'transaction')}.`,
        tone: 'warning',
        score: 75 + Math.min(15, aboveAverage.deltaVsAverage / 50),
        action: { label: `View ${aboveAverage.name}`, categoryId: aboveAverage.id },
      });
    }
  }

  // ── Savings rate vs the recent norm ─────────────────────────────────────────
  if (savings.savingsRate != null && savings.averageMonthlySaved != null && savings.averageMonths >= 3) {
    const avgRateProxy = savings.averageMonthlySaved;
    if (savings.saved > avgRateProxy * 1.2 && savings.saved - avgRateProxy >= MATERIAL_DOLLARS) {
      candidates.push({
        id: 'savings-above',
        title: `You kept more than usual ${periodWord}`,
        body: `${dollars(savings.saved)} left after expenses at a ${percent(savings.savingsRate)} savings rate, against a typical ${dollars(avgRateProxy)} a month. A good moment to move some of it into a savings goal.`,
        tone: 'positive',
        score: 70,
        action: { label: 'View savings', to: '/portfolio', tab: 'savings' },
      });
    } else if (savings.saved < avgRateProxy * 0.5 && avgRateProxy - savings.saved >= MATERIAL_DOLLARS) {
      candidates.push({
        id: 'savings-below',
        title: 'Less left over than your recent pace',
        body: `${dollars(savings.saved)} left after expenses ${periodWord}, against a typical ${dollars(avgRateProxy)} a month. Income and spending both feed this — the cash-flow breakdown above shows which moved.`,
        tone: 'warning',
        score: 74,
      });
    }
  }

  // ── Spending concentration ──────────────────────────────────────────────────
  const biggest = [...categories].sort((a, b) => b.current - a.current)[0];
  if (biggest && biggest.share >= 0.28 && metrics.expenses >= MATERIAL_DOLLARS * 4) {
    candidates.push({
      id: `concentration-${biggest.id}`,
      title: `${biggest.name} is ${percent(biggest.share, 0)} of your spending`,
      body: `${dollars(biggest.current)} of ${dollars(metrics.expenses)} went to one category. That is fine if it is intentional — it just means this category drives your total.`,
      tone: 'info',
      score: 55,
      action: { label: `View ${biggest.name}`, categoryId: biggest.id },
    });
  }

  // ── Unfiled transactions distort everything above ───────────────────────────
  if (metrics.uncategorizedCount >= 3 && metrics.uncategorizedSpend >= MATERIAL_DOLLARS) {
    candidates.push({
      id: 'uncategorized',
      title: `${plural(metrics.uncategorizedCount, 'transaction')} still need a category`,
      body: `${dollars(metrics.uncategorizedSpend)} is not counted in any category breakdown on this page. Filing them makes every comparison here more accurate.`,
      tone: 'action',
      score: 68 + Math.min(15, metrics.uncategorizedCount),
      action: { label: 'Categorize now', to: '/transactions' },
    });
  }

  // ── A category that genuinely came down ─────────────────────────────────────
  const improved = [...trustworthy]
    .filter(c => c.deltaVsAverage <= -MATERIAL_DOLLARS && (c.pctVsAverage ?? 0) <= -0.25)
    .sort((a, b) => a.deltaVsAverage - b.deltaVsAverage)[0];
  if (improved) {
    candidates.push({
      id: `improved-${improved.id}`,
      title: `${improved.name} came down by ${dollars(Math.abs(improved.deltaVsAverage))}`,
      body: `Spending there was ${percent(Math.abs(improved.pctVsAverage ?? 0), 0)} below your ${plural(improved.baselineMonths, 'month')} average. If that holds, it is worth about ${dollars(Math.abs(improved.deltaVsAverage) * 12)} a year.`,
      tone: 'positive',
      score: 60,
      action: { label: `View ${improved.name}`, categoryId: improved.id },
    });
  }

  // ── Bills landing soon ──────────────────────────────────────────────────────
  const soon = recurring.upcoming.filter(b => b.daysUntil >= 0 && b.daysUntil <= 7);
  if (soon.length > 0) {
    const total = soon.reduce((s, b) => s + b.amount, 0);
    if (total >= MATERIAL_DOLLARS) {
      candidates.push({
        id: 'bills-soon',
        title: `${dollars(total)} of bills due in the next 7 days`,
        body: `${plural(soon.length, 'charge')} scheduled, starting with ${soon[0].name}. Worth a glance at the balance they come out of.`,
        tone: 'info',
        score: 58,
        action: { label: 'View bills', to: '/transactions', tab: 'recurring' },
      });
    }
  }

  // ── Repeating charges the user hasn't set up as recurring ───────────────────
  const detected = recurring.subscriptions.detected;
  if (detected.length > 0) {
    const total = detected.reduce((s, d) => s + d.monthlyAmount, 0);
    candidates.push({
      id: 'detected-subscriptions',
      title: `${plural(detected.length, 'possible recurring charge')} not set up yet`,
      body: `${detected.slice(0, 2).map(d => d.name).join(' and ')} ${verbFor(detected.length, 'charge')} on a regular cycle — about ${dollars(total)} a month in total. Fintrack has not confirmed what they are.`,
      tone: 'action',
      score: 64,
      action: { label: 'Review recurring charges', to: '/transactions', tab: 'recurring' },
    });
  }

  // ── Duplicate-looking services ──────────────────────────────────────────────
  const duplicate = recurring.subscriptions.possibleDuplicates[0];
  if (duplicate) {
    candidates.push({
      id: 'duplicate-subscriptions',
      title: 'Two recurring charges look similar',
      body: `${duplicate.names.join(' and ')} may be the same service billed twice. Worth confirming before either renews.`,
      tone: 'action',
      score: 66,
      action: { label: 'Review recurring charges', to: '/transactions', tab: 'recurring' },
    });
  }

  // ── Net worth at a new high ─────────────────────────────────────────────────
  if (netWorth.points.length >= 4 && netWorth.high && netWorth.change > 0) {
    const last = netWorth.points[netWorth.points.length - 1];
    if (netWorth.high.month === last.month) {
      candidates.push({
        id: 'net-worth-high',
        title: 'Net worth is at its highest in this window',
        body: `${dollars(last.value)}, up ${dollars(netWorth.change)} since ${netWorth.points[0].label}.`,
        tone: 'positive',
        score: 57,
      });
    }
  }

  // ── Income dropped sharply ──────────────────────────────────────────────────
  if (ctx.previousMetrics && ctx.previousMetrics.income > 0 && metrics.income > 0) {
    const drop = (metrics.income - ctx.previousMetrics.income) / ctx.previousMetrics.income;
    if (drop <= -0.25 && ctx.previousMetrics.income - metrics.income >= MATERIAL_DOLLARS * 4) {
      candidates.push({
        id: 'income-drop',
        title: `Income was ${signedPercent(drop)} versus the previous period`,
        body: `${dollars(metrics.income)} against ${dollars(ctx.previousMetrics.income)}. If some income is simply yet to land, this will even out.`,
        tone: 'info',
        score: 72,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}
