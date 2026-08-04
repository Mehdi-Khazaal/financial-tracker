import type { SavingsGoal } from '../../../types';
import { MIN_PROJECTION_MONTHS, describeGoalProgress, monthsUntil, summariseGoals } from './goals';

/**
 * Goal pace.
 *
 * The two figures worth testing hardest are the ones users will act on: the
 * required monthly contribution and the projected completion date. Both are
 * more often *withheld* than shown, and the guards are the point — a date read
 * as a promise, produced from one good month, is worse than no date.
 */

const TODAY = new Date(2026, 7, 3); // 3 August 2026

let nextId = 1;
const goal = (overrides: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: nextId++,
  user_id: 1,
  name: 'Summer 2027',
  target_amount: 12000,
  deadline: null,
  created_at: '',
  allocations: [],
  current_amount: 0,
  ...overrides,
});

const opts = (averageMonthlySaved: number | null, averageMonths = 6) =>
  ({ today: TODAY, averageMonthlySaved, averageMonths });

// ── Required monthly contribution ─────────────────────────────────────────────

describe('required monthly contribution', () => {
  it('divides what remains by the months left', () => {
    // 12 months to Aug 2027, $12,000 outstanding.
    const p = describeGoalProgress(goal({ deadline: '2027-08-03' }), opts(500));

    expect(p.monthsRemaining).toBe(12);
    expect(p.requiredMonthly).toBeCloseTo(1000, 2);
  });

  it('accounts for money already set aside', () => {
    const p = describeGoalProgress(goal({ deadline: '2027-08-03', current_amount: 6000 }), opts(500));

    expect(p.remaining).toBe(6000);
    expect(p.requiredMonthly).toBeCloseTo(500, 2);
  });

  it('is withheld without a target date — nothing requires it', () => {
    expect(describeGoalProgress(goal(), opts(500)).requiredMonthly).toBeNull();
  });

  it('is withheld once the date has passed — no contribution can meet it', () => {
    const p = describeGoalProgress(goal({ deadline: '2026-01-01' }), opts(500));

    expect(p.deadlinePassed).toBe(true);
    expect(p.requiredMonthly).toBeNull();
    expect(p.pace).toBe('date-passed');
  });

  it('is withheld once the goal is funded', () => {
    const p = describeGoalProgress(goal({ deadline: '2027-08-03', current_amount: 12000 }), opts(500));

    expect(p.requiredMonthly).toBeNull();
    expect(p.pace).toBe('complete');
  });

  it('treats a deadline inside this month as the whole remainder due now', () => {
    const p = describeGoalProgress(goal({ deadline: '2026-08-20', current_amount: 11000 }), opts(500));

    expect(p.monthsRemaining).toBe(0);
    expect(p.requiredMonthly).toBeCloseTo(1000, 2);
  });
});

// ── Projection guards ─────────────────────────────────────────────────────────

describe('projected completion', () => {
  it('projects from the shared average when history supports it', () => {
    const p = describeGoalProgress(goal({ current_amount: 2000 }), opts(1000, 6));

    // $10,000 remaining at $1,000/month → 10 months → June 2027.
    expect(p.monthsAtCurrentRate).toBe(10);
    expect(p.projectedCompletion).toBe('June 2027');
  });

  it('is withheld with too few completed months', () => {
    const p = describeGoalProgress(goal(), opts(1000, MIN_PROJECTION_MONTHS - 1));

    expect(p.projectedCompletion).toBeNull();
    expect(p.monthsAtCurrentRate).toBeNull();
  });

  it('explains the shortfall on a dated goal, where pace is what is missing', () => {
    const p = describeGoalProgress(
      goal({ deadline: '2027-08-03' }),
      opts(1000, MIN_PROJECTION_MONTHS - 1),
    );

    expect(p.pace).toBe('unknown');
    expect(p.paceDetail).toContain(`${MIN_PROJECTION_MONTHS} completed months`);
  });

  it('is withheld on a zero savings rate', () => {
    expect(describeGoalProgress(goal(), opts(0, 12)).projectedCompletion).toBeNull();
  });

  it('is withheld on a negative savings rate — no date is better than never', () => {
    expect(describeGoalProgress(goal(), opts(-400, 12)).projectedCompletion).toBeNull();
  });

  it('is withheld when no average exists at all', () => {
    expect(describeGoalProgress(goal(), opts(null, 0)).projectedCompletion).toBeNull();
  });

  it('is not worth showing when it rounds into the target month', () => {
    // Needs $2,222/month, saving $2,000 — genuinely behind, but the projection
    // still lands in the target month. Showing both would read as a
    // contradiction beside the "Behind schedule" label.
    // $20,000 over 9 months needs $2,222/month; saving $2,000 is behind, but
    // 20,000 / 2,000 = 10 months, which still lands in June 2027.
    const p = describeGoalProgress(goal({ target_amount: 20000, deadline: '2027-06-01' }), opts(2000));

    expect(p.pace).toBe('behind');
    expect(p.projectedCompletion).toBe('June 2027');
    expect(p.projectionAddsInformation).toBe(false);
  });

  it('is worth showing when it lands in a different month from the target', () => {
    const p = describeGoalProgress(goal({ target_amount: 20000, deadline: '2027-06-01' }), opts(800));

    expect(p.projectionAddsInformation).toBe(true);
  });

  it('is always worth showing when there is no target to compare against', () => {
    const p = describeGoalProgress(goal({ current_amount: 2000 }), opts(1000));

    expect(p.projectionAddsInformation).toBe(true);
  });

  it('refuses an absurd horizon rather than printing a date in the year 2400', () => {
    const p = describeGoalProgress(goal({ target_amount: 1_000_000 }), opts(1, 12));

    expect(p.projectedCompletion).toBeNull();
  });
});

// ── Pace states ───────────────────────────────────────────────────────────────

describe('pace', () => {
  const dated = (current: number) => goal({ deadline: '2027-08-03', current_amount: current });

  it('is ahead when the rate comfortably clears what is needed', () => {
    // Needs $1,000/month; saving $1,500.
    const p = describeGoalProgress(dated(0), opts(1500));

    expect(p.pace).toBe('ahead');
    expect(p.paceLabel).toBe('Ahead of schedule');
  });

  it('is on track when the rate matches', () => {
    expect(describeGoalProgress(dated(0), opts(1000)).pace).toBe('on-track');
  });

  it('is behind when the rate falls short, stated without alarm', () => {
    const p = describeGoalProgress(dated(0), opts(400));

    expect(p.pace).toBe('behind');
    expect(p.paceLabel).toBe('Behind schedule');
    expect(p.paceDetail).toBe('Your recent rate is below what this goal needs to hit its date.');
  });

  it('is complete when funded', () => {
    expect(describeGoalProgress(dated(12000), opts(500)).pace).toBe('complete');
  });

  it('is overfunded past the target, reporting the true percentage', () => {
    const p = describeGoalProgress(dated(15000), opts(500));

    expect(p.pace).toBe('overfunded');
    expect(p.presentation.rawProgress).toBe(125);
    // The bar still stops at full.
    expect(p.presentation.progress).toBe(100);
  });

  it('has no schedule to judge without a deadline', () => {
    const p = describeGoalProgress(goal({ current_amount: 3000 }), opts(500));

    expect(p.pace).toBe('no-deadline');
    expect(p.paceDetail).toContain('no schedule to measure against');
  });

  it('is unknown when a deadline exists but the history does not', () => {
    expect(describeGoalProgress(dated(0), opts(null, 0)).pace).toBe('unknown');
  });

  it('reports the passed date without blaming anyone', () => {
    const p = describeGoalProgress(goal({ deadline: '2026-01-01' }), opts(500));

    expect(p.paceDetail).toContain('Adjusting the date keeps the goal useful.');
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('survives a zero target without dividing by it', () => {
    const p = describeGoalProgress(goal({ target_amount: 0, current_amount: 100 }), opts(500));

    expect(Number.isFinite(p.presentation.progress)).toBe(true);
    expect(p.presentation.status).toBe('invalid');
    expect(p.remaining).toBe(0);
  });

  it('never reports negative remaining', () => {
    expect(describeGoalProgress(goal({ current_amount: 20000 }), opts(500)).remaining).toBe(0);
  });

  it('counts months correctly across a year boundary', () => {
    expect(monthsUntil('2027-01-03', TODAY)).toBe(5);
  });

  it('floors months at zero for a past date', () => {
    expect(monthsUntil('2025-01-01', TODAY)).toBe(0);
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

describe('summary across goals', () => {
  const goals = [
    goal({ name: 'Done', target_amount: 1000, current_amount: 1000 }),
    goal({ name: 'Behind', target_amount: 10000, current_amount: 1000, deadline: '2027-02-03' }),
    goal({ name: 'Open', target_amount: 5000, current_amount: 2000 }),
  ];

  it('totals set aside and remaining', () => {
    const summary = summariseGoals(goals, opts(100));

    expect(summary.totalSetAside).toBe(4000);
    expect(summary.totalTarget).toBe(16000);
    expect(summary.totalRemaining).toBe(12000);
  });

  it('reports combined progress', () => {
    expect(summariseGoals(goals, opts(100)).overallProgress).toBeCloseTo(25, 4);
  });

  it('counts complete and behind separately', () => {
    const summary = summariseGoals(goals, opts(100));

    expect(summary.completeCount).toBe(1);
    expect(summary.behindCount).toBe(1);
  });

  it('handles no goals without dividing by zero', () => {
    const summary = summariseGoals([], opts(100));

    expect(summary.overallProgress).toBeNull();
    expect(summary.totalSetAside).toBe(0);
  });
});
