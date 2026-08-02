/**
 * The single "what should I look at next" line on Overview.
 *
 * Deliberately one item, deterministic, and no AI call anywhere near it. The
 * Analytics tab already has a scored list of spending observations; repeating a
 * shortened version of that here would just be two lists disagreeing about
 * which one matters. This answers a different question — *is anything waiting
 * on me right now* — so the candidates are states, not trends.
 *
 * Two rules keep it from becoming noise:
 *
 *   1. Nothing that is simply normal counts as attention. Carrying a card
 *      balance is how credit cards work; it is reported, not scolded.
 *   2. Every candidate must resolve on its own. "Your goal is complete" would
 *      be true forever, so goals are framed as the next one to reach instead.
 */

import type { Account, SavingsGoal } from '../../../types';
import { dollars, monthLabel, plural, verbFor } from '../../analytics/format';
import { selectPrimaryGoal } from '../../analytics/calculations/savings';
import type { MonthActivity, StatusInsight } from '../types';
import { cardUtilization, totalCardDebt } from './accounts';

/** Utilisation at or above this is worth mentioning; below it is unremarkable. */
export const HIGH_UTILIZATION = 80;

/** `"2027-09-01"` → `"Sep 1, 2027"`. */
const targetDateLabel = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export interface StatusInsightOptions {
  today: Date;
  activity: MonthActivity;
  /** True when any source failed to load. */
  dataIncomplete: boolean;
  /** Imported transactions with no category, across all months. */
  unreviewedCount: number;
  accounts: Account[];
  goals: SavingsGoal[];
  /** Subscription-shaped charges found in history but never declared. */
  undeclaredRecurringCount: number;
  /** Income minus expenses for the most recent completed month. */
  lastCompleted: { month: string; net: number } | null;
  /**
   * True when the hero is already displaying the beginning-of-month context.
   *
   * The hero explains why the numbers read zero; the insight says what to look
   * at next. When both would print the same sentence the insight yields, so a
   * quiet month produces one message rather than an echo.
   */
  heroShowsActivityContext?: boolean;
}

/**
 * Every candidate that currently applies, most important first. Exported for
 * testing the priority order; the page renders `buildStatusInsight`.
 */
export function statusInsightCandidates(options: StatusInsightOptions): StatusInsight[] {
  const {
    today, activity, dataIncomplete, unreviewedCount,
    accounts, goals, undeclaredRecurringCount, lastCompleted,
    heroShowsActivityContext = false,
  } = options;

  const candidates: StatusInsight[] = [];

  // 1 — Something is missing, so nothing below can be stated with confidence.
  if (dataIncomplete) {
    candidates.push({
      id: 'data-incomplete',
      priority: 1,
      tone: 'attention',
      title: 'Showing partial data',
      detail: 'Some information could not be loaded, so these figures may be out of date.',
      action: null,
    });
  }

  // 2 — Imports waiting to be filed. The one thing only the user can resolve.
  if (unreviewedCount > 0) {
    candidates.push({
      id: 'unreviewed-imports',
      priority: 2,
      tone: 'attention',
      title: `${plural(unreviewedCount, 'imported transaction')} still ${verbFor(unreviewedCount, 'need')} a category`,
      detail: 'Categorizing them keeps spending totals and category trends accurate.',
      action: { label: 'Review imports', to: '/transactions', tab: 'transactions' },
    });
  }

  // 3 — Account conditions that are genuinely wrong, not merely non-zero.
  const overdrawn = accounts.filter(a => a.type !== 'credit_card' && Number(a.balance) < 0);
  if (overdrawn.length > 0) {
    candidates.push({
      id: 'overdrawn',
      priority: 3,
      tone: 'attention',
      title: overdrawn.length === 1
        ? `${overdrawn[0].name} is overdrawn`
        : `${plural(overdrawn.length, 'account')} are overdrawn`,
      detail: `${dollars(overdrawn.reduce((s, a) => s + Math.abs(Number(a.balance)), 0))} below zero in total.`,
      action: { label: 'Open accounts', to: '/accounts', tab: 'wallet' },
    });
  }

  const utilization = cardUtilization(accounts);
  if (utilization != null && utilization >= HIGH_UTILIZATION) {
    candidates.push({
      id: 'high-utilization',
      priority: 4,
      tone: 'attention',
      title: `Credit use is at ${utilization.toFixed(0)}% of your limit`,
      detail: 'Balances this close to the limit can affect available credit.',
      action: { label: 'Open cards', to: '/accounts', tab: 'cards' },
    });
  }

  // 5 — Charges that look recurring but were never confirmed as such.
  if (undeclaredRecurringCount > 0) {
    candidates.push({
      id: 'recurring-review',
      priority: 5,
      tone: 'neutral',
      title: `${plural(undeclaredRecurringCount, 'possible recurring charge')} to confirm`,
      detail: 'Confirming them improves upcoming-bill estimates.',
      action: { label: 'Review recurring', to: '/transactions', tab: 'recurring' },
    });
  }

  // 6 — The next goal. Framed as distance remaining so it resolves when reached.
  const primary = selectPrimaryGoal(goals, null, today);
  if (primary) {
    const allComplete = goals.length > 0 && primary.remaining <= 0;
    candidates.push(allComplete
      ? {
        id: 'goals-complete',
        priority: 6,
        tone: 'positive',
        title: goals.length === 1
          ? `Your ${primary.name} goal is complete`
          : 'Every savings goal is complete',
        detail: null,
        action: { label: 'Open goals', to: '/portfolio', tab: 'savings' },
      }
      : {
        id: 'goal-next',
        priority: 6,
        tone: 'neutral',
        title: `${dollars(primary.remaining)} to go on ${primary.name}`,
        detail: primary.deadline ? `Target date ${targetDateLabel(primary.deadline)}.` : null,
        action: { label: 'Open goals', to: '/portfolio', tab: 'savings' },
      });
  }

  // 7 — Beginning-of-month context, when nothing above applies and the hero is
  // not already carrying the same sentence.
  if (!heroShowsActivityContext && (activity.state === 'no-activity' || activity.state === 'no-data')) {
    candidates.push({
      id: 'no-activity',
      priority: 7,
      tone: 'neutral',
      title: activity.headline ?? 'No posted activity yet',
      detail: activity.detail,
      action: activity.state === 'no-data'
        ? { label: 'Add an account', to: '/accounts', tab: 'wallet' }
        : { label: 'View transactions', to: '/transactions', tab: 'list' },
    });
  }

  // 8 — A card balance is normal. Worth stating, never worth alarming about.
  const cardDebt = totalCardDebt(accounts);
  if (cardDebt > 0) {
    candidates.push({
      id: 'card-balance',
      priority: 8,
      tone: 'neutral',
      title: `${dollars(cardDebt)} outstanding on your cards`,
      detail: null,
      action: { label: 'Open cards', to: '/accounts', tab: 'cards' },
    });
  }

  // 9 — All clear. Says something real rather than congratulating the user.
  candidates.push(lastCompleted
    ? {
      id: 'all-clear-summary',
      priority: 9,
      tone: 'positive',
      title: lastCompleted.net >= 0
        ? `${dollars(lastCompleted.net)} left after expenses in ${monthLabel(lastCompleted.month)}`
        : `Spending exceeded income by ${dollars(Math.abs(lastCompleted.net))} in ${monthLabel(lastCompleted.month)}`,
      detail: 'Nothing is waiting for your review.',
      action: { label: 'See analytics', to: '/', tab: 'analytics' },
    }
    : {
      id: 'all-clear',
      priority: 9,
      tone: 'positive',
      title: 'Nothing needs your attention',
      detail: 'Imported transactions are all categorized.',
      action: null,
    });

  return candidates.sort((a, b) => a.priority - b.priority);
}

/** The one insight to show. */
export function buildStatusInsight(options: StatusInsightOptions): StatusInsight {
  return statusInsightCandidates(options)[0];
}
