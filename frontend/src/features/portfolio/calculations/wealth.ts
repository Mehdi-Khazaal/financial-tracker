/**
 * Net worth: one figure, the same on every screen.
 *
 *     net worth = account balances + holdings
 *
 * Account balances are `netWorthFromAccounts` (every account except
 * investment-type ones, cards subtracting). Holdings are every asset at the
 * server's current valuation — a market price where one is stored, the
 * recorded value otherwise. The backend defines the same sum in
 * `services/net_worth.py`, and `/history/net-worth` charts it month by month,
 * counting each holding from the day it was acquired.
 *
 * Net worth used to be account balances only, with holdings shown as a second
 * "including holdings" line. Buying gold with cash then read as losing the
 * full price, and two different "net worth" figures sat on every screen. Now
 * converting cash into an asset leaves net worth where it was.
 *
 * The dependency runs Portfolio → Accounts. Do not add the inverse import;
 * account arithmetic must stay ignorant of holdings.
 */

import type { Account, Asset, MonthSnapshot } from '../../../types';
import { netWorthFromAccounts } from '../../accounts/calculations/totals';
import { NO_VALUATIONS, valuePortfolio, type Valuations } from './investments';

export interface NetWorthBreakdown {
  /** Account balances, cards subtracting, investment-type accounts excluded. */
  accounts: number;
  /** Every holding at its current value. */
  holdings: number;
  /** The net worth. */
  total: number;
  /**
   * Share of `holdings` backed by a market price, 0–1, or null when nothing is
   * held. Passed through so a caller can say how much is marked to market.
   */
  pricedShare: number | null;
  /** How many holdings contributed. */
  holdingCount: number;
}

export function calculateNetWorth(
  accounts: Account[],
  assets: Asset[],
  valuations: Valuations = NO_VALUATIONS,
): NetWorthBreakdown {
  const accountPart = netWorthFromAccounts(accounts);
  const valuation = valuePortfolio(assets, valuations);
  return {
    accounts: accountPart,
    holdings: valuation.total,
    total: accountPart + valuation.total,
    pricedShare: valuation.pricedShare,
    holdingCount: valuation.count,
  };
}

/**
 * The net-worth series with this month's point set to the live figure.
 *
 * The server already charts the month in progress from today's balances, but
 * the screen and the series are fetched separately, so a sync or a price
 * refresh between the two requests could still leave the chart's last point a
 * few dollars off the number printed above it. Overwriting it here makes "now"
 * on the chart the same number as "now" on the page by construction.
 *
 * A series that ends before this month gains a point for it; an empty series
 * stays empty, because one point is a position rather than a history.
 */
export function withCurrentNetWorth(
  snapshots: MonthSnapshot[],
  current: NetWorthBreakdown,
  monthKey: string,
): MonthSnapshot[] {
  if (snapshots.length === 0) return snapshots;
  const point: MonthSnapshot = {
    month: monthKey,
    net_worth: current.total,
    accounts: current.accounts,
    holdings: current.holdings,
  };
  const last = snapshots[snapshots.length - 1];
  if (last.month === monthKey) return [...snapshots.slice(0, -1), point];
  if (last.month < monthKey) return [...snapshots, point];
  return snapshots;
}
