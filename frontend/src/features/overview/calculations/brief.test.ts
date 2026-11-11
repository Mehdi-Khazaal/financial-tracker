import type { Account, Collection, Transaction } from '../../../types';
import type { Forecast, PeriodMetrics, PrimaryGoal } from '../../analytics/types';
import { EMPTY_METRICS } from '../../analytics/calculations/metrics';
import { leftOverRange } from '../../analytics/format';
import { buildMonthActivity } from './activity';
import {
  BRIEF_LIMIT, briefCandidates, buildMorningBrief, calculateSpendingPace,
  type BriefInputs,
} from './brief';

/**
 * The Morning Brief.
 *
 * Two things are worth pinning down here, and they pull in opposite directions:
 * the brief must find something to say when the data supports it, and must say
 * nothing when it does not. Most of these tests are the second kind, because
 * that is the failure mode that erodes trust — a dashboard that manufactures an
 * observation is worse than one that admits a quiet morning.
 */

const accounts: Account[] = [
  { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 4200, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 2, user_id: 1, name: 'Rewards Card', type: 'credit_card', balance: -213.37, credit_limit: 1500, currency: 'USD', created_at: '', updated_at: '' },
];

const TODAY = new Date(2026, 7, 12); // 12 August 2026

let nextId = 1;
const tx = (date: string, amount: number, description = 'Entry'): Transaction => ({
  id: nextId++, user_id: 1, account_id: 1, category_id: 10, amount,
  description, transaction_date: date, created_at: '',
});

/**
 * A featured goal as `calculateSavingsMetrics` would hand it over — already
 * chosen, already projected. The brief no longer picks or projects goals
 * itself, so the fixture mirrors that boundary.
 */
const primaryGoal = (overrides: Partial<PrimaryGoal> = {}): PrimaryGoal => ({
  id: 1,
  name: 'Education',
  target: 10000,
  current: 3000,
  progress: 30,
  remaining: 7000,
  deadline: null,
  projectedCompletion: null,
  monthsToCompletion: null,
  basis: 'progress',
  ...overrides,
});

const quietActivity = buildMonthActivity({
  transactions: [tx('2026-07-31', -40)],
  month: '2026-08', today: TODAY, income: 0, expenses: 0, dataIncomplete: false,
});

const activeActivity = buildMonthActivity({
  transactions: [tx('2026-08-01', 3000), tx('2026-08-02', -50)],
  month: '2026-08', today: TODAY, income: 3000, expenses: 50, dataIncomplete: false,
});

const noForecast: Forecast = {
  available: false, reason: 'Not enough history.', confidence: 'none', basis: '',
  monthLabel: 'August 2026', daysElapsed: 12, daysTotal: 31,
  expenses: null, income: null, savings: null, savingsRange: null, savingsRate: null, categoryRisks: [],
};

const metrics = (overrides: Partial<PeriodMetrics> = {}): PeriodMetrics =>
  ({ ...EMPTY_METRICS, ...overrides });

const base: BriefInputs = {
  today: TODAY,
  activity: activeActivity,
  dataIncomplete: false,
  unreviewedCount: 0,
  accounts: [accounts[0]],
  primaryGoal: null,
  savingsMonths: 0,
  recentMetrics: metrics(),
  recentTransactions: [],
  declaredRecurringKeys: new Set<string>(),
  pace: null,
  forecast: noForecast,
  upcoming: [],
  undeclaredRecurringCount: 0,
  lastCompleted: null,
  heroShowsActivityContext: false,
};

const ids = (inputs: Partial<BriefInputs> = {}) =>
  briefCandidates({ ...base, ...inputs }).map(i => i.id);

const find = (id: string, inputs: Partial<BriefInputs> = {}) =>
  briefCandidates({ ...base, ...inputs }).find(i => i.id === id);

// ── Restraint ─────────────────────────────────────────────────────────────────

describe('the brief says nothing rather than inventing something', () => {
  it('is empty when the data supports no observation', () => {
    expect(briefCandidates(base)).toEqual([]);
    expect(buildMorningBrief(base)).toEqual([]);
  });

  it('does not report a pace without enough completed months', () => {
    expect(calculateSpendingPace({
      monthExpenses: 900,
      elapsedFraction: 0.4,
      completedMonthExpenses: [1000, 1100],
    })).toBeNull();
  });

  it('does not report a pace in the first days of a month', () => {
    expect(calculateSpendingPace({
      monthExpenses: 40,
      elapsedFraction: 0.05,
      completedMonthExpenses: [1000, 1100, 1050, 980],
    })).toBeNull();
  });

  it('ignores a movement too small to matter', () => {
    // 2% off usual is noise, not news.
    const pace = calculateSpendingPace({
      monthExpenses: 510,
      elapsedFraction: 0.5,
      completedMonthExpenses: [1000, 1000, 1000],
    });

    expect(pace?.delta).toBeCloseTo(0.02, 2);
    expect(ids({ pace })).not.toContain('spending-pace');
  });

  it('ignores a small purchase as "largest this week"', () => {
    const small = tx('2026-08-11', -12);
    expect(ids({ recentMetrics: metrics({ largestExpense: small }) }))
      .not.toContain('largest-purchase');
  });

  it('does not project without a usable forecast', () => {
    expect(ids()).not.toContain('projection');
  });

  it('does not repeat the quiet-month line the hero is already showing', () => {
    expect(ids({ activity: quietActivity, heroShowsActivityContext: true }))
      .not.toContain('no-activity');
    expect(ids({ activity: quietActivity, heroShowsActivityContext: false }))
      .toContain('no-activity');
  });
});

// ── What it does say ──────────────────────────────────────────────────────────

describe('spending pace', () => {
  it('reports tracking below usual, elapsed-adjusted', () => {
    // Half the month gone, $460 spent → $920 projected against $1,000 usual.
    const pace = calculateSpendingPace({
      monthExpenses: 460,
      elapsedFraction: 0.5,
      completedMonthExpenses: [1000, 1000, 1000],
    });

    expect(pace?.projected).toBeCloseTo(920, 2);
    expect(pace?.delta).toBeCloseTo(-0.08, 3);

    const item = find('spending-pace', { pace });
    expect(item?.text).toBe('Spending is tracking 8% below usual this month');
    expect(item?.tone).toBe('positive');
  });

  it('reports tracking above usual without calling it a problem', () => {
    const pace = calculateSpendingPace({
      monthExpenses: 700,
      elapsedFraction: 0.5,
      completedMonthExpenses: [1000, 1000, 1000],
    });

    const item = find('spending-pace', { pace });
    expect(item?.text).toContain('above usual');
    // Spending more than usual is not a verdict.
    expect(item?.tone).toBe('neutral');
  });

  it('quotes the forecast rather than scaling up bills paid early', () => {
    // Rent landed on the 1st: $1,600 spent by the 5th is not a $9,920 month.
    const pace = calculateSpendingPace({
      monthExpenses: 1600,
      elapsedFraction: 5 / 31,
      completedMonthExpenses: [1700, 1700, 1700],
      projected: 1750,
    });

    expect(pace?.projected).toBe(1750);
    expect(pace?.delta).toBeCloseTo(0.029, 3);
  });

  it('says nothing when there is no forecast to quote', () => {
    expect(calculateSpendingPace({
      monthExpenses: 1600,
      elapsedFraction: 0.5,
      completedMonthExpenses: [1700, 1700, 1700],
      projected: null,
    })).toBeNull();
  });

  it('uses the median so one wild month does not set "usual"', () => {
    const pace = calculateSpendingPace({
      monthExpenses: 500,
      elapsedFraction: 0.5,
      completedMonthExpenses: [1000, 1000, 9000],
    });

    expect(pace?.typical).toBe(1000);
  });
});

describe('projection', () => {
  const forecast: Forecast = {
    ...noForecast,
    available: true,
    reason: null,
    confidence: 'high',
    savings: 840,
    savingsRate: 0.28,
  };

  it('states what is left over at the current rate', () => {
    const item = find('projection', { forecast });

    expect(item?.text).toBe('On track to have $840.00 left over this month');
    expect(item?.tone).toBe('positive');
  });

  it('states an overspend plainly rather than alarmingly', () => {
    const item = find('projection', { forecast: { ...forecast, savings: -220 } });

    expect(item?.text).toBe('On track to spend $220.00 more than you earn this month');
    expect(item?.tone).toBe('neutral');
  });

  it('flags a projection built on thin history', () => {
    const item = find('projection', { forecast: { ...forecast, confidence: 'low' } });

    expect(item?.detail).toContain('rough guide');
  });

  // Nov 10: two paychecks due on the 21st turned "spend $33.41 more than you
  // earn" into roughly $3,000 left over, somewhere between the lowest and the
  // highest recent pay.
  const withPaychecks: Forecast = {
    ...forecast,
    savings: 3036.4,
    income: { projected: 6000, soFar: 3022.39, scheduled: 0, expected: 2977.61, paychecks: 2, low: 5100, high: 7100 },
    savingsRange: { low: 2136.4, high: 4136.4 },
  };

  it('rounds an outlook that counts paychecks still due, and gives its range', () => {
    const item = find('projection', { forecast: withPaychecks });

    expect(item?.text).toBe('On track to have about $3,036 left over this month');
    expect(item?.detail).toBe('Between $2,136 and $4,136 left over, depending on pay.');
  });

  it('says "short" for the low end of a range that dips below zero', () => {
    const item = find('projection', { forecast: { ...withPaychecks, savingsRange: { low: -150, high: 900 } } });

    expect(item?.detail).toBe('Between $150 short and $900 left over, depending on pay.');
    expect(leftOverRange(-900, -150)).toBe('Between $150 and $900 short');
  });
});

describe('what landed and what is coming', () => {
  it('reports income that arrived, with the weekday', () => {
    const paycheck = tx('2026-08-11', 3200, 'ACME PAYROLL');
    const item = find('income-landed', { recentMetrics: metrics({ largestIncome: paycheck }) });

    expect(item?.text).toBe('$3,200.00 arrived on Tuesday');
    expect(item?.tone).toBe('positive');
  });

  it('reports a bill due within the week', () => {
    const item = find('bill-due', {
      upcoming: [{
        id: 1, name: 'Netflix', amount: 15.99, dueDate: '2026-08-15', daysUntil: 3,
        period: 'monthly', isVariable: false, categoryName: null,
        categoryColor: 'var(--muted)', accountName: 'Everyday',
      }],
    });

    expect(item?.text).toBe('Netflix is due in 3 days');
    expect(item?.detail).toBe('$15.99 from Everyday.');
  });

  it('says "due today" rather than "in 0 days"', () => {
    const item = find('bill-due', {
      upcoming: [{
        id: 1, name: 'Rent', amount: 1400, dueDate: '2026-08-12', daysUntil: 0,
        period: 'monthly', isVariable: false, categoryName: null,
        categoryColor: 'var(--muted)', accountName: null,
      }],
    });

    expect(item?.text).toBe('Rent is due today');
  });

  it('ignores a bill beyond the horizon', () => {
    expect(ids({
      upcoming: [{
        id: 1, name: 'Insurance', amount: 300, dueDate: '2026-09-10', daysUntil: 29,
        period: 'yearly', isVariable: false, categoryName: null,
        categoryColor: 'var(--muted)', accountName: null,
      }],
    })).not.toContain('bill-due');
  });

  it('reports a declared subscription that actually posted', () => {
    const charge = tx('2026-08-10', -15.99, 'NETFLIX.COM');
    const item = find('subscription-renewed', {
      recentTransactions: [charge],
      declaredRecurringKeys: new Set(['netflix com']),
    });

    expect(item?.text).toMatch(/^Paid Netflix/i);
    expect(item?.detail).toBe('$15.99');
  });

  it('does not spend two lines on the same merchant', () => {
    // Netflix due on Friday and Netflix charged last week is one story.
    const shown = ids({
      upcoming: [{
        id: 1, name: 'NETFLIX.COM', amount: 15.99, dueDate: '2026-08-15', daysUntil: 3,
        period: 'monthly', isVariable: false, categoryName: null,
        categoryColor: 'var(--muted)', accountName: null,
      }],
      recentTransactions: [tx('2026-08-06', -15.99, 'NETFLIX.COM')],
      declaredRecurringKeys: new Set(['netflix com']),
    });

    expect(shown).toContain('bill-due');
    expect(shown).not.toContain('subscription-renewed');
  });

  it('still reports a renewal from a different merchant', () => {
    const shown = ids({
      upcoming: [{
        id: 1, name: 'Rent', amount: 1850, dueDate: '2026-08-15', daysUntil: 3,
        period: 'monthly', isVariable: false, categoryName: null,
        categoryColor: 'var(--muted)', accountName: null,
      }],
      recentTransactions: [tx('2026-08-06', -15.99, 'NETFLIX.COM')],
      declaredRecurringKeys: new Set(['netflix com', 'rent']),
    });

    expect(shown).toContain('bill-due');
    expect(shown).toContain('subscription-renewed');
  });

  it('does not call an unrelated charge a renewal', () => {
    expect(ids({
      recentTransactions: [tx('2026-08-10', -15.99, 'CORNER SHOP')],
      declaredRecurringKeys: new Set(['netflix com']),
    })).not.toContain('subscription-renewed');
  });
});

describe('things that are actually wrong', () => {
  it('leads with a failed load, above everything else', () => {
    expect(ids({ dataIncomplete: true, unreviewedCount: 5 })[0]).toBe('data-incomplete');
  });

  it('ranks unreviewed imports above anything informational', () => {
    const order = ids({ unreviewedCount: 3, primaryGoal: primaryGoal() });

    expect(order.indexOf('unreviewed-imports')).toBeLessThan(order.indexOf('goal-next'));
  });

  it('flags an overdrawn account', () => {
    const item = find('overdrawn', { accounts: [{ ...accounts[0], balance: -50 }] });

    expect(item?.text).toBe('Everyday is overdrawn');
    expect(item?.tone).toBe('attention');
  });

  it('treats a routine card balance as information, never attention', () => {
    const item = find('card-balance', { accounts });

    expect(item?.tone).toBe('neutral');
    expect(item?.text).toBe('$213.37 outstanding on your cards');
  });

  it('escalates only when credit use is genuinely high', () => {
    const nearLimit = { ...accounts[1], balance: -1400 };

    expect(ids({ accounts: [nearLimit] })).toContain('high-utilization');
    expect(ids({ accounts })).not.toContain('high-utilization');
  });
});

describe('goals', () => {
  it('frames an unfinished goal as distance remaining', () => {
    const item = find('goal-next', { primaryGoal: primaryGoal() });

    expect(item?.text).toBe('$7,000.00 to go on Education');
    expect(item?.detail).toBe('30% funded.');
  });

  it('celebrates a finished goal without alarm', () => {
    const item = find('goal-complete', {
      primaryGoal: primaryGoal({ current: 10000, progress: 100, remaining: 0 }),
    });

    expect(item?.tone).toBe('positive');
    expect(item?.text).toBe('Education is fully funded');
  });

  it('quotes a completion date once there is enough history behind it', () => {
    const item = find('goal-next', {
      primaryGoal: primaryGoal({ projectedCompletion: 'March 2027', monthsToCompletion: 7 }),
      savingsMonths: 6,
    });

    expect(item?.detail).toBe('30% funded — on track for March 2027 at your recent rate.');
  });

  it('stays silent on the date when the history is too thin to trust', () => {
    const item = find('goal-next', {
      primaryGoal: primaryGoal({ projectedCompletion: 'March 2027', monthsToCompletion: 7 }),
      savingsMonths: 2,
    });

    expect(item?.detail).toBe('30% funded.');
    expect(item?.detail).not.toContain('March 2027');
  });

  it('stays silent when the shared calculation refused to project', () => {
    // `selectPrimaryGoal` returns a null completion for a zero or negative
    // average, so a flat or overspending history produces no date here either.
    const item = find('goal-next', {
      primaryGoal: primaryGoal({ projectedCompletion: null }),
      savingsMonths: 12,
    });

    expect(item?.detail).toBe('30% funded.');
  });

  it('never projects a date onto a goal that is already funded', () => {
    const item = find('goal-complete', {
      primaryGoal: primaryGoal({ current: 10000, progress: 100, remaining: 0, projectedCompletion: 'March 2027' }),
      savingsMonths: 12,
    });

    expect(item?.detail).toBeNull();
  });
});

describe('last completed month', () => {
  it('closes with it when the current month cannot be projected', () => {
    const item = find('last-completed', { lastCompleted: { month: '2026-07', net: 7405 } });

    expect(item?.text).toBe('$7,405.00 left after expenses in July 2026');
  });

  it('yields to a live projection rather than doubling up on trend lines', () => {
    expect(ids({
      lastCompleted: { month: '2026-07', net: 7405 },
      forecast: { ...noForecast, available: true, reason: null, savings: 840 },
    })).not.toContain('last-completed');
  });
});

// ── Volume ────────────────────────────────────────────────────────────────────

describe('the brief stays short', () => {
  const crowded: Partial<BriefInputs> = {
    dataIncomplete: true,
    unreviewedCount: 4,
    accounts: [{ ...accounts[0], balance: -50 }, { ...accounts[1], balance: -1400 }],
    primaryGoal: primaryGoal(),
    undeclaredRecurringCount: 2,
    recentMetrics: metrics({ largestExpense: tx('2026-08-10', -400) }),
    lastCompleted: { month: '2026-07', net: 500 },
  };

  it('caps the list even when everything applies at once', () => {
    expect(briefCandidates({ ...base, ...crowded }).length).toBeGreaterThan(BRIEF_LIMIT);
    expect(buildMorningBrief({ ...base, ...crowded })).toHaveLength(BRIEF_LIMIT);
  });

  it('keeps the most important lines when it has to cut', () => {
    const shown = buildMorningBrief({ ...base, ...crowded }).map(i => i.id);

    expect(shown[0]).toBe('data-incomplete');
    expect(shown).toContain('unreviewed-imports');
    expect(shown).not.toContain('card-balance');
  });

  it('honours a smaller limit for narrow screens', () => {
    expect(buildMorningBrief({ ...base, ...crowded }, 3)).toHaveLength(3);
  });
});

describe('collections in the brief', () => {
  const collection = (overrides: Partial<Collection> = {}): Collection => ({
    id: 4, name: 'Ohio trip', emoji: null, color: null, note: null, start_date: '2026-08-01', end_date: '2026-08-09',
    budget: null, is_archived: false, created_at: null, active: false, suggestion_count: 0,
    totals: { spent: '1300', returned: '60', net: '1240', count: 18, first_date: null, last_date: null }, ...overrides,
  });

  it('says nothing about collections that need nothing', () => {
    expect(ids({ collections: [] })).toEqual(ids());
    expect(ids({ collections: [collection({ end_date: '2026-08-01' })] })).toEqual(ids());
    expect(ids({ collections: [collection({ end_date: '2026-08-12', active: true })] })).toEqual(ids());
    expect(ids({ collections: [collection({ is_archived: true, active: true, suggestion_count: 3 })] })).toEqual(ids());
  });

  it('asks about suggestions for a running collection', () => {
    const item = find('collection-review-4', { collections: [collection({ active: true, end_date: null, suggestion_count: 3 })] });
    expect(item?.text).toBe('3 transactions might belong to Ohio trip');
    expect(item?.action?.to).toBe('/collections/4?review=1');
  });

  it('gives the total once a collection has ended, against its budget when it has one', () => {
    expect(find('collection-ended-4', { collections: [collection()] })).toMatchObject({
      text: 'Ohio trip cost $1,240.00 in total', detail: '18 transactions.', tone: 'positive',
    });
    expect(find('collection-ended-4', { collections: [collection({ budget: '1000' })] })).toMatchObject({
      detail: '$240.00 over its $1,000.00 budget.', tone: 'neutral',
    });
    expect(find('collection-ended-4', { collections: [collection({ budget: '1500' })] })?.detail)
      .toBe('$260.00 under its $1,500.00 budget.');
    expect(find('collection-ended-4', { collections: [collection({ totals: { ...collection().totals, count: 0 } })] })).toBeUndefined();
  });
});
