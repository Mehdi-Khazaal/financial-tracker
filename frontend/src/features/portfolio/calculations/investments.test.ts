import type { Asset } from '../../../types';
import { tickerOf, valueAsset, valuePortfolio, type PriceMap } from './investments';

/**
 * Investment valuation regressions.
 *
 * The old headline is reproduced verbatim below so each assertion states the
 * difference rather than merely restating the new answer. Every test in the
 * "mixed holdings" block fails against it.
 */

let nextId = 1;
const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: nextId++,
  user_id: 1,
  name: 'Holding',
  type: 'stock',
  asset_class: 'investment',
  quantity: 1,
  value_per_unit: 100,
  total_value: 100,
  currency: 'USD',
  purchase_date: null,
  created_at: '',
  updated_at: '',
  ...overrides,
});

/** The implementation being replaced. */
const oldPortfolioValue = (assets: Asset[], prices: PriceMap): number => {
  const symbolOf = (a: Asset) =>
    a.name.match(/\(([A-Z0-9]+)\)/)?.[1]
    ?? (/^[A-Z0-9]{1,10}$/.test(a.name.trim()) ? a.name.trim() : null);
  const live = (a: Asset) => {
    const s = symbolOf(a);
    return s && prices[s] != null ? prices[s] : null;
  };
  const priceKnown = assets.filter(a => live(a) != null);
  const totalCurrent = priceKnown.reduce((s, a) => s + (live(a) as number) * Number(a.quantity ?? 1), 0);
  const totalCost = assets.reduce((s, a) => s + Number(a.total_value), 0);
  return priceKnown.length > 0 ? totalCurrent : totalCost;
};

// ── Mixed priced and unpriced ─────────────────────────────────────────────────

describe('mixed priced and unpriced holdings', () => {
  const vti = asset({ name: 'Vanguard ETF (VTI)', quantity: 40, value_per_unit: 250, total_value: 10000 });
  const gold = asset({ name: 'Gold bars', type: 'gold', quantity: 3, value_per_unit: 2000, total_value: 6000 });
  const bond = asset({ name: 'Treasury 2030', type: 'bond', quantity: 1, value_per_unit: 5000, total_value: 5000 });
  const holdings = [vti, gold, bond];
  const prices: PriceMap = { VTI: 268 };

  it('counts every holding, not just the priced one', () => {
    // VTI live: 40 × 268 = 10,720. Gold + bond recorded: 11,000.
    const result = valuePortfolio(holdings, prices);

    expect(result.total).toBeCloseTo(21720, 2);
    // The old headline reported only the tickered holding.
    expect(oldPortfolioValue(holdings, prices)).toBeCloseTo(10720, 2);
  });

  it('never reports less than the recorded total when prices have risen', () => {
    const result = valuePortfolio(holdings, prices);

    expect(result.total).toBeGreaterThan(result.recordedTotal);
    expect(oldPortfolioValue(holdings, prices)).toBeLessThan(result.recordedTotal);
  });

  it('separates the priced and unpriced parts of the total', () => {
    const result = valuePortfolio(holdings, prices);

    expect(result.pricedValue).toBeCloseTo(10720, 2);
    expect(result.unpricedRecordedValue).toBeCloseTo(11000, 2);
    expect(result.pricedValue + result.unpricedRecordedValue).toBeCloseTo(result.total, 6);
  });

  it('reports how much of the total is backed by a live price', () => {
    const result = valuePortfolio(holdings, prices);

    expect(result.pricedCount).toBe(1);
    expect(result.unpricedCount).toBe(2);
    expect(result.pricedShare).toBeCloseTo(10720 / 21720, 4);
  });

  it('measures change against priced holdings only', () => {
    const result = valuePortfolio(holdings, prices);

    // 10,720 − 10,000. The unpriced 11,000 contributes nothing either way,
    // because its change is unknown rather than zero.
    expect(result.changeSinceRecorded).toBeCloseTo(720, 2);
    expect(result.changePct).toBeCloseTo(0.072, 4);
  });
});

// ── All priced ────────────────────────────────────────────────────────────────

describe('all holdings priced', () => {
  const holdings = [
    asset({ name: 'Apple (AAPL)', quantity: 10, value_per_unit: 150, total_value: 1500 }),
    asset({ name: 'MSFT', quantity: 5, value_per_unit: 300, total_value: 1500 }),
  ];
  const prices: PriceMap = { AAPL: 180, MSFT: 280 };

  it('values everything live', () => {
    const result = valuePortfolio(holdings, prices);

    // 10 × 180 = 1,800 and 5 × 280 = 1,400.
    expect(result.total).toBeCloseTo(3200, 2);
    expect(result.unpricedRecordedValue).toBe(0);
    expect(result.unpricedCount).toBe(0);
  });

  it('agrees with the old behaviour in this case, which is why it went unnoticed', () => {
    expect(valuePortfolio(holdings, prices).total)
      .toBeCloseTo(oldPortfolioValue(holdings, prices), 2);
  });

  it('nets gains against losses', () => {
    const result = valuePortfolio(holdings, prices);

    // +300 on Apple, −100 on Microsoft.
    expect(result.changeSinceRecorded).toBeCloseTo(200, 2);
    expect(result.pricedShare).toBe(1);
  });
});

// ── All unpriced ──────────────────────────────────────────────────────────────

describe('no holding has a live price', () => {
  const holdings = [
    asset({ name: 'Gold bars', type: 'gold', quantity: 3, value_per_unit: 2000, total_value: 6000 }),
    asset({ name: 'Savings bond', type: 'bond', quantity: 1, value_per_unit: 1000, total_value: 1000 }),
  ];

  it('falls back to recorded values', () => {
    const result = valuePortfolio(holdings, {});

    expect(result.total).toBeCloseTo(7000, 2);
    expect(result.total).toBeCloseTo(result.recordedTotal, 6);
  });

  it('reports no change rather than a change of zero', () => {
    const result = valuePortfolio(holdings, {});

    expect(result.changeSinceRecorded).toBeNull();
    expect(result.changePct).toBeNull();
  });

  it('reports no priced share', () => {
    expect(valuePortfolio(holdings, {}).pricedShare).toBe(0);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('zero holdings', () => {
  it('totals to zero without dividing by anything', () => {
    const result = valuePortfolio([], { AAPL: 180 });

    expect(result.total).toBe(0);
    expect(result.recordedTotal).toBe(0);
    expect(result.count).toBe(0);
    expect(result.changeSinceRecorded).toBeNull();
    expect(result.pricedShare).toBeNull();
  });
});

describe('missing ticker', () => {
  it('treats a nameless-symbol holding as unpriced even when prices exist', () => {
    const holding = asset({ name: 'My rare coin collection', total_value: 900, quantity: 1, value_per_unit: 900 });
    const result = valueAsset(holding, { AAPL: 180 });

    expect(result.hasLivePrice).toBe(false);
    expect(result.currentValue).toBe(900);
    expect(result.changeSinceRecorded).toBeNull();
  });

  it('reads a bracketed ticker and a bare one', () => {
    expect(tickerOf(asset({ name: 'Vanguard ETF (VTI)' }))).toBe('VTI');
    expect(tickerOf(asset({ name: 'MSFT' }))).toBe('MSFT');
    expect(tickerOf(asset({ name: 'My Apartment' }))).toBeNull();
  });

  it('does not match a price that exists for a different symbol', () => {
    const holding = asset({ name: 'Tesla (TSLA)', quantity: 2, value_per_unit: 200, total_value: 400 });

    expect(valueAsset(holding, { AAPL: 180 }).hasLivePrice).toBe(false);
    expect(valueAsset(holding, { AAPL: 180 }).currentValue).toBe(400);
  });
});

describe('zero or missing recorded value', () => {
  it('survives a zero recorded value without producing Infinity', () => {
    const holding = asset({ name: 'Freebie (FREE)', quantity: 1, value_per_unit: 0, total_value: 0 });
    const result = valueAsset(holding, { FREE: 25 });

    expect(result.currentValue).toBe(25);
    expect(result.changeSinceRecorded).toBe(25);
    // A percentage against zero is undefined, not infinite.
    expect(result.changePct).toBeNull();
  });

  it('treats a null quantity as one unit', () => {
    const holding = asset({ name: 'Lump (LUMP)', quantity: null, value_per_unit: 500, total_value: 500 });

    expect(valueAsset(holding, { LUMP: 600 }).currentValue).toBe(600);
  });

  it('survives a null recorded value', () => {
    const holding = asset({ name: 'Unknown', quantity: null, value_per_unit: null, total_value: 0 });
    const result = valueAsset(holding, {});

    expect(Number.isFinite(result.currentValue)).toBe(true);
    expect(result.currentValue).toBe(0);
  });

  it('ignores a non-finite price rather than poisoning the total', () => {
    const holding = asset({ name: 'Broken (BRK)', quantity: 1, value_per_unit: 100, total_value: 100 });
    const result = valueAsset(holding, { BRK: Number.NaN });

    expect(result.hasLivePrice).toBe(false);
    expect(result.currentValue).toBe(100);
  });
});

describe('change since recorded, per holding', () => {
  it('is positive when the live price is above the recorded one', () => {
    const holding = asset({ name: 'Apple (AAPL)', quantity: 10, value_per_unit: 150, total_value: 1500 });
    const result = valueAsset(holding, { AAPL: 180 });

    expect(result.changeSinceRecorded).toBeCloseTo(300, 2);
    expect(result.changePct).toBeCloseTo(0.2, 4);
  });

  it('is negative when it is below', () => {
    const holding = asset({ name: 'Apple (AAPL)', quantity: 10, value_per_unit: 150, total_value: 1500 });
    const result = valueAsset(holding, { AAPL: 120 });

    expect(result.changeSinceRecorded).toBeCloseTo(-300, 2);
    expect(result.changePct).toBeCloseTo(-0.2, 4);
  });

  it('is null for an unpriced holding, never zero', () => {
    const holding = asset({ name: 'Gold bars', type: 'gold', quantity: 3, value_per_unit: 2000, total_value: 6000 });

    expect(valueAsset(holding, {}).changeSinceRecorded).toBeNull();
  });
});
