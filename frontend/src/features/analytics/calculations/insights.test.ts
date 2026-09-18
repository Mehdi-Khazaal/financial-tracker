import { describe, expect, it } from 'vitest';
import type { CategoryComparison, NetWorthAnalysis, PeriodMetrics, RecurringOutlook, ResolvedPeriod, SavingsMetrics, UpcomingBill } from '../types';
import type { Transaction } from '../../../types';
import { generateDeterministicInsights, type InsightContext } from './insights';

/**
 * Each insight fires on its own evidence and stays quiet below its threshold.
 * The base context is deliberately unremarkable: nothing in it should produce
 * an insight, so every test switches on exactly one signal.
 */

const period: ResolvedPeriod = {
  id: 'this-month', start: '2026-07-01', end: '2026-07-31', months: ['2026-07'], label: 'July 2026',
  isSingleMonth: true, isIncomplete: true, elapsed: 0.6, daysElapsed: 18, daysTotal: 31, shortLabel: 'Jul', previous: null,
};

const metrics = (over: Partial<PeriodMetrics> = {}): PeriodMetrics => ({
  income: 4000, expenses: 90, grossExpenses: 90, refunds: 0, cardPayments: 0, investments: 0, net: 3910,
  savingsRate: 0.97, transactionCount: 10, uncategorizedCount: 0, uncategorizedSpend: 0,
  largestExpense: null, largestIncome: null, ...over,
});

const category = (over: Partial<CategoryComparison> = {}): CategoryComparison => ({
  id: 10, name: 'Groceries', color: '#fff', current: 100, previous: 100, average: 100, baselineMonths: 4,
  confidence: 'medium', deltaVsPrevious: 0, deltaVsAverage: 0, pctVsPrevious: 0, pctVsAverage: 0, share: 0.2,
  transactionCount: 5, largestTransaction: null, drivenByOneTransaction: false, ...over,
});

const savings = (over: Partial<SavingsMetrics> = {}): SavingsMetrics => ({
  saved: 1000, savingsRate: 0.25, previousSaved: null, previousRate: null, savedDelta: null, rateDelta: null,
  averageMonthlySaved: 1000, averageMonths: 4, allocatedTotal: 0, goalCount: 0, primaryGoal: null, ...over,
});

const recurring = (over: Partial<RecurringOutlook['subscriptions']> = {}, upcoming: UpcomingBill[] = []): RecurringOutlook => ({
  upcoming, next30DaysTotal: 0, next30DaysCount: 0,
  subscriptions: {
    monthlyTotal: 0, previousMonthlyTotal: null, annualized: 0, count: 0, groups: [], increased: [],
    possibleDuplicates: [], detected: [], thisMonth: null, ...over,
  },
});

const netWorth = (over: Partial<NetWorthAnalysis> = {}): NetWorthAnalysis => ({
  points: [], start: 0, end: 0, change: 0, pctChange: null, high: null, low: null, bestMonth: null, worstMonth: null,
  contributors: [], ...over,
} as NetWorthAnalysis);

const base = (over: Partial<InsightContext> = {}): InsightContext => ({
  period, metrics: metrics(), previousMetrics: null, categories: [category()], savings: savings(),
  recurring: recurring(), netWorth: netWorth(), ...over,
});

const ids = (ctx: InsightContext) => generateDeterministicInsights(ctx).map(i => i.id);

describe('generateDeterministicInsights', () => {
  it('says nothing about an unremarkable period', () => {
    expect(ids(base())).toEqual([]);
  });

  it('flags a subscription price rise of at least a dollar, not a cent', () => {
    expect(ids(base({ recurring: recurring({ increased: [{ name: 'Spotify', from: 10.99, to: 11.99, delta: 1 }] }) }))).toEqual(['subscription-increase']);
    expect(ids(base({ recurring: recurring({ increased: [{ name: 'Spotify', from: 10.99, to: 11.49, delta: 0.5 }] }) }))).toEqual([]);
  });

  it('calls a habit a habit and a single purchase a single purchase', () => {
    const habit = category({ current: 300, deltaVsAverage: 200, pctVsAverage: 2, transactionCount: 12 });
    const [insight] = generateDeterministicInsights(base({ categories: [habit] }));
    expect(insight.id).toBe('above-average-10');
    expect(insight.tone).toBe('warning');

    const bike: Transaction = { id: 1, user_id: 1, account_id: 1, category_id: 10, amount: -900, description: 'MOTO SHOP', transaction_date: '2026-07-04', created_at: '' };
    const oneOff = category({ current: 1000, deltaVsAverage: 900, pctVsAverage: 9, drivenByOneTransaction: true, largestTransaction: bike, transactionCount: 2 });
    const [event] = generateDeterministicInsights(base({ categories: [oneOff] }));
    expect(event.id).toBe('one-off-10');
    expect(event.tone).toBe('info');
    expect(event.body).toContain('$900.00');
  });

  it('ignores a big percentage on a tiny amount, and an average with too little history', () => {
    expect(ids(base({ categories: [category({ current: 7, average: 4, deltaVsAverage: 3, pctVsAverage: 0.75 })] }))).toEqual([]);
    expect(ids(base({ categories: [category({ deltaVsAverage: 200, pctVsAverage: 2, baselineMonths: 2 })] }))).toEqual([]);
  });

  it('notices savings well above or below the recent pace', () => {
    expect(ids(base({ savings: savings({ saved: 1500 }) }))).toEqual(['savings-above']);
    expect(ids(base({ savings: savings({ saved: 300 }) }))).toEqual(['savings-below']);
    expect(ids(base({ savings: savings({ saved: 300, averageMonths: 2 }) }))).toEqual([]);
  });

  it('points out one category dominating spending only when spending is material', () => {
    const big = category({ current: 400, share: 0.6 });
    expect(ids(base({ categories: [big], metrics: metrics({ expenses: 600 }) }))).toEqual(['concentration-10']);
    expect(ids(base({ categories: [big], metrics: metrics({ expenses: 60 }) }))).toEqual([]);
  });

  it('asks for categories when enough spending is unfiled', () => {
    expect(ids(base({ metrics: metrics({ uncategorizedCount: 4, uncategorizedSpend: 120 }) }))).toEqual(['uncategorized']);
    expect(ids(base({ metrics: metrics({ uncategorizedCount: 2, uncategorizedSpend: 120 }) }))).toEqual([]);
  });

  it('credits a category that genuinely came down, with the yearly value', () => {
    const [insight] = generateDeterministicInsights(base({ categories: [category({ current: 50, deltaVsAverage: -50, pctVsAverage: -0.5 })] }));
    expect(insight.id).toBe('improved-10');
    expect(insight.body).toContain('$600.00 a year');
  });

  it('warns about bills in the next week only when they add up to something', () => {
    const bill = (amount: number, daysUntil: number): UpcomingBill => ({
      id: amount, name: `Bill ${amount}`, amount, dueDate: '2026-07-20', daysUntil, period: 'monthly', isVariable: false,
      categoryName: null, categoryColor: '#fff', accountName: null,
    });
    expect(ids(base({ recurring: recurring({}, [bill(30, 2), bill(15, 6)]) }))).toEqual(['bills-soon']);
    expect(ids(base({ recurring: recurring({}, [bill(10, 2)]) }))).toEqual([]);
    expect(ids(base({ recurring: recurring({}, [bill(300, 12)]) }))).toEqual([]);
  });

  it('surfaces unconfirmed and duplicate-looking recurring charges', () => {
    const detected = [{ key: 'a', name: 'Gym', monthlyAmount: 40, occurrences: 3, period: 'monthly' as const, lastSeen: '2026-07-01' }];
    const [found] = generateDeterministicInsights(base({ recurring: recurring({ detected }) }));
    expect(found.id).toBe('detected-subscriptions');
    expect(found.body).toContain('$40.00 a month');
    expect(ids(base({ recurring: recurring({ possibleDuplicates: [{ names: ['Netflix', 'Netflix HD'], note: '' }] }) }))).toEqual(['duplicate-subscriptions']);
  });

  it('celebrates a net-worth high only when the latest month is the high', () => {
    const points = ['2026-04', '2026-05', '2026-06', '2026-07'].map((month, i) => ({ month, label: month, value: 1000 + i * 100, change: null, pctChange: null }));
    expect(ids(base({ netWorth: netWorth({ points, high: points[3], change: 300 }) }))).toEqual(['net-worth-high']);
    expect(ids(base({ netWorth: netWorth({ points, high: points[2], change: 300 }) }))).toEqual([]);
  });

  it('notes a sharp income drop against the previous period', () => {
    expect(ids(base({ metrics: metrics({ income: 2000 }), previousMetrics: metrics({ income: 4000 }) }))).toEqual(['income-drop']);
    expect(ids(base({ metrics: metrics({ income: 3900 }), previousMetrics: metrics({ income: 4000 }) }))).toEqual([]);
  });

  it('keeps only the three strongest', () => {
    const busy = base({
      metrics: metrics({ uncategorizedCount: 5, uncategorizedSpend: 200, income: 2000 }),
      previousMetrics: metrics({ income: 4000 }),
      recurring: recurring({ increased: [{ name: 'Spotify', from: 9, to: 19, delta: 10 }], possibleDuplicates: [{ names: ['A', 'B'], note: '' }] }),
      savings: savings({ saved: 300 }),
    });
    const result = generateDeterministicInsights(busy);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('subscription-increase');
    expect(result.map(r => r.score)).toEqual([...result.map(r => r.score)].sort((a, b) => b - a));
  });
});
