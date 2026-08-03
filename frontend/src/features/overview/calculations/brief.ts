/**
 * The Morning Brief.
 *
 * The question this answers is "what changed, and what is coming" — anchored to
 * *today*. That is deliberately not the question Analytics answers. Analytics
 * scores observations inside a period you chose ("in the last 3 months,
 * Groceries ran above average"); the brief reports the state of this morning
 * ("a bill renews in 3 days", "your pay landed on Tuesday", "spending is
 * tracking below usual"). Two engines answering the same question would
 * eventually disagree in public, so they answer different ones and share the
 * arithmetic underneath.
 *
 * Three rules, in order of how much trouble breaking them causes:
 *
 *   1. Never invent. Every line traces to a number already in the data. When
 *      nothing qualifies, the brief says so rather than padding itself.
 *   2. Never alarm. Spending money is what money is for. "Attention" is
 *      reserved for things that are actually wrong or actually waiting.
 *   3. Never repeat. A line the hero is already showing is dropped, not
 *      echoed one card lower.
 */

import type { Account, Transaction } from '../../../types';
import type { Forecast, PeriodMetrics, PrimaryGoal, UpcomingBill } from '../../analytics/types';
import { dollars, monthLabel, plural, relativeDays, signedPercent, verbFor } from '../../analytics/format';
import { merchantDisplayName, normalizeMerchantName } from '../../analytics/calculations/transactions';
import { dateKey, daysBetween } from '../../analytics/period';
import type { MonthActivity } from '../types';
import { cardUtilization, totalCardDebt } from './accounts';
import {
  linkToBanking, linkToCards, linkToGoal, linkToRecurring, linkToReview,
} from '../../../lib/deepLinks';

export type BriefTone = 'attention' | 'neutral' | 'positive';

/** Icon keys, so the component never branches on an item's id. */
export type BriefIcon =
  | 'alert' | 'info' | 'check' | 'calendar' | 'inflow' | 'outflow' | 'goal' | 'trend';

export interface BriefItem {
  id: string;
  /** Lower sorts first. */
  priority: number;
  tone: BriefTone;
  icon: BriefIcon;
  /** The sentence itself. One line. */
  text: string;
  /** Supporting clause, when the sentence needs evidence. */
  detail: string | null;
  action: { label: string; to: string } | null;
}

/** How the month's spending compares with a typical one, elapsed-adjusted. */
export interface SpendingPace {
  /** Projected month spend at the current rate. */
  projected: number;
  /** Median spend across completed months. */
  typical: number;
  /** Fractional difference: −0.08 is 8% below usual. */
  delta: number;
  monthsOfHistory: number;
}

/** Below this the month has barely started and any rate is noise. */
const MIN_ELAPSED_FRACTION = 0.15;
/** Fewer completed months than this and "usual" is not a real baseline. */
const MIN_BASELINE_MONTHS = 3;
/** Movements smaller than this are not worth a line. */
const MATERIAL_PCT = 0.05;
/** A bill this far out is worth flagging this morning. */
const BILL_HORIZON_DAYS = 7;
/**
 * Completed months required before quoting a projected completion date.
 *
 * `selectPrimaryGoal` already refuses to project without a positive average,
 * but "positive" is not the same as "reliable" — one good month would produce a
 * date, and a date is read as a promise. Same threshold as the spending pace.
 */
const MIN_PROJECTION_MONTHS = 3;
/** "Recently" for the brief. */
export const RECENT_WINDOW_DAYS = 7;

/**
 * Spending pace against a typical month.
 *
 * Both sides are whole-month figures: the current month is scaled up by how
 * much of it has elapsed, so a comparison on the 6th is not measuring six days
 * against thirty-one.
 */
export function calculateSpendingPace(options: {
  monthExpenses: number;
  elapsedFraction: number;
  /** Expense totals for completed months. */
  completedMonthExpenses: number[];
}): SpendingPace | null {
  const { monthExpenses, elapsedFraction, completedMonthExpenses } = options;

  const usable = completedMonthExpenses.filter(v => v > 0);
  if (usable.length < MIN_BASELINE_MONTHS) return null;
  if (elapsedFraction < MIN_ELAPSED_FRACTION) return null;
  if (monthExpenses <= 0) return null;

  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const typical = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (typical <= 0) return null;

  const projected = monthExpenses / elapsedFraction;
  return {
    projected,
    typical,
    delta: (projected - typical) / typical,
    monthsOfHistory: usable.length,
  };
}

export interface BriefInputs {
  today: Date;
  activity: MonthActivity;
  /** True when any source failed to load. */
  dataIncomplete: boolean;
  unreviewedCount: number;
  accounts: Account[];
  /**
   * The featured goal, already chosen and projected by
   * `calculateSavingsMetrics` — the same figure the Analytics savings card
   * quotes, rather than a second average computed here.
   */
  primaryGoal: PrimaryGoal | null;
  /** Completed months behind that average, for deciding whether to trust it. */
  savingsMonths: number;
  /** Metrics over the trailing `RECENT_WINDOW_DAYS`. */
  recentMetrics: PeriodMetrics;
  /** Transactions over the same window, for merchant matching. */
  recentTransactions: Transaction[];
  /** Declared recurring merchant keys, for spotting a renewal that posted. */
  declaredRecurringKeys: Set<string>;
  pace: SpendingPace | null;
  forecast: Forecast;
  upcoming: UpcomingBill[];
  undeclaredRecurringCount: number;
  /** Income minus expenses for the most recent completed month. */
  lastCompleted: { month: string; net: number } | null;
  /** True when the hero is already showing the quiet-month explanation. */
  heroShowsActivityContext: boolean;
}

/** How many lines the brief will show. */
export const BRIEF_LIMIT = 4;

/**
 * Every line that currently applies, most important first.
 *
 * Exported for testing the ordering; the page renders `buildMorningBrief`.
 */
export function briefCandidates(inputs: BriefInputs): BriefItem[] {
  const {
    today, activity, dataIncomplete, unreviewedCount, accounts,
    primaryGoal, savingsMonths,
    recentMetrics, recentTransactions, declaredRecurringKeys, pace, forecast,
    upcoming, undeclaredRecurringCount, lastCompleted, heroShowsActivityContext,
  } = inputs;

  const items: BriefItem[] = [];

  // ── Things that are actually wrong or actually waiting ──────────────────────

  if (dataIncomplete) {
    items.push({
      id: 'data-incomplete',
      priority: 1,
      tone: 'attention',
      icon: 'alert',
      text: 'Some information could not be loaded',
      detail: 'Figures below may be out of date until the next refresh.',
      action: null,
    });
  }

  if (unreviewedCount > 0) {
    items.push({
      id: 'unreviewed-imports',
      priority: 2,
      tone: 'attention',
      icon: 'alert',
      text: `${plural(unreviewedCount, 'imported transaction')} still ${verbFor(unreviewedCount, 'need')} a category`,
      detail: null,
      action: { label: 'Review', to: linkToReview() },
    });
  }

  const overdrawn = accounts.filter(a => a.type !== 'credit_card' && Number(a.balance) < 0);
  if (overdrawn.length > 0) {
    items.push({
      id: 'overdrawn',
      priority: 3,
      tone: 'attention',
      icon: 'alert',
      text: overdrawn.length === 1
        ? `${overdrawn[0].name} is overdrawn`
        : `${plural(overdrawn.length, 'account')} are overdrawn`,
      detail: `${dollars(overdrawn.reduce((s, a) => s + Math.abs(Number(a.balance)), 0))} below zero.`,
      action: { label: 'Open', to: linkToBanking() },
    });
  }

  const utilization = cardUtilization(accounts);
  if (utilization != null && utilization >= 80) {
    items.push({
      id: 'high-utilization',
      priority: 4,
      tone: 'attention',
      icon: 'alert',
      text: `Credit use is at ${utilization.toFixed(0)}% of your limit`,
      detail: null,
      action: { label: 'Open', to: linkToCards() },
    });
  }

  // ── What is coming ──────────────────────────────────────────────────────────

  const nextBill = upcoming.find(b => b.daysUntil >= 0 && b.daysUntil <= BILL_HORIZON_DAYS);
  if (nextBill) {
    items.push({
      id: 'bill-due',
      priority: 5,
      tone: 'neutral',
      icon: 'calendar',
      text: `${nextBill.name} ${nextBill.daysUntil === 0 ? 'is due today' : `is due ${relativeDays(nextBill.daysUntil)}`}`,
      detail: `${nextBill.isVariable ? 'About ' : ''}${dollars(nextBill.amount)}${nextBill.accountName ? ` from ${nextBill.accountName}` : ''}.`,
      action: { label: 'Recurring', to: linkToRecurring() },
    });
  }

  // ── What landed ─────────────────────────────────────────────────────────────

  // A declared subscription that actually posted in the window. Evidence, not
  // a schedule: the recurring row's date can drift, a posted charge cannot.
  //
  // The merchant already named as due is excluded. Netflix renewing last week
  // and Netflix renewing again on Friday is one story, and spending two of four
  // lines on it crowds out everything else the morning had to say.
  const dueKey = nextBill ? normalizeMerchantName(nextBill.name) : '';
  const renewed = recentTransactions.find(tx => {
    if (Number(tx.amount) >= 0) return false;
    const key = normalizeMerchantName(tx.description);
    return key !== '' && key !== dueKey && declaredRecurringKeys.has(key);
  });
  if (renewed) {
    const day = renewed.transaction_date.slice(0, 10);
    const daysAgo = daysBetween(day, dateKey(today));
    items.push({
      id: 'subscription-renewed',
      priority: 6,
      tone: 'neutral',
      icon: 'outflow',
      text: `${merchantDisplayName(renewed.description)} renewed ${relativeDays(-daysAgo)}`,
      detail: dollars(Math.abs(Number(renewed.amount))),
      action: null,
    });
  }

  const largestIncome: Transaction | null = recentMetrics.largestIncome;
  if (largestIncome) {
    const weekday = new Date(`${largestIncome.transaction_date.slice(0, 10)}T00:00:00`)
      .toLocaleDateString('en-US', { weekday: 'long' });
    items.push({
      id: 'income-landed',
      priority: 7,
      tone: 'positive',
      icon: 'inflow',
      text: `${dollars(Number(largestIncome.amount))} arrived on ${weekday}`,
      detail: merchantDisplayName(largestIncome.description),
      action: null,
    });
  }

  // ── How the month is tracking ───────────────────────────────────────────────

  if (pace && Math.abs(pace.delta) >= MATERIAL_PCT) {
    const lower = pace.delta < 0;
    items.push({
      id: 'spending-pace',
      priority: 8,
      // Spending less is worth noting; spending more is not a verdict.
      tone: lower ? 'positive' : 'neutral',
      icon: 'trend',
      text: `Spending is tracking ${signedPercent(Math.abs(pace.delta)).replace('+', '')} ${lower ? 'below' : 'above'} usual this month`,
      detail: `About ${dollars(pace.projected)} at this rate, against a typical ${dollars(pace.typical)} over ${plural(pace.monthsOfHistory, 'month')}.`,
      action: null,
    });
  }

  if (forecast.available && forecast.savings != null) {
    const saving = forecast.savings >= 0;
    items.push({
      id: 'projection',
      priority: 9,
      tone: saving ? 'positive' : 'neutral',
      icon: 'trend',
      text: saving
        ? `On track to have ${dollars(forecast.savings)} left over this month`
        : `On track to spend ${dollars(Math.abs(forecast.savings))} more than you earn this month`,
      detail: forecast.confidence === 'low' ? 'Based on limited history — treat as a rough guide.' : null,
      action: null,
    });
  }

  const risk = forecast.categoryRisks[0];
  if (risk) {
    items.push({
      id: 'category-high',
      priority: 10,
      tone: 'neutral',
      icon: 'trend',
      text: `${risk.name} is running above its usual`,
      detail: `About ${dollars(risk.projected)} this month against a typical ${dollars(risk.average)}.`,
      action: null,
    });
  }

  const largestExpense: Transaction | null = recentMetrics.largestExpense;
  if (largestExpense && Math.abs(Number(largestExpense.amount)) >= 50) {
    items.push({
      id: 'largest-purchase',
      priority: 11,
      tone: 'neutral',
      icon: 'outflow',
      text: `Largest purchase this week: ${dollars(Math.abs(Number(largestExpense.amount)))}`,
      detail: merchantDisplayName(largestExpense.description),
      action: null,
    });
  }

  // ── Where you are heading ───────────────────────────────────────────────────

  if (primaryGoal) {
    const complete = primaryGoal.remaining <= 0;
    // A completion date only when there is enough history behind the average
    // that produced it. Otherwise the percentage stands on its own.
    const projectable = !complete
      && savingsMonths >= MIN_PROJECTION_MONTHS
      && primaryGoal.projectedCompletion != null;

    items.push({
      id: complete ? 'goal-complete' : 'goal-next',
      priority: 12,
      tone: complete ? 'positive' : 'neutral',
      icon: 'goal',
      text: complete
        ? `${primaryGoal.name} is fully funded`
        : `${dollars(primaryGoal.remaining)} to go on ${primaryGoal.name}`,
      detail: complete
        ? null
        : projectable
          ? `${primaryGoal.progress.toFixed(0)}% funded — on track for ${primaryGoal.projectedCompletion} at your recent rate.`
          : `${primaryGoal.progress.toFixed(0)}% funded.`,
      action: { label: 'Goals', to: linkToGoal(primaryGoal.id) },
    });
  }

  if (undeclaredRecurringCount > 0) {
    items.push({
      id: 'recurring-review',
      priority: 13,
      tone: 'neutral',
      icon: 'info',
      text: `${plural(undeclaredRecurringCount, 'charge')} ${verbFor(undeclaredRecurringCount, 'look')} recurring but ${verbFor(undeclaredRecurringCount, 'are')} not set up`,
      detail: 'Confirming them improves upcoming-bill estimates.',
      action: { label: 'Review', to: linkToRecurring() },
    });
  }

  const cardDebt = totalCardDebt(accounts);
  if (cardDebt > 0) {
    items.push({
      id: 'card-balance',
      priority: 14,
      tone: 'neutral',
      icon: 'info',
      text: `${dollars(cardDebt)} outstanding on your cards`,
      detail: null,
      action: { label: 'Cards', to: linkToCards() },
    });
  }

  // ── Beginning of month, only when the hero is not already saying it ─────────

  if (!heroShowsActivityContext
    && (activity.state === 'no-activity' || activity.state === 'no-data')) {
    items.push({
      id: 'no-activity',
      priority: 15,
      tone: 'neutral',
      icon: 'info',
      text: activity.headline ?? 'No posted activity yet',
      detail: activity.detail,
      action: null,
    });
  }

  // Last completed month, as a closing fact rather than a projection. Only
  // when the current month has nothing better to say about itself.
  if (lastCompleted && !forecast.available) {
    items.push({
      id: 'last-completed',
      priority: 16,
      tone: lastCompleted.net >= 0 ? 'positive' : 'neutral',
      icon: 'trend',
      text: lastCompleted.net >= 0
        ? `${dollars(lastCompleted.net)} left after expenses in ${monthLabel(lastCompleted.month)}`
        : `Spending exceeded income by ${dollars(Math.abs(lastCompleted.net))} in ${monthLabel(lastCompleted.month)}`,
      detail: null,
      action: null,
    });
  }

  return items.sort((a, b) => a.priority - b.priority);
}

/**
 * The lines to show this morning, capped.
 *
 * Returns an empty list when nothing qualifies — the component decides how to
 * say "nothing to report", because that is a presentation choice, and inventing
 * a filler insight here would defeat the point of the whole module.
 */
export function buildMorningBrief(inputs: BriefInputs, limit = BRIEF_LIMIT): BriefItem[] {
  return briefCandidates(inputs).slice(0, limit);
}
