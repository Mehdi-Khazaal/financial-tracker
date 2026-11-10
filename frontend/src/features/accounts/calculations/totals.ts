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

import type { Account, SavingsGoal } from '../../../types';
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
   * The account part of net worth: every account except `investment`, with
   * credit-card balances subtracting because they are stored negative. Net
   * worth itself adds holdings — see `calculateNetWorth` in
   * `features/portfolio/calculations/wealth`.
   */
  netBalance: number;
  /**
   * Checking + cash, less whatever is set aside there for any goal — the
   * emergency fund included, since it is not everyday money either. It used
   * to ignore goals, so a cash account set aside entirely for a trip counted
   * as spendable.
   */
  availableToSpend: number;
  /** Checking + savings + cash, earmarked or not. */
  liquid: number;
  /** Goal money held in checking, savings and cash. */
  setAside: number;
  /**
   * Checking + savings + cash, less what is set aside for goals other than
   * the emergency fund: the cash you could fall back on. The emergency-fund
   * cover ratio is built on this, not on `liquid`.
   */
  emergencyCash: number;
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
 * The account part of net worth.
 *
 * Net worth is this plus holdings (`calculateNetWorth`). Kept on its own
 * because it is also what `/history/net-worth` reports as `accounts`, and the
 * two must never drift apart.
 */
export const netWorthFromAccounts = (accounts: Account[]): number =>
  sumBalances(accounts.filter(a => a.type !== 'investment'));

/**
 * What an account frees once goal money is taken out. Clamped per account: an
 * account cannot free more than it holds, and over-allocating one account does
 * not reach into another. An overdraft still counts against you as it is.
 */
const freeIn = (balance: number, promised: number): number =>
  balance <= 0 ? balance : Math.max(0, balance - promised);

/** Goal money per account, for all goals and for goals other than the emergency fund. */
function promisedByAccount(goals: SavingsGoal[]) {
  const all = new Map<number, number>();
  const others = new Map<number, number>();
  goals.forEach(goal => {
    (goal.allocations ?? []).forEach(a => {
      const amount = Number(a.amount) || 0;
      all.set(a.account_id, (all.get(a.account_id) ?? 0) + amount);
      if (!goal.is_emergency_fund) others.set(a.account_id, (others.get(a.account_id) ?? 0) + amount);
    });
  });
  return { all, others };
}

/**
 * Account totals. Pass the goals wherever "available to spend" or the
 * emergency fund is shown: without them, goal money is treated as free. The
 * server applies the same rules in `services/cash_position.py`.
 */
export function calculateAccountTotals(accounts: Account[], goals: SavingsGoal[] = []): AccountTotals {
  const promised = promisedByAccount(goals);
  let availableToSpend = 0;
  let setAside = 0;
  let emergencyCash = 0;
  accounts.forEach(account => {
    if (!LIQUID_TYPES.includes(account.type)) return;
    const balance = Number(account.balance) || 0;
    setAside += promised.all.get(account.id) ?? 0;
    emergencyCash += freeIn(balance, promised.others.get(account.id) ?? 0);
    if (SPENDABLE_TYPES.includes(account.type)) {
      availableToSpend += freeIn(balance, promised.all.get(account.id) ?? 0);
    }
  });
  return {
    netBalance: netWorthFromAccounts(accounts),
    availableToSpend,
    liquid: sumByTypes(accounts, LIQUID_TYPES),
    setAside,
    emergencyCash,
    allocatable: sumByTypes(accounts, ALLOCATABLE_TYPES),
    investmentAccounts: sumByTypes(accounts, ['investment']),
    cardDebt: totalCardDebt(accounts),
    creditLimit: totalCreditLimit(accounts),
    utilization: cardUtilization(accounts),
    count: accounts.length,
  };
}
