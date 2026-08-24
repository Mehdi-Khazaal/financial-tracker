/**
 * How an account balance reads to a person.
 *
 * The stored value stays exactly as it is — a credit card carries a negative
 * balance because that is what it is in accounting terms. Only the *rendering*
 * changes: `−$213.37` becomes `$213.37 owed`, which is the same fact without
 * asking the reader to remember a sign convention.
 *
 * Owned by the Accounts feature, which is where account arithmetic belongs.
 * Overview re-exports it from its old path so existing imports keep working.
 */

import type { Account } from '../../../types';
import { MINUS, dollars, percent } from '../../analytics/format';
import type { BalancePresentation } from '../../overview/types';

/**
 * Utilisation at or above this is worth surfacing. Centralised here so the
 * Morning Brief, the Accounts summary and the card tiles cannot drift into
 * three different opinions about what "high" means.
 */
export const HIGH_UTILIZATION = 80;

/** Utilisation bands, for status wording that never depends on colour alone. */
export type UtilizationBand = 'none' | 'low' | 'moderate' | 'high';

export function utilizationBand(utilization: number | null): UtilizationBand {
  if (utilization == null) return 'none';
  if (utilization >= HIGH_UTILIZATION) return 'high';
  if (utilization >= 30) return 'moderate';
  return 'low';
}

export const UTILIZATION_LABELS: Record<UtilizationBand, string> = {
  none: 'No limit recorded',
  low: 'Low use',
  moderate: 'Moderate use',
  high: 'High use',
};

/** Amount owed on a card. Zero when the card is paid off or in credit. */
export const amountOwed = (account: Account): number =>
  Math.max(0, -Number(account.balance));

/**
 * Spending room on a card, or null when no limit is recorded.
 *
 * `limit + balance`, because the balance already carries its direction: owing
 * $400 on a $1,000 card leaves $600, and being $42 *in credit* on the same
 * card leaves $1,042. Clamped at zero so a card over its limit reads as
 * nothing left rather than a negative amount of room.
 *
 * Exported because two places used to work this out for themselves — the card
 * tile and `describeBalance` — and they disagreed the moment a card went into
 * credit: the tile kept showing the bare limit and quietly dropped the
 * overpayment. A limit the user has not entered stays unknown; it is never
 * inferred.
 */
export const availableCredit = (account: Account): number | null => {
  const limit = Number(account.credit_limit) || 0;
  if (limit <= 0) return null;
  return Math.max(0, limit + Number(account.balance));
};

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
    // Every branch below asks `availableCredit` rather than working the limit
    // out again, so the three card states cannot disagree about spending room.
    if (balance < 0) {
      const owed = Math.abs(balance);
      const available = availableCredit(account);
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
      //
      // The detail line shows spending room, not the limit. Being $28.94 in
      // credit on a $300 card means $328.94 is available, and that is exactly
      // the moment the figure is worth knowing — showing the bare limit
      // dropped the overpayment back out of view.
      const available = availableCredit(account);
      return {
        text: `${dollars(balance)} in credit`,
        srText: `${dollars(balance)} credit balance, nothing owed`,
        tone: 'positive',
        detail: available == null ? null : `${dollars(available)} available`,
      };
    }

    const available = availableCredit(account);
    return {
      text: 'Paid off',
      srText: 'Paid off, nothing owed',
      tone: 'positive',
      detail: available == null ? null : `${dollars(available)} available`,
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
