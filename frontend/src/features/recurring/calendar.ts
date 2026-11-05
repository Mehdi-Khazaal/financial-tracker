/**
 * The cash calendar: bills and pay on the days they land, and what the
 * spendable balance should be at the end of each day.
 *
 * It starts from what is in checking and cash today (the app's "available to
 * spend") and walks forward one day at a time. A bill or payday moves that
 * balance only when it is paid from, or into, a spendable account: a bill on a
 * credit card is listed, but cash stays put until the card itself is paid. An
 * optional typical day-to-day amount comes off every day after today, so the
 * low point is not flattered by pretending groceries are free.
 *
 * Pure and date-string based (`YYYY-MM-DD`), so it is tested without a clock.
 */

import type { RecurringPeriod } from '../../types';

/** A recurring charge or payment, as the calendar needs it. */
export interface Schedule {
  id: number;
  name: string;
  /** Signed: bills negative, pay positive. */
  amount: number;
  nextDate: string;
  period: RecurringPeriod;
  accountId: number | null;
  accountName: string | null;
  isVariable: boolean;
}

export interface CalendarEvent {
  /** Unique per occurrence: the schedule id and the date. */
  key: string;
  id: number;
  name: string;
  amount: number;
  date: string;
  kind: 'bill' | 'income';
  /** Paid from or into checking or cash, so it moves the balance shown. */
  movesCash: boolean;
  accountName: string | null;
  isVariable: boolean;
  /** Was due before today and is still open; shown on today. */
  overdue: boolean;
}

export interface CalendarDay {
  date: string;
  events: CalendarEvent[];
  /** Expected spendable balance at the end of the day. */
  balance: number;
}

export interface CashCalendar {
  days: CalendarDay[];
  /** The day the balance is lowest (the first, if it repeats). */
  lowest: CalendarDay | null;
  /** The first day the balance ends below the warning line. */
  firstBelow: CalendarDay | null;
  nextIncome: CalendarEvent | null;
  billsTotal: number;
  billCount: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);

export const addDays = (iso: string, days: number): string => {
  const d = fromKey(iso);
  d.setDate(d.getDate() + days);
  return toKey(d);
};

/** One cycle on, matching the backend's schedule stepping. */
export const stepDate = (iso: string, period: RecurringPeriod): string => {
  const d = fromKey(iso);
  if (period === 'weekly') d.setDate(d.getDate() + 7);
  else if (period === 'biweekly') d.setDate(d.getDate() + 14);
  else if (period === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (period === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return toKey(d);
};

/** The last day of the month after `iso`'s: the calendar's horizon. */
export const endOfNextMonth = (iso: string): string => {
  const d = fromKey(iso);
  return toKey(new Date(d.getFullYear(), d.getMonth() + 2, 0));
};

/**
 * Every firing of every schedule between `from` and `to`, inclusive. A charge
 * still open from before `from` is owed, so it appears once, on `from`.
 */
export function occurrences(
  schedules: Schedule[],
  from: string,
  to: string,
  spendableAccountIds: Set<number>,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  schedules.forEach(s => {
    if (s.amount === 0) return;
    const kind = s.amount < 0 ? 'bill' : 'income';
    const movesCash = s.accountId == null || spendableAccountIds.has(s.accountId);
    let cursor = s.nextDate.slice(0, 10);
    let overdueShown = false;
    // Bounded: a weekly schedule fires about ten times in the horizon.
    for (let i = 0; i < 120 && cursor <= to; i += 1) {
      const overdue = cursor < from;
      if (!overdue || !overdueShown) {
        const date = overdue ? from : cursor;
        events.push({
          key: `${s.id}:${cursor}`,
          id: s.id,
          name: s.name,
          amount: s.amount,
          date,
          kind,
          movesCash,
          accountName: s.accountName,
          isVariable: s.isVariable,
          overdue,
        });
        if (overdue) overdueShown = true;
      }
      cursor = stepDate(cursor, s.period);
    }
  });
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}

export function buildCashCalendar(options: {
  schedules: Schedule[];
  startBalance: number;
  spendableAccountIds: Set<number>;
  today: string;
  /** Last day to project, inclusive. */
  until: string;
  /** Typical day-to-day spending, taken off each day after today. */
  dailySpend: number;
  /** Warn when a day ends below this. */
  threshold: number | null;
}): CashCalendar {
  const { schedules, startBalance, spendableAccountIds, today, until, dailySpend, threshold } = options;
  const events = occurrences(schedules, today, until, spendableAccountIds);
  const byDate = new Map<string, CalendarEvent[]>();
  events.forEach(e => byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]));

  const days: CalendarDay[] = [];
  let balance = startBalance;
  for (let date = today, i = 0; date <= until && i < 400; date = addDays(date, 1), i += 1) {
    if (i > 0) balance -= dailySpend;
    const dayEvents = byDate.get(date) ?? [];
    dayEvents.forEach(e => { if (e.movesCash) balance += e.amount; });
    days.push({ date, events: dayEvents, balance });
  }

  const lowest = days.reduce<CalendarDay | null>((low, d) => (low == null || d.balance < low.balance ? d : low), null);
  const bills = events.filter(e => e.kind === 'bill');
  return {
    days,
    lowest,
    firstBelow: threshold == null ? null : days.find(d => d.balance < threshold) ?? null,
    nextIncome: events.find(e => e.kind === 'income') ?? null,
    billsTotal: bills.reduce((s, e) => s + Math.abs(e.amount), 0),
    billCount: bills.length,
  };
}
