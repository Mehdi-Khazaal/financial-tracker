import type { RecurringGroupKey, RecurringTransaction } from '../../types';

/**
 * The recurring groups, in display order. Must stay in step with
 * `backend/services/recurring_groups.py` — the server assigns the group, this
 * list only names and orders them for screens that group client-side.
 */
export const RECURRING_GROUPS: { key: RecurringGroupKey; label: string }[] = [
  { key: 'housing', label: 'Housing' },
  { key: 'utilities', label: 'Utilities' },
  { key: 'phone_internet', label: 'Phone & internet' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'loans_cards', label: 'Loans & cards' },
  { key: 'transport', label: 'Transport' },
  { key: 'other', label: 'Other' },
  { key: 'income', label: 'Income' },
];

export const RECURRING_GROUP_LABEL: Record<RecurringGroupKey, string> = Object.fromEntries(
  RECURRING_GROUPS.map(g => [g.key, g.label]),
) as Record<RecurringGroupKey, string>;

/** A row's group. Rows the server has not grouped yet fall back to other / income. */
export const groupOf = (row: Pick<RecurringTransaction, 'group_key' | 'amount'>): RecurringGroupKey =>
  row.group_key ?? (Number(row.amount) > 0 ? 'income' : 'other');
