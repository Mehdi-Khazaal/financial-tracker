import { describe, expect, it } from 'vitest';
import type { CategoryComparison, NetWorthAnalysis, PeriodMetrics, RecurringOutlook, ResolvedPeriod, SavingsMetrics } from '../types';
import { buildPeriodSummary, type SummaryContext } from './summary';

/**
 * The written review: every clause is tied to a number and only appears when
 * that number moved enough to matter.
 */

const period = (over: Partial<ResolvedPeriod> = {}): ResolvedPeriod => ({
  id: 'this-month', start: '2026-07-01', end: '2026-07-31', months: ['2026-07'], label: 'July 2026',
  isSingleMonth: true, isIncomplete: false, elapsed: 1, daysElapsed: 31, daysTotal: 31, shortLabel: 'Jul',
  previous: { start: '2026-06-01', end: '2026-06-30', months: ['2026-06'], label: 'June 2026' }, ...over,
});

const metrics = (over: Partial<PeriodMetrics> = {}): PeriodMetrics => ({
  income: 4000, expenses: 3000, grossExpenses: 3000, refunds: 0, cardPayments: 0, investments: 0, net: 1000,
  savingsRate: 0.25, transactionCount: 40, uncategorizedCount: 0, uncategorizedSpend: 0,
  largestExpense: null, largestIncome: null, ...over,
});

const category = (over: Partial<CategoryComparison> = {}): CategoryComparison => ({
  id: 10, name: 'Groceries', color: '#fff', current: 400, previous: 400, average: 400, baselineMonths: 4,
  confidence: 'medium', deltaVsPrevious: 0, deltaVsAverage: 0, pctVsPrevious: 0, pctVsAverage: 0, share: 0.2,
  transactionCount: 10, largestTransaction: null, drivenByOneTransaction: false, ...over,
});

const savings = (over: Partial<SavingsMetrics> = {}): SavingsMetrics => ({
  saved: 1000, savingsRate: 0.25, previousSaved: 1000, previousRate: 0.25, savedDelta: 0, rateDelta: 0,
  averageMonthlySaved: 1000, averageMonths: 4, allocatedTotal: 0, goalCount: 1, primaryGoal: null, ...over,
});

const recurring = (increased: RecurringOutlook['subscriptions']['increased'] = []): RecurringOutlook => ({
  upcoming: [], next30DaysTotal: 0, next30DaysCount: 0,
  subscriptions: { monthlyTotal: 0, previousMonthlyTotal: null, annualized: 0, count: 0, groups: [], increased, possibleDuplicates: [], detected: [], thisMonth: null },
});

const netWorth = (over: Partial<NetWorthAnalysis> = {}): NetWorthAnalysis => ({
  points: [], start: 0, end: 0, change: 0, pctChange: null, high: null, low: null, bestMonth: null, worstMonth: null, contributors: [], ...over,
} as NetWorthAnalysis);

const ctx = (over: Partial<SummaryContext> = {}): SummaryContext => ({
  period: period(), metrics: metrics(), previousMetrics: metrics(), categories: [category()],
  savings: savings(), netWorth: netWorth(), recurring: recurring(), ...over,
});

describe('buildPeriodSummary', () => {
  it('has nothing to say about an empty period', () => {
    const summary = buildPeriodSummary(ctx({ metrics: metrics({ transactionCount: 0 }) }));
    expect(summary.headline).toBe('No activity recorded for July 2026');
    expect(summary.verdict).toBeNull();
  });

  it('calls a steady month steady and says both held', () => {
    const summary = buildPeriodSummary(ctx());
    expect(summary.verdict).toBe('steady');
    expect(summary.headline).toBe('July 2026 tracked close to June 2026.');
    expect(summary.sentences[0]).toBe('Income and spending both held close to June 2026.');
    expect(summary.sentences).toContain('Your savings rate was 25.0%, leaving $1,000.00 after expenses.');
  });

  it('judges stronger and weaker by the change in what was left over', () => {
    expect(buildPeriodSummary(ctx({ metrics: metrics({ net: 2000, expenses: 2000 }) })).verdict).toBe('stronger');
    const weaker = buildPeriodSummary(ctx({ metrics: metrics({ net: 0, expenses: 4000 }) }));
    expect(weaker.verdict).toBe('weaker');
    expect(weaker.headline).toBe('July 2026 was a tighter month than usual.');
    expect(weaker.sentences[0]).toBe('Compared with June 2026, spending rose 33.3% to $4,000.00.');
  });

  it('describes a multi-month range as a period, and has no verdict without a comparison', () => {
    const range = period({ isSingleMonth: false, months: ['2026-05', '2026-06', '2026-07'], label: 'May – Jul 2026', previous: null });
    const summary = buildPeriodSummary(ctx({ period: range, previousMetrics: null }));
    expect(summary.verdict).toBeNull();
    expect(summary.hasComparison).toBe(false);
    expect(summary.headline).toBe('Here is how May – Jul 2026 looked.');
    expect(summary.sentences[0]).toBe('You brought in $4,000.00 and spent $3,000.00.');
  });

  it('names the biggest single change, and says when a drop is a return to normal', () => {
    const drop = category({ name: 'Dining', current: 300, previous: 500, average: 290, deltaVsPrevious: -200 });
    expect(buildPeriodSummary(ctx({ categories: [drop] })).sentences).toContain('The biggest single change was Dining, down $200.00 — back around its usual level.');
    const rise = category({ name: 'Travel', current: 900, previous: 100, deltaVsPrevious: 800, drivenByOneTransaction: true });
    expect(buildPeriodSummary(ctx({ categories: [rise] })).sentences).toContain('The biggest single change was Travel, up $800.00, almost all of it a single purchase.');
  });

  it('reports a savings-rate change in percentage points, never as a percentage of itself', () => {
    const summary = buildPeriodSummary(ctx({ savings: savings({ previousRate: 0.1, rateDelta: 0.15 }) }));
    expect(summary.sentences.find(s => s.startsWith('Your savings rate'))).toBe(
      'Your savings rate was 25.0%, up 15.0 pp compared with June 2026 (10.0% → 25.0%), leaving $1,000.00 after expenses.',
    );
  });

  it('explains a missing savings rate instead of inventing one', () => {
    const summary = buildPeriodSummary(ctx({ metrics: metrics({ income: 0, savingsRate: null, net: -3000 }), previousMetrics: null }));
    expect(summary.sentences).toContain('No income was recorded in this period, so a savings rate cannot be calculated.');
  });

  it('mentions net worth only when it moved materially', () => {
    const points = [{ month: '2026-06', label: 'Jun', value: 1000, change: null, pctChange: null }, { month: '2026-07', label: 'Jul', value: 1500, change: 500, pctChange: 0.5 }];
    expect(buildPeriodSummary(ctx({ netWorth: netWorth({ points, change: 500, pctChange: 0.5 }) })).sentences.join(' ')).toContain('Net worth is up $500.00');
    expect(buildPeriodSummary(ctx({ netWorth: netWorth({ points, change: 10 }) })).sentences.join(' ')).not.toContain('Net worth');
  });

  it('offers exactly one suggestion, most useful first', () => {
    expect(buildPeriodSummary(ctx({ metrics: metrics({ uncategorizedCount: 4 }) })).suggestion).toBe('Filing the 4 uncategorized transactions would sharpen every comparison on this page.');
    expect(buildPeriodSummary(ctx({ recurring: recurring([{ name: 'Spotify', from: 9.99, to: 11.99, delta: 2 }]) })).suggestion).toBe('Worth reviewing Spotify — its charge went up by $2.00.');
    const rise = category({ name: 'Dining', deltaVsPrevious: 200 });
    expect(buildPeriodSummary(ctx({ categories: [rise] })).suggestion).toBe('If you want one thing to watch next period, Dining is the category that moved most.');
    const goal = { id: 1, name: 'Holiday', target: 2000, current: 500, remaining: 1500 } as unknown as SavingsMetrics['primaryGoal'];
    expect(buildPeriodSummary(ctx({ savings: savings({ primaryGoal: goal }) })).suggestion).toBe('You could move some of the $1,000.00 you kept toward Holiday, which needs $1,500.00 more.');
    expect(buildPeriodSummary(ctx({ savings: savings({ goalCount: 0 }) })).suggestion).toBe('You saved $1,000.00 without a goal attached — setting one makes the progress visible.');
    expect(buildPeriodSummary(ctx({ savings: savings({ saved: 0 }) })).suggestion).toBeNull();
  });
});
