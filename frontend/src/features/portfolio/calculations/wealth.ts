/**
 * Everything you own, in one figure.
 *
 * Net worth in Fintrack is deliberately *account balances only* — see
 * `netWorthFromAccounts` in `features/accounts/calculations/totals.ts`, which
 * the backend's `/history/net-worth` matches exactly and which the stored
 * snapshot series has always been built from. Portfolio holdings sit outside
 * it, so buying an ounce of gold drops net worth by the price and the gold
 * never adds it back.
 *
 * That definition is not changed here, and must not be: the snapshot history,
 * the Overview hero and both charts are built on it, and moving it would
 * silently restate every past month. This module adds a *second, wider* figure
 * beside it instead, and composes the two canonical functions rather than
 * recomputing either.
 *
 * The dependency runs Portfolio → Accounts. Do not add the inverse import;
 * account arithmetic must stay ignorant of holdings.
 */

import type { Account, Asset } from '../../../types';
import { netWorthFromAccounts } from '../../accounts/calculations/totals';
import { valuePortfolio, type PriceMap } from './investments';

export interface TotalWealth {
  /** Account balances excluding `investment` accounts. The unchanged definition. */
  netWorth: number;
  /** Holdings, live-priced where a ticker resolves and recorded value elsewhere. */
  portfolioValue: number;
  /** The two combined. */
  total: number;
  /**
   * Share of `portfolioValue` backed by a live price, 0–1, or null when there
   * are no holdings. Passed through so a caller can caveat the total honestly
   * instead of implying every holding is marked to market.
   */
  pricedShare: number | null;
  /** How many holdings contributed. */
  holdingCount: number;
}

/**
 * Accounts plus holdings.
 *
 * `prices` may be empty, and Overview passes it empty on purpose — it makes no
 * market calls, so every holding contributes its recorded value there while
 * Portfolio shows the live-priced version. Same function, two inputs, no second
 * definition.
 */
export function totalWealth(
  accounts: Account[],
  assets: Asset[],
  prices: PriceMap = {},
): TotalWealth {
  const netWorth = netWorthFromAccounts(accounts);
  const valuation = valuePortfolio(assets, prices);
  return {
    netWorth,
    portfolioValue: valuation.total,
    total: netWorth + valuation.total,
    pricedShare: valuation.pricedShare,
    holdingCount: valuation.count,
  };
}
