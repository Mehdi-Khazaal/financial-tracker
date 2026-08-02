/**
 * How an account balance reads to a person.
 *
 * The stored value stays exactly as it is — a credit card carries a negative
 * balance because that is what it is in accounting terms. Only the *rendering*
 * changes: `−$213.37` becomes `$213.37 owed`, which is the same fact without
 * asking the reader to remember a sign convention.
 *
 * Accounts and the Cards tab already say "Balance Owed" with a positive figure.
 * This module exists so Overview stops contradicting them.
 */

import type { Account } from '../../../types';
import { MINUS, dollars, percent } from '../../analytics/format';
import type { BalancePresentation } from '../types';

/** Amount owed on a card. Zero when the card is paid off or in credit. */
export const amountOwed = (account: Account): number =>
  Math.max(0, -Number(account.balance));

/** Total owed across every credit-card account. */
export const totalCardDebt = (accounts: Account[]): number =>
  accounts
    .filter(a => a.type === 'credit_card')
    .reduce((sum, a) => sum + amountOwed(a), 0);

/** Combined credit limit, or 0 when no card has one set. */
export const totalCreditLimit = (accounts: Account[]): number =>
  accounts
    .filter(a => a.type === 'credit_card')
    .reduce((sum, a) => sum + (Number(a.credit_limit) || 0), 0);

/**
 * Utilisation across all cards as a 0–100 percentage, or null when no limit is
 * recorded. Never inferred from spending — a limit the user has not entered is
 * simply unknown.
 */
export const cardUtilization = (accounts: Account[]): number | null => {
  const limit = totalCreditLimit(accounts);
  if (limit <= 0) return null;
  return (totalCardDebt(accounts) / limit) * 100;
};

export function describeBalance(account: Account): BalancePresentation {
  const balance = Number(account.balance) || 0;

  if (account.type === 'credit_card') {
    const limit = Number(account.credit_limit) || 0;

    if (balance < 0) {
      const owed = Math.abs(balance);
      const available = limit > 0 ? Math.max(0, limit - owed) : null;
      return {
        text: `${dollars(owed)} owed`,
        srText: `${dollars(owed)} owed`,
        tone: 'negative',
        // One fact, not three. A tile two columns wide on a small phone has
        // room for "$1,286.63 available" and nothing more.
        detail: available == null ? null : `${dollars(available)} available`,
      };
    }

    if (balance > 0) {
      // Overpaid, or a refund landed after the statement cleared.
      return {
        text: `${dollars(balance)} in credit`,
        srText: `${dollars(balance)} credit balance, nothing owed`,
        tone: 'positive',
        detail: limit > 0 ? `${dollars(limit)} limit` : null,
      };
    }

    return {
      text: 'Paid off',
      srText: 'Paid off, nothing owed',
      tone: 'positive',
      detail: limit > 0 ? `${dollars(limit)} available` : null,
    };
  }

  // Everything else: a negative balance is an overdraft and worth flagging.
  if (balance < 0) {
    return {
      text: `${MINUS}${dollars(Math.abs(balance))}`,
      srText: `Overdrawn by ${dollars(Math.abs(balance))}`,
      tone: 'negative',
      detail: 'Overdrawn',
    };
  }

  return {
    text: dollars(balance),
    srText: dollars(balance),
    tone: 'neutral',
    detail: null,
  };
}

/** `17.4% used` — the one extra fact worth showing beside a card total. */
export const utilizationLabel = (utilization: number | null): string | null =>
  utilization == null ? null : `${percent(utilization, 0, true)} of credit used`;
