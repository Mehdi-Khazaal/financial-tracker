/**
 * Investment valuation.
 *
 * Two things this module exists to correct.
 *
 * **The headline used to drop holdings.** Portfolio Value was
 * `pricedCount > 0 ? sumOfPricedCurrentValues : sumOfAllRecordedValues` — so
 * the moment a single holding had a ticker, the total silently narrowed to
 * *only* the priced ones while "Invested" beside it still counted everything.
 * Five holdings worth $50k with one tickered ETF displayed a portfolio of
 * $8,000. Gold, bonds and anything untickered vanished from the number.
 *
 * The honest total adds both populations: live value where a price is known,
 * recorded value where it is not. An unpriced holding contributes exactly what
 * the user said it was worth — no more, and never zero.
 *
 * **"Gain / Loss" was never a gain.** `total_value` is captured once, when the
 * asset is added, from fields labelled "Price / unit" and "Total Value" — the
 * value *at the moment of recording*, not a purchase price. `purchase_date` is
 * optional and never enters the arithmetic, there is no edit path to correct a
 * recorded value afterwards, and no market history is stored. So the figure is
 * "change since you recorded this", and that is what it is now called.
 */

import type { Asset } from '../../../types';

/** Live prices by ticker symbol, as `PortfolioPage` caches them. */
export type PriceMap = Record<string, number>;

/**
 * Ticker extracted from an asset name — `Vanguard ETF (VTI)` → `VTI`, or a
 * bare `VTI`. Mirrors the lookup the page has always used.
 */
export function tickerOf(asset: Asset): string | null {
  const name = asset.name ?? '';
  const bracketed = name.match(/\(([A-Z0-9]+)\)/)?.[1];
  if (bracketed) return bracketed;
  const trimmed = name.trim();
  return /^[A-Z0-9]{1,10}$/.test(trimmed) ? trimmed : null;
}

export interface AssetValuation {
  asset: Asset;
  /** True when a live price was found for this holding's ticker. */
  hasLivePrice: boolean;
  /** Live price when known, otherwise the recorded price per unit. */
  pricePerUnit: number;
  /** What the holding is worth now: live value when priced, recorded when not. */
  currentValue: number;
  /** What the user recorded when adding it. */
  recordedValue: number;
  /**
   * `currentValue − recordedValue`, but only when a live price exists.
   * Null for an unpriced holding, because there is nothing to compare against
   * — its current value *is* its recorded value, and reporting a change of
   * zero would imply the market had been checked.
   */
  changeSinceRecorded: number | null;
  /** Fractional change, or null when unpriced or the recorded value was zero. */
  changePct: number | null;
}

export function valueAsset(asset: Asset, prices: PriceMap): AssetValuation {
  const ticker = tickerOf(asset);
  const livePrice = ticker != null ? prices[ticker] : undefined;
  const hasLivePrice = typeof livePrice === 'number' && Number.isFinite(livePrice);

  const recordedValue = Number(asset.total_value) || 0;
  const recordedPerUnit = Number(asset.value_per_unit) || 0;
  const pricePerUnit = hasLivePrice ? (livePrice as number) : recordedPerUnit;

  // Quantity defaults to 1 so a holding recorded as a lump sum still values.
  const quantity = Number(asset.quantity ?? 1) || 0;
  const currentValue = hasLivePrice ? pricePerUnit * quantity : recordedValue;

  const changeSinceRecorded = hasLivePrice ? currentValue - recordedValue : null;

  return {
    asset,
    hasLivePrice,
    pricePerUnit,
    currentValue,
    recordedValue,
    changeSinceRecorded,
    changePct: changeSinceRecorded != null && recordedValue > 0
      ? changeSinceRecorded / recordedValue
      : null,
  };
}

export interface PortfolioValuation {
  holdings: AssetValuation[];
  /**
   * The headline. Live value for priced holdings plus recorded value for the
   * rest — every holding counted exactly once.
   */
  total: number;
  /** What every holding was recorded at, for comparison with `total`. */
  recordedTotal: number;
  /** Combined current value of the holdings that have a live price. */
  pricedValue: number;
  /** Combined recorded value of the holdings that do not. */
  unpricedRecordedValue: number;
  pricedCount: number;
  unpricedCount: number;
  count: number;
  /**
   * Change across priced holdings only, or null when none are priced.
   * Deliberately not blended with unpriced holdings, whose change is unknown
   * rather than zero.
   */
  changeSinceRecorded: number | null;
  changePct: number | null;
  /** Share of `total` that is backed by a live price, 0–1. Null when empty. */
  pricedShare: number | null;
}

export function valuePortfolio(assets: Asset[], prices: PriceMap): PortfolioValuation {
  const holdings = assets.map(a => valueAsset(a, prices));

  const priced = holdings.filter(h => h.hasLivePrice);
  const unpriced = holdings.filter(h => !h.hasLivePrice);

  const pricedValue = priced.reduce((s, h) => s + h.currentValue, 0);
  const unpricedRecordedValue = unpriced.reduce((s, h) => s + h.recordedValue, 0);
  const total = pricedValue + unpricedRecordedValue;
  const recordedTotal = holdings.reduce((s, h) => s + h.recordedValue, 0);

  const pricedRecorded = priced.reduce((s, h) => s + h.recordedValue, 0);
  const changeSinceRecorded = priced.length > 0 ? pricedValue - pricedRecorded : null;

  return {
    holdings,
    total,
    recordedTotal,
    pricedValue,
    unpricedRecordedValue,
    pricedCount: priced.length,
    unpricedCount: unpriced.length,
    count: holdings.length,
    changeSinceRecorded,
    changePct: changeSinceRecorded != null && pricedRecorded > 0
      ? changeSinceRecorded / pricedRecorded
      : null,
    pricedShare: total > 0 ? pricedValue / total : null,
  };
}

/** Wording for what the change figure actually measures. */
export const CHANGE_SINCE_RECORDED_DEFINITION =
  'Compares the current known value against the value recorded when the holding was added. '
  + 'It is not a verified tax cost basis, and it is not investment-performance history — '
  + 'Fintrack stores no market history, only the latest price for holdings with a ticker. '
  + 'Holdings without a live price are excluded from this figure, because their change is unknown rather than zero.';

/** Wording for how the portfolio total is assembled. */
export const PORTFOLIO_TOTAL_DEFINITION =
  'Live market value for holdings with a ticker, plus the recorded value for holdings without one. '
  + 'Every holding is counted exactly once. A holding without a live price contributes what you recorded — '
  + 'Fintrack does not estimate a current price for it.';
