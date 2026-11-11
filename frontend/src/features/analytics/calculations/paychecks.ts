/**
 * Paychecks still to come, from the rhythm of past pay.
 *
 * Pay that arrives every other week was invisible to the month-end outlook:
 * it counted only income already received, so on November 10 the Dashboard
 * said "On track to spend $33.41 more than you earn" with two paychecks due on
 * the 21st. Monthly income varies (three-paycheck months, overtime, a
 * scholarship), but the paycheck rhythm does not, so this projects the
 * paydays rather than the month.
 *
 * The detection mirrors `services/paycheck_plan.py`:
 * * A **payer** is a merchant whose income deposits come at a usual gap of
 *   one to five weeks, three or more times in the last 180 days. Deposits
 *   from one payer on one day are one paycheck (a split deposit).
 * * The **typical** paycheck is the median of the payer's recent paychecks
 *   (the last 90 days, or the last three when fewer). Recent, because pay
 *   changes: a move to part time should not be averaged with full-time pay.
 *   The range is the lowest and highest of the same paychecks.
 * * A payer silent for more than two gaps and a week has stopped paying and
 *   is not projected.
 */

import type { RecurringTransaction, Transaction } from '../../../types';
import type { ClassificationContext } from '../types';
import { classifyTransaction, median, merchantDisplayName, merchantKeyOf, normalizeMerchantName } from './transactions';

export const PAYCHECK_HISTORY_DAYS = 180;
export const RECENT_PAY_DAYS = 90;
/** A regular deposit smaller than this is interest or cashback, not pay. */
export const MIN_TYPICAL_PAYCHECK = 100;
const MIN_PAYCHECKS = 3;
const MIN_GAP_DAYS = 6;
const MAX_GAP_DAYS = 35;
const DAY_MS = 86_400_000;

export interface PayerRhythm {
  key: string;
  name: string;
  gapDays: number;
  lastPaid: string;
  typical: number;
  low: number;
  high: number;
}

export interface ExpectedPaycheck {
  key: string;
  name: string;
  on: string;
  typical: number;
  low: number;
  high: number;
}

const toDay = (key: string): number => Date.parse(`${key}T00:00:00Z`);
const fromDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (key: string, days: number): string => fromDay(toDay(key) + days * DAY_MS);
const daysBetween = (a: string, b: string): number => Math.round((toDay(b) - toDay(a)) / DAY_MS);

/** Payers that look like pay, with the size and rhythm of their recent paychecks. */
export function payerRhythms(transactions: Transaction[], ctx: ClassificationContext, todayKey: string): PayerRhythm[] {
  const since = addDays(todayKey, -PAYCHECK_HISTORY_DAYS);
  const byPayer = new Map<string, { name: string; days: Map<string, number> }>();
  for (const tx of transactions) {
    const day = tx.transaction_date.slice(0, 10);
    if (day < since || day > todayKey || !(Number(tx.amount) > 0)) continue;
    if (classifyTransaction(tx, ctx) !== 'income') continue;
    const key = merchantKeyOf(tx);
    if (!key) continue;
    const payer = byPayer.get(key) ?? { name: merchantDisplayName(tx.description), days: new Map<string, number>() };
    payer.days.set(day, (payer.days.get(day) ?? 0) + Number(tx.amount));
    byPayer.set(key, payer);
  }

  const rhythms: PayerRhythm[] = [];
  byPayer.forEach((payer, key) => {
    const dates = [...payer.days.keys()].sort();
    if (dates.length < MIN_PAYCHECKS) return;
    const gapDays = Math.round(median(dates.slice(1).map((d, i) => daysBetween(dates[i], d))));
    if (gapDays < MIN_GAP_DAYS || gapDays > MAX_GAP_DAYS) return;
    const lastPaid = dates[dates.length - 1];
    if (daysBetween(lastPaid, todayKey) > gapDays * 2 + 7) return;

    const recentSince = addDays(todayKey, -RECENT_PAY_DAYS);
    const recentDates = dates.filter(d => d >= recentSince);
    const sample = (recentDates.length >= MIN_PAYCHECKS ? recentDates : dates.slice(-MIN_PAYCHECKS))
      .map(d => payer.days.get(d) ?? 0);
    const typical = median(sample);
    if (typical < MIN_TYPICAL_PAYCHECK) return;
    rhythms.push({
      key,
      name: payer.name,
      gapDays,
      lastPaid,
      typical,
      low: Math.min(...sample),
      high: Math.max(...sample),
    });
  });
  return rhythms.sort((a, b) => b.typical - a.typical || a.name.localeCompare(b.name));
}

/**
 * Paydays from today through `endKey` that have not paid yet.
 *
 * A payer with an active recurring income entry of its own is left to that
 * entry, which the forecast already counts. A payday that passed without a
 * deposit is skipped, not carried forward: the payer may simply not have paid.
 */
export function expectedPaychecks(
  rhythms: PayerRhythm[],
  todayKey: string,
  endKey: string,
  recurring: RecurringTransaction[] = [],
): ExpectedPaycheck[] {
  const declared = new Set(
    recurring
      .filter(r => r.is_active && Number(r.amount) > 0)
      .map(r => normalizeMerchantName(r.description))
      .filter(Boolean),
  );
  const expected: ExpectedPaycheck[] = [];
  for (const payer of rhythms) {
    if (declared.has(payer.key)) continue;
    for (let on = addDays(payer.lastPaid, payer.gapDays); on <= endKey; on = addDays(on, payer.gapDays)) {
      if (on < todayKey) continue;
      expected.push({ key: payer.key, name: payer.name, on, typical: payer.typical, low: payer.low, high: payer.high });
    }
  }
  return expected.sort((a, b) => a.on.localeCompare(b.on) || b.typical - a.typical);
}
