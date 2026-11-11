import type { MonthSnapshot } from '../../../types';
import { IMPOSSIBLE_BALANCE_MARGIN, calculateBalanceChange, historyLooksIncomplete } from './history';

/**
 * Recent balance change.
 *
 * The behaviour worth protecting is the refusal: an account with no history
 * must not report a change of zero. The old inline version did exactly that —
 * `sparkData.length >= 2 ? last - first : 0` — so a week-old account displayed
 * a confident `+$0.00` that was a statement about its balance rather than an
 * admission about the data.
 */

const snap = (month: string, balance: number): MonthSnapshot => ({ month, balance });

describe('a real trend', () => {
  const series = [snap('2026-03', 1000), snap('2026-04', 1200), snap('2026-05', 1500)];

  it('measures oldest to newest', () => {
    const change = calculateBalanceChange(series);

    expect(change.available).toBe(true);
    expect(change.start).toBe(1000);
    expect(change.end).toBe(1500);
    expect(change.change).toBe(500);
  });

  it('reports the real window, not the requested one', () => {
    expect(calculateBalanceChange(series).windowLabel).toBe('3 months');
  });

  it('reports a percentage against the starting balance', () => {
    expect(calculateBalanceChange(series).pctChange).toBeCloseTo(0.5, 4);
  });

  it('gives the sparkline a spoken summary', () => {
    const change = calculateBalanceChange(series, 'Everyday');

    expect(change.summary).toBe('Everyday is up $500.00 over the last 3 months.');
  });

  it('describes a decline without alarm', () => {
    const falling = [snap('2026-03', 1500), snap('2026-04', 900)];

    expect(calculateBalanceChange(falling, 'Everyday').summary)
      .toBe('Everyday is down $600.00 over the last 2 months.');
  });
});

describe('missing history is not "no change"', () => {
  it('refuses on a single snapshot — one point is a position, not a trend', () => {
    const change = calculateBalanceChange([snap('2026-05', 1500)]);

    expect(change.available).toBe(false);
    expect(change.summary).toContain('Not enough history');
  });

  it('refuses on an empty series', () => {
    expect(calculateBalanceChange([]).available).toBe(false);
  });

  it('refuses when history did not load at all', () => {
    expect(calculateBalanceChange(undefined).available).toBe(false);
  });

  it('reports change as zero only alongside available: false', () => {
    const change = calculateBalanceChange(undefined);

    // The caller must branch on `available`, never read `change` on its own.
    expect(change.change).toBe(0);
    expect(change.available).toBe(false);
  });
});

describe('incompatible or disordered snapshots', () => {
  it('sorts by month before differencing, so order of arrival cannot flip the sign', () => {
    const shuffled = [snap('2026-05', 1500), snap('2026-03', 1000), snap('2026-04', 1200)];
    const ordered = [snap('2026-03', 1000), snap('2026-04', 1200), snap('2026-05', 1500)];

    expect(calculateBalanceChange(shuffled).change)
      .toBe(calculateBalanceChange(ordered).change);
    expect(calculateBalanceChange(shuffled).change).toBe(500);
  });

  it('drops entries without a usable month key', () => {
    const partial = [snap('2026-03', 1000), { month: '', balance: 99 } as MonthSnapshot];

    expect(calculateBalanceChange(partial).available).toBe(false);
  });

  it('reads whichever balance field the endpoint filled', () => {
    const viaNetWorth = [
      { month: '2026-03', net_worth: 400 } as MonthSnapshot,
      { month: '2026-04', net_worth: 700 } as MonthSnapshot,
    ];

    expect(calculateBalanceChange(viaNetWorth).change).toBe(300);
  });
});

describe('edge cases', () => {
  it('reports no percentage when the starting balance was zero', () => {
    const fromZero = [snap('2026-03', 0), snap('2026-04', 500)];
    const change = calculateBalanceChange(fromZero);

    expect(change.change).toBe(500);
    expect(change.pctChange).toBeNull();
  });

  it('says unchanged when the balance genuinely did not move', () => {
    const flat = [snap('2026-03', 1000), snap('2026-04', 1000)];
    const change = calculateBalanceChange(flat, 'Savings');

    expect(change.available).toBe(true);
    expect(change.change).toBe(0);
    expect(change.summary).toBe('Savings is unchanged over the last 2 months.');
  });

  it('handles a negative balance series, as a credit card produces', () => {
    const card = [snap('2026-03', -800), snap('2026-04', -300)];
    const change = calculateBalanceChange(card);

    // Debt fell by 500 — the sign is the caller's to interpret.
    expect(change.change).toBe(500);
  });
});

/**
 * Walked-back balances a complete ledger cannot produce. The live ledger had
 * no card payments and no transfers between accounts, so every history was
 * shifted: these are its actual six-month series, rounded.
 */
describe('an incomplete history', () => {
  const series = (...values: number[]) => values.map((v, i) => snap(`2026-0${i + 4}`, v));

  it('flags checking that walked back far below zero', () => {
    const spend = series(-14432, -9800, -5200, -1900, 300, 693);
    expect(calculateBalanceChange(spend, 'Spend', 'checking').incomplete).toBe(true);
  });

  it('flags a card that walked back deep into credit', () => {
    expect(calculateBalanceChange(series(5315, 3900, 2100, 900, 120, -385), 'VentureOne', 'credit_card').incomplete).toBe(true);
    expect(calculateBalanceChange(series(1444, 1100, 700, 300, 40, 0), 'Quicksilver', 'credit_card').incomplete).toBe(true);
  });

  it('leaves a real drop in savings alone', () => {
    const reserve = series(20361, 18000, 9500, 9000, 4000, 4000);
    expect(calculateBalanceChange(reserve, 'Reserve', 'savings').incomplete).toBe(false);
  });

  it('allows a small overdraft and a small card credit, which happen', () => {
    expect(historyLooksIncomplete('checking', [-80, 200])).toBe(false);
    expect(historyLooksIncomplete('credit_card', [-300, 35])).toBe(false);
    expect(historyLooksIncomplete('checking', [-IMPOSSIBLE_BALANCE_MARGIN - 1])).toBe(true);
  });

  it('does not judge accounts it has no rule for', () => {
    expect(historyLooksIncomplete('investment', [-9000])).toBe(false);
    expect(calculateBalanceChange(series(-9000, 0)).incomplete).toBe(false);
  });
});
