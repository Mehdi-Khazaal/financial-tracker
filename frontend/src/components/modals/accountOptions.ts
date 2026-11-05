import type { Account } from '../../types';
import { autoDollars, dollars } from '../../features/analytics/format';

/**
 * The text of an account `<option>` in the money-moving sheets.
 *
 * The sheets used to print `$${balance.toFixed(2)}`, which read
 * "Everyday Checking ($22039.69)" and "Venture Card ($-2773.05)". A card
 * says what it owes rather than showing a negative balance, and can be in
 * credit, so the label follows the sign rather than assuming debt.
 */
export function accountOptionLabel(account: Pick<Account, 'name' | 'type' | 'balance'>): string {
  const balance = Number(account.balance);
  if (account.type === 'credit_card' && balance !== 0) {
    return balance > 0
      ? `${account.name} (${dollars(balance)} in credit)`
      : `${account.name} (owes ${dollars(balance)})`;
  }
  return `${account.name} (${autoDollars(balance)})`;
}
