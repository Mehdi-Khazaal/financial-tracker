/**
 * Upcoming bills and subscription insight.
 *
 * Declared `RecurringTransaction` rows are the source of truth — the user told
 * us these repeat, so we can state their dates and amounts plainly. Finding
 * *undeclared* recurring charges is the server's job (`GET /recurring/overview`
 * returns them as suggestions), so every screen reports the same ones; this
 * module only reshapes those suggestions for Analytics.
 */

import type { Account, Category, RecurringSuggestion, RecurringTransaction, Transaction } from '../../../types';
import { RECURRING_GROUPS, groupOf } from '../../recurring/groups';
import type {
  ClassificationContext,
  DetectedSubscription,
  RecurringCharge,
  RecurringGroup,
  RecurringMonth,
  RecurringOutlook,
  SubscriptionInsight,
  UpcomingBill,
} from '../types';
import { dateKey, daysBetween } from '../period';
import { classifyTransaction, merchantKeyOf, normalizeMerchantName } from './transactions';

/** How many times a period fires per month, for normalising to a monthly cost. */
const MONTHLY_FACTOR: Record<RecurringTransaction['period'], number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export const monthlyEquivalent = (amount: number, period: RecurringTransaction['period']): number =>
  Math.abs(amount) * (MONTHLY_FACTOR[period] ?? 1);

/** Active recurring expenses only — income schedules are not a cost. */
export const activeRecurringExpenses = (recurring: RecurringTransaction[]): RecurringTransaction[] =>
  recurring.filter(r => r.is_active && Number(r.amount) < 0);

/**
 * Monthly-normalised total of every declared recurring expense.
 *
 * Shared by the recurring card, the health score and the forecast — three
 * places that must never quote different figures for the same commitment.
 */
export const monthlyRecurringExpense = (recurring: RecurringTransaction[]): number =>
  activeRecurringExpenses(recurring)
    .reduce((sum, r) => sum + monthlyEquivalent(Number(r.amount), r.period), 0);

/** Advance a recurring date by one cycle, matching the backend's `_next_date`. */
function nextOccurrence(iso: string, period: RecurringTransaction['period']): string {
  const d = new Date(`${iso}T00:00:00`);
  if (period === 'weekly') d.setDate(d.getDate() + 7);
  else if (period === 'biweekly') d.setDate(d.getDate() + 14);
  else if (period === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (period === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (period === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else return iso;
  return dateKey(d);
}

/**
 * Every charge expected between today and `horizonDays` out, including repeat
 * firings of short-period bills (a weekly bill appears four times in 30 days).
 */
export function upcomingBills(
  recurring: RecurringTransaction[],
  options: {
    accounts: Account[];
    categories: Category[];
    today: Date;
    horizonDays?: number;
  },
): UpcomingBill[] {
  const horizon = options.horizonDays ?? 30;
  const todayKey = dateKey(options.today);
  const accountName = new Map(options.accounts.map(a => [a.id, a.name]));
  const categoryById = new Map(options.categories.map(c => [c.id, c]));

  const bills: UpcomingBill[] = [];
  recurring.forEach(rec => {
    if (!rec.is_active) return;
    if (Number(rec.amount) >= 0) return; // income schedules aren't bills

    const category = rec.category_id != null ? categoryById.get(rec.category_id) : undefined;
    let cursor = rec.next_date.slice(0, 10);

    // An overdue bill is still owed — surface it rather than skipping ahead.
    for (let i = 0; i < 12; i += 1) {
      const daysUntil = daysBetween(todayKey, cursor);
      if (daysUntil > horizon) break;
      if (daysUntil >= -14) {
        bills.push({
          id: rec.id,
          name: rec.description || category?.name || 'Recurring charge',
          amount: Math.abs(Number(rec.amount)),
          dueDate: cursor,
          daysUntil,
          period: rec.period,
          isVariable: rec.is_variable,
          categoryName: category?.name ?? null,
          categoryColor: category?.color ?? 'var(--muted)',
          accountName: accountName.get(rec.account_id) ?? null,
        });
      }
      cursor = nextOccurrence(cursor, rec.period);
    }
  });

  return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Server suggestions (expenses only) in the shape the Analytics card reads. */
export function suggestionsToDetected(suggestions: RecurringSuggestion[]): DetectedSubscription[] {
  return suggestions
    .filter(s => !s.is_income)
    .map(s => ({
      key: s.identity,
      name: s.name,
      monthlyAmount: Math.abs(Number(s.monthly_amount) || 0),
      occurrences: s.occurrences,
      period: s.period,
      lastSeen: s.last_date,
    }))
    .sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

/** Declared subscriptions whose amount rose since the previous comparable charge. */
function findIncreases(
  recurring: RecurringTransaction[],
  transactions: Transaction[],
  ctx: ClassificationContext,
): SubscriptionInsight['increased'] {
  const out: SubscriptionInsight['increased'] = [];
  recurring.forEach(rec => {
    if (!rec.is_active || Number(rec.amount) >= 0) return;
    const key = normalizeMerchantName(rec.description);
    if (!key) return;
    const charges = transactions
      .filter(t => classifyTransaction(t, ctx) === 'expense' && merchantKeyOf(t) === key)
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    if (charges.length < 2) return;

    const latest = Math.abs(Number(charges[charges.length - 1].amount));
    const prior = Math.abs(Number(charges[charges.length - 2].amount));
    // Ignore rounding-level drift; report only a real price change.
    if (latest > prior && latest - prior >= Math.max(0.5, prior * 0.02)) {
      out.push({ name: rec.description || 'Subscription', from: prior, to: latest, delta: latest - prior });
    }
  });
  return out.sort((a, b) => b.delta - a.delta).slice(0, 3);
}

/**
 * Services that may overlap. Matches only on a shared leading word between
 * distinct entries — enough to surface "Netflix" vs "Netflix Premium", not
 * enough to merge unrelated businesses.
 */
function findPossibleDuplicates(names: string[]): SubscriptionInsight['possibleDuplicates'] {
  const byFirstWord = new Map<string, string[]>();
  names.forEach(name => {
    const first = normalizeMerchantName(name).split(' ')[0];
    if (!first || first.length < 4) return;
    const list = byFirstWord.get(first) ?? [];
    if (!list.includes(name)) list.push(name);
    byFirstWord.set(first, list);
  });

  const out: SubscriptionInsight['possibleDuplicates'] = [];
  byFirstWord.forEach(list => {
    if (list.length > 1) {
      out.push({ names: list, note: 'These look like they could be the same service.' });
    }
  });
  return out.slice(0, 2);
}

/**
 * Group declared recurring charges by what they are — housing, utilities,
 * subscriptions — using the group the server assigned (and the user may have
 * moved), in the same order the Recurring page lists them.
 */
export function groupRecurringCharges(
  recurring: RecurringTransaction[],
  categories: Category[],
): RecurringGroup[] {
  const categoryById = new Map(categories.map(c => [c.id, c]));

  const charges: RecurringCharge[] = recurring
    .filter(r => r.is_active && Number(r.amount) < 0)
    .map(r => {
      const category = r.category_id != null ? categoryById.get(r.category_id) : undefined;
      const amount = Math.abs(Number(r.amount));
      return {
        id: r.id,
        name: r.description || category?.name || 'Recurring charge',
        kind: groupOf(r),
        amount,
        monthlyAmount: monthlyEquivalent(amount, r.period),
        period: r.period,
        isVariable: r.is_variable,
        categoryName: category?.name ?? null,
        categoryColor: category?.color ?? 'var(--muted)',
        nextDate: r.next_date.slice(0, 10),
      };
    });

  return RECURRING_GROUPS
    .filter(group => group.key !== 'income')
    .map(group => {
      const matching = charges
        .filter(c => c.kind === group.key)
        .sort((a, b) => b.monthlyAmount - a.monthlyAmount);
      return {
        kind: group.key,
        label: group.label,
        description: '',
        charges: matching,
        monthlyTotal: matching.reduce((s, c) => s + c.monthlyAmount, 0),
      };
    })
    .filter(group => group.charges.length > 0);
}

export function buildRecurringOutlook(options: {
  recurring: RecurringTransaction[];
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  ctx: ClassificationContext;
  today: Date;
  /** Undeclared recurring charges found by the server; omitted when unavailable. */
  suggestions?: RecurringSuggestion[];
  /** This calendar month's recurring cost from the server, when available. */
  thisMonth?: RecurringMonth | null;
}): RecurringOutlook {
  const { recurring, transactions, accounts, categories, ctx, today, suggestions = [], thisMonth = null } = options;

  const upcoming = upcomingBills(recurring, { accounts, categories, today });
  const within30 = upcoming.filter(b => b.daysUntil >= 0 && b.daysUntil <= 30);

  const activeExpenses = activeRecurringExpenses(recurring);
  const monthlyTotal = monthlyRecurringExpense(recurring);

  const increased = findIncreases(activeExpenses, transactions, ctx);
  // The previous total is today's total less any increases we can evidence.
  const previousMonthlyTotal = increased.length > 0
    ? monthlyTotal - increased.reduce((s, i) => s + i.delta, 0)
    : null;

  const subscriptions: SubscriptionInsight = {
    monthlyTotal,
    previousMonthlyTotal,
    annualized: monthlyTotal * 12,
    count: activeExpenses.length,
    groups: groupRecurringCharges(recurring, categories),
    increased,
    possibleDuplicates: findPossibleDuplicates(
      activeExpenses.map(r => r.description ?? '').filter(Boolean),
    ),
    detected: suggestionsToDetected(suggestions),
    thisMonth,
  };

  return {
    upcoming,
    next30DaysTotal: within30.reduce((s, b) => s + b.amount, 0),
    next30DaysCount: within30.length,
    subscriptions,
  };
}
