/**
 * Canonical account population definitions.
 *
 * Before this module there were three different answers to "add up my
 * accounts", and they disagreed about the two things that matter most:
 *
 *   • The Accounts page summed `type !== 'credit_card'` — which silently
 *     dropped card debt from a figure sitting beside "Available to spend",
 *     and silently *included* investment-type accounts that the rest of the
 *     app treats as a separate pool.
 *   • Overview and Analytics summed `type !== 'investment'`, matching the
 *     backend's `/history/net-worth`, so card balances subtracted correctly.
 *
 * The second is the real definition — it is what the stored net-worth series
 * has always been built from, so it is the one that makes the number on the
 * dashboard match the number in the chart. This module states it once.
 *
 * Card helpers live alongside this file in `./cards` and are re-exported here
 * so callers have a single import for account arithmetic. The old
 * `features/overview/calculations/accounts` path survives as a thin re-export
 * for the Overview components that still import it.
 */

import type { Account } from '../../../types';
import {
  amountOwed,
  cardUtilization,
  totalCardDebt,
  totalCreditLimit,
} from './cards';

export { amountOwed, cardUtilization, totalCardDebt, totalCreditLimit };

/** Accounts you can spend from without moving anything first. */
export const SPENDABLE_TYPES: Account['type'][] = ['checking', 'cash'];

/** Spendable plus savings — money on hand, whether or not it is earmarked. */
export const LIQUID_TYPES: Account['type'][] = ['checking', 'savings', 'cash'];

/**
 * Accounts a savings goal can be earmarked against.
 *
 * Everything holding a positive balance, brokerage included — you can label
 * money in a brokerage account as being "for" a goal. Credit cards are out
 * because you cannot earmark a debt. This is deliberately *not* the net-worth
 * population: it answers "what could this goal point at", not "what am I
 * worth", and conflating the two is what made the Accounts hero wrong.
 */
export const ALLOCATABLE_TYPES: Account['type'][] = ['checking', 'savings', 'cash', 'investment'];

export interface AccountTotals {
  /**
   * Net worth: every account except `investment`, with credit-card balances
   * subtracting because they are stored negative. Matches Overview, Analytics
   * and the backend's `/history/net-worth` exactly.
   */
  netWorth: number;
  /** Checking + cash. */
  availableToSpend: number;
  /** Checking + savings + cash. */
  liquid: number;
  /** Everything a savings goal can be earmarked against — all but credit cards. */
  allocatable: number;
  /**
   * Balances held in `investment`-type *accounts* — brokerage cash and the
   * like. Excluded from net worth on purpose: holdings are tracked as assets
   * in Portfolio, and counting both would double the same money.
   */
  investmentAccounts: number;
  /** Positive total owed across credit cards. */
  cardDebt: number;
  /** Combined credit limit, 0 when no card has one recorded. */
  creditLimit: number;
  /** 0–100, or null when no limit is known. Never inferred. */
  utilization: number | null;
  /** How many accounts the totals were built from. */
  count: number;
}

const sumBalances = (accounts: Account[]): number =>
  accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

/** Sum of the balances of every account whose type is in `types`. */
export const sumByTypes = (accounts: Account[], types: Account['type'][]): number =>
  sumBalances(accounts.filter(a => types.includes(a.type)));

/**
 * Net worth from account balances alone.
 *
 * Exported on its own because it is the single most reused figure in the app —
 * Overview's hero, the Accounts summary and the net-worth chart must never be
 * able to drift apart.
 */
export const netWorthFromAccounts = (accounts: Account[]): number =>
  sumBalances(accounts.filter(a => a.type !== 'investment'));

export function calculateAccountTotals(accounts: Account[]): AccountTotals {
  return {
    netWorth: netWorthFromAccounts(accounts),
    availableToSpend: sumByTypes(accounts, SPENDABLE_TYPES),
    liquid: sumByTypes(accounts, LIQUID_TYPES),
    allocatable: sumByTypes(accounts, ALLOCATABLE_TYPES),
    investmentAccounts: sumByTypes(accounts, ['investment']),
    cardDebt: totalCardDebt(accounts),
    creditLimit: totalCreditLimit(accounts),
    utilization: cardUtilization(accounts),
    count: accounts.length,
  };
}
