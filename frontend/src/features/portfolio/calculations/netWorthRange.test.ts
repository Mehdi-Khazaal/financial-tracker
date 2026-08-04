import type { MonthSnapshot } from '../../../types';
import { availableRanges, buildNetWorthRange } from './netWorthRange';

/**
 * Portfolio's net-worth trend.
 *
 * The series is the Dashboard's series — same endpoint, same definition — so
 * these tests cover the range windowing and the refusals, not the definition of
 * net worth, which lives in `features/accounts/calculations/totals`.
 */

const snap = (month: string, value: number): MonthSnapshot => ({ month, net_worth: value });

const series = (count: number, from = 1000, step = 100): MonthSnapshot[] =>
  Array.from({ length: count }, (_, i) => {
    const month = new Date(2025, i, 1);
    return snap(
      `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
      from + i * step,
    );
  });

describe('range windowing', () => {
  it('takes the most recent N months', () => {
    const range = buildNetWorthRange(series(24), 6);

    expect(range.months).toBe(6);
    expect(range.points).toHaveLength(6);
    expect(range.label).toBe('Last 6 months');
  });

  it('uses everything available when history is shorter than the range', () => {
    const range = buildNetWorthRange(series(4), 24);

    expect(range.months).toBe(4);
    expect(range.label).toBe('Since Jan 2025');
  });

  it('computes start, current and change over the window, not the whole history', () => {
    // 24 months from 1,000 rising 100/month. The last 6 run 2,800 → 3,300.
    const range = buildNetWorthRange(series(24), 6);

    expect(range.start).toBe(2800);
    expect(range.current).toBe(3300);
    expect(range.change).toBe(500);
    expect(range.pctChange).toBeCloseTo(500 / 2800, 6);
  });

  it('finds the high and low inside the window', () => {
    const custom = [snap('2026-01', 1000), snap('2026-02', 2500), snap('2026-03', 800), snap('2026-04', 1500)];
    const range = buildNetWorthRange(custom, 12);

    expect(range.high?.value).toBe(2500);
    expect(range.low?.value).toBe(800);
  });

  it('sorts before windowing, so arrival order cannot pick the wrong months', () => {
    const shuffled = [snap('2026-03', 300), snap('2026-01', 100), snap('2026-02', 200)];
    const range = buildNetWorthRange(shuffled, 12);

    expect(range.points.map(p => p.value)).toEqual([100, 200, 300]);
    expect(range.change).toBe(200);
  });
});

describe('insufficient history', () => {
  it('refuses a trend on one snapshot', () => {
    const range = buildNetWorthRange([snap('2026-04', 1500)], 6);

    expect(range.hasTrend).toBe(false);
    expect(range.label).toBe('Not enough history yet');
    expect(range.summary).toContain('a position rather than a trend');
  });

  it('returns an empty range with no snapshots at all', () => {
    const range = buildNetWorthRange([], 12);

    expect(range.points).toHaveLength(0);
    expect(range.hasTrend).toBe(false);
    expect(range.high).toBeNull();
  });

  it('drops entries without a usable month key', () => {
    const range = buildNetWorthRange([snap('2026-01', 100), { month: '' } as MonthSnapshot], 12);

    expect(range.points).toHaveLength(1);
    expect(range.hasTrend).toBe(false);
  });

  it('reports no percentage when the window started at zero', () => {
    const range = buildNetWorthRange([snap('2026-01', 0), snap('2026-02', 400)], 12);

    expect(range.change).toBe(400);
    expect(range.pctChange).toBeNull();
  });
});

describe('available ranges', () => {
  it('offers nothing without at least two points', () => {
    expect(availableRanges([snap('2026-01', 100)])).toEqual([]);
  });

  it('offers only 6M with a handful of months', () => {
    expect(availableRanges(series(4))).toEqual([6]);
  });

  it('adds 12M once there is more than six months', () => {
    expect(availableRanges(series(9))).toEqual([6, 12]);
  });

  it('adds 24M once there is more than twelve', () => {
    expect(availableRanges(series(18))).toEqual([6, 12, 24]);
  });

  it('does not offer a range that would render the same chart as the one below', () => {
    // Exactly six months: a 12M button would show the identical six points.
    expect(availableRanges(series(6))).toEqual([6]);
  });
});

describe('accessible summary', () => {
  it('speaks the whole trend, so the chart is never sighted-only', () => {
    const range = buildNetWorthRange([snap('2026-01', 1000), snap('2026-02', 1500)], 12);

    expect(range.summary).toContain('$1,000.00');
    expect(range.summary).toContain('$1,500.00');
    expect(range.summary).toContain('a change of $500.00');
    expect(range.summary).toContain('High');
    expect(range.summary).toContain('low');
  });

  it('says "minus" rather than relying on a sign a screen reader may skip', () => {
    const range = buildNetWorthRange([snap('2026-01', 1500), snap('2026-02', 1000)], 12);

    expect(range.summary).toContain('a change of minus $500.00');
  });
});
