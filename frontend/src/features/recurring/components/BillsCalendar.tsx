import React, { useEffect, useMemo, useState } from 'react';
import type { Account, Category, RecurringOverview, RecurringTransaction, Transaction } from '../../../types';
import { fetchAllTransactions, getAccounts, getCategories, getPreferences } from '../../../utils/api';
import { SPENDABLE_TYPES } from '../../accounts/calculations/totals';
import { buildClassificationContext, median } from '../../analytics/calculations/transactions';
import { fixedCostKeys } from '../../analytics/calculations/cashflow';
import { dayToDaySpend } from '../../analytics/calculations/forecast';
import { dollars } from '../../analytics/format';
import { buildCashCalendar, endOfNextMonth, type CalendarDay, type Schedule } from '../calendar';

interface Props {
  overview: RecurringOverview;
}

interface Sources {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  threshold: number | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_PER_MONTH = 30.44;

/** A balance, which can be overdrawn: `dollars()` alone drops the sign. */
const balance = (n: number, decimals = 0) => `${n < 0 ? '−' : ''}${dollars(Math.abs(n), decimals)}`;
const signed = (n: number, decimals = 0) => `${n < 0 ? '−' : '+'}${dollars(Math.abs(n), decimals)}`;
const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', opts);
const monthKey = (iso: string) => iso.slice(0, 7);
const pad = (n: number) => String(n).padStart(2, '0');

/** Bills and pay from the overview, signed and shaped for the calendar. */
function schedulesFrom(overview: RecurringOverview): Schedule[] {
  const shape = (sign: 1 | -1) => (bill: RecurringOverview['income'][number]): Schedule => ({
    id: bill.id,
    name: bill.description || bill.category_name || 'Recurring',
    amount: sign * Math.abs(Number(bill.amount)),
    nextDate: bill.next_date,
    period: bill.period,
    accountId: bill.account_id ?? null,
    accountName: bill.account_name,
    isVariable: bill.is_variable,
  });
  return [
    ...overview.groups.flatMap(g => g.bills).filter(b => b.is_active).map(shape(-1)),
    ...overview.income.filter(b => b.is_active).map(shape(1)),
  ];
}

/**
 * Typical day-to-day spending a day: everything except scheduled bills, over
 * the last three finished months, the same measure the month-end outlook uses.
 */
function typicalDailySpend(sources: Sources, schedules: Schedule[], today: string): number {
  const ctx = buildClassificationContext(sources.accounts, sources.categories);
  const keys = fixedCostKeys(schedules
    .filter(s => s.amount < 0)
    .map(s => ({ is_active: true, amount: s.amount, description: s.name }) as unknown as RecurringTransaction));
  const [y, m] = today.split('-').map(Number);
  const months = [3, 2, 1].map(back => {
    const d = new Date(y, m - 1 - back, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  });
  const totals = months
    .map(month => dayToDaySpend(sources.transactions.filter(t => t.transaction_date.startsWith(month)), ctx, keys).total)
    .filter(total => total > 0);
  return totals.length > 0 ? median(totals) / DAYS_PER_MONTH : 0;
}

/**
 * The cash calendar on the Recurring page: when bills and pay land, and what
 * checking and cash should hold at the end of each day until the end of next
 * month — the "will I dip below my line before payday?" question.
 */
const BillsCalendar: React.FC<Props> = ({ overview }) => {
  const [sources, setSources] = useState<Sources | null>(null);
  const [failed, setFailed] = useState(false);
  const [includeDaily, setIncludeDaily] = useState(true);
  const today = overview.today.slice(0, 10);
  const until = endOfNextMonth(today);
  const [shownMonth, setShownMonth] = useState(monthKey(today));

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getAccounts(), getCategories(), fetchAllTransactions(), getPreferences()])
      .then(([accounts, categories, transactions, preferences]) => {
        if (cancelled) return;
        if (accounts.status !== 'fulfilled') { setFailed(true); return; }
        const threshold = preferences.status === 'fulfilled' ? Number(preferences.value.data?.low_balance_threshold) : NaN;
        setSources({
          accounts: (accounts.value.data ?? []) as Account[],
          categories: categories.status === 'fulfilled' ? (categories.value.data ?? []) as Category[] : [],
          transactions: transactions.status === 'fulfilled' ? (transactions.value.transactions ?? []) as Transaction[] : [],
          threshold: Number.isFinite(threshold) ? threshold : null,
        });
      });
    return () => { cancelled = true; };
  }, []);

  const schedules = useMemo(() => schedulesFrom(overview), [overview]);

  const model = useMemo(() => {
    if (!sources) return null;
    const spendable = sources.accounts.filter(a => SPENDABLE_TYPES.includes(a.type));
    const daily = typicalDailySpend(sources, schedules, today);
    const calendar = buildCashCalendar({
      schedules,
      startBalance: spendable.reduce((s, a) => s + Number(a.balance), 0),
      spendableAccountIds: new Set(spendable.map(a => a.id)),
      today,
      until,
      dailySpend: includeDaily ? daily : 0,
      threshold: sources.threshold,
    });
    return { calendar, daily, start: spendable.reduce((s, a) => s + Number(a.balance), 0), threshold: sources.threshold };
  }, [sources, schedules, today, until, includeDaily]);

  if (failed) {
    return (
      <p className="text-sm py-6" style={{ color: 'var(--muted)' }}>
        The calendar needs your account balances, which could not be loaded. Pull to refresh to try again.
      </p>
    );
  }
  if (!model) {
    return <p className="text-sm py-6" style={{ color: 'var(--muted)' }} role="status">Working out the next few weeks…</p>;
  }

  const { calendar, daily, start, threshold } = model;
  const byDate = new Map(calendar.days.map(d => [d.date, d]));
  const below = (d: CalendarDay) => threshold != null && d.balance < threshold;
  const months = [monthKey(today), monthKey(until)];

  // The month grid, Sunday first, padded to whole weeks.
  const [gy, gm] = shownMonth.split('-').map(Number);
  const firstWeekday = new Date(gy, gm - 1, 1).getDay();
  const daysInMonth = new Date(gy, gm, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${shownMonth}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  const agenda = calendar.days.filter(d => d.events.length > 0);

  return (
    <section aria-labelledby="bills-calendar-heading" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
        <div>
          <h2 id="bills-calendar-heading" className="section-title">Cash calendar</h2>
          <p className="text-[13px] mt-1" style={{ color: 'var(--muted)' }}>
            What checking and cash should hold at the end of each day, through {dayLabel(until, { month: 'long', day: 'numeric' })}.
          </p>
        </div>
        {daily > 0 && (
          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--fg)', minHeight: 44 }}>
            <input type="checkbox" checked={includeDaily} onChange={e => setIncludeDaily(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
            Include day-to-day spending, about {dollars(daily, 0)} a day
          </label>
        )}
      </div>

      <dl className="metric-strip grid grid-cols-2 lg:grid-cols-4">
        <div className="metric-tile">
          <dt className="metric-label">In checking and cash</dt>
          <dd className="metric-value">{balance(start)}</dd>
          <dd className="metric-note">today</dd>
        </div>
        <div className="metric-tile">
          <dt className="metric-label">Lowest point</dt>
          <dd className="metric-value" style={{ color: calendar.lowest && below(calendar.lowest) ? 'var(--neg)' : 'var(--fg)' }}>
            {calendar.lowest ? balance(calendar.lowest.balance) : '—'}
          </dd>
          <dd className="metric-note">{calendar.lowest ? `on ${dayLabel(calendar.lowest.date, { month: 'short', day: 'numeric' })}` : ''}</dd>
        </div>
        <div className="metric-tile">
          <dt className="metric-label">Next pay</dt>
          <dd className="metric-value" style={{ color: calendar.nextIncome ? 'var(--pos)' : 'var(--fg)' }}>
            {calendar.nextIncome ? signed(calendar.nextIncome.amount) : 'None set up'}
          </dd>
          <dd className="metric-note">
            {calendar.nextIncome ? `${dayLabel(calendar.nextIncome.date, { month: 'short', day: 'numeric' })} · ${calendar.nextIncome.name}` : 'Add your pay as recurring income'}
          </dd>
        </div>
        <div className="metric-tile">
          <dt className="metric-label">Bills due</dt>
          <dd className="metric-value">{dollars(calendar.billsTotal, 0)}</dd>
          <dd className="metric-note">{calendar.billCount} {calendar.billCount === 1 ? 'charge' : 'charges'} by {dayLabel(until, { month: 'short', day: 'numeric' })}</dd>
        </div>
      </dl>

      {threshold != null && (
        <p className="text-sm" style={{ color: calendar.firstBelow ? 'var(--neg)' : 'var(--muted)' }}>
          {calendar.firstBelow
            ? `Expected to dip below your ${dollars(threshold, 0)} line on ${dayLabel(calendar.firstBelow.date, { weekday: 'long', month: 'long', day: 'numeric' })}, to ${balance(calendar.firstBelow.balance)}.`
            : `Stays above your ${dollars(threshold, 0)} line the whole way.`}
          <span style={{ color: 'var(--muted)' }}> The line is your low-balance amount in Settings.</span>
        </p>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>
            {new Date(gy, gm - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h3>
          <div className="flex gap-1">
            {months.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setShownMonth(m)}
                aria-pressed={shownMonth === m}
                className="px-3 text-[13px] rounded-[4px] pressable"
                style={{
                  minHeight: 36,
                  border: '1px solid var(--line-strong)',
                  background: shownMonth === m ? 'var(--fg)' : 'transparent',
                  color: shownMonth === m ? 'var(--bg)' : 'var(--fg)',
                }}
              >
                {new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full table-fixed border-collapse" aria-describedby="bills-calendar-heading">
          <thead>
            <tr>
              {WEEKDAYS.map(d => (
                <th key={d} scope="col" className="pb-1.5 text-left text-xs font-normal" style={{ color: 'var(--muted)' }}>
                  <span className="hidden sm:inline">{d}</span>
                  <span className="sm:hidden">{d.slice(0, 1)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((iso, i) => {
                  if (!iso) return <td key={i} style={{ borderTop: '1px solid var(--line)' }} />;
                  const day = byDate.get(iso);
                  const isToday = iso === today;
                  const label = day
                    ? `${dayLabel(iso, { weekday: 'long', month: 'long', day: 'numeric' })}: ${day.events.map(e => `${e.name} ${signed(e.amount, 2)}`).join(', ') || 'nothing due'}; expected balance ${balance(day.balance, 2)}`
                    : dayLabel(iso, { weekday: 'long', month: 'long', day: 'numeric' });
                  return (
                    <td
                      key={i}
                      className="align-top p-1 sm:p-1.5 h-[52px] sm:h-[76px]"
                      style={{ borderTop: `1px solid ${isToday ? 'var(--fg)' : 'var(--line)'}` }}
                      aria-label={label}
                    >
                      <div className="flex flex-col h-full gap-0.5">
                        <span className="text-xs tabular-nums" style={{ color: isToday ? 'var(--fg)' : day ? 'var(--muted)' : 'var(--dim)', fontWeight: isToday ? 700 : 400 }}>
                          {Number(iso.slice(8))}
                        </span>
                        {day && day.events.slice(0, 2).map(e => (
                          <span key={e.key} className="hidden md:block truncate text-[11px] leading-tight" style={{ color: e.kind === 'income' ? 'var(--pos)' : 'var(--fg)' }} title={`${e.name} ${signed(e.amount, 2)}`}>
                            {e.name}
                          </span>
                        ))}
                        {day && day.events.length > 2 && (
                          <span className="hidden md:block text-[11px]" style={{ color: 'var(--muted)' }}>+{day.events.length - 2} more</span>
                        )}
                        {day && day.events.length > 0 && (
                          <span className="md:hidden flex gap-0.5" aria-hidden="true">
                            {day.events.slice(0, 3).map(e => (
                              <span key={e.key} className="w-1.5 h-1.5 rounded-full" style={{ background: e.kind === 'income' ? 'var(--pos)' : 'var(--fg)' }} />
                            ))}
                          </span>
                        )}
                        {day && (
                          <span
                            className="mt-auto hidden sm:block text-[11px] tabular-nums text-right"
                            style={{ color: below(day) ? 'var(--neg)' : day.events.length ? 'var(--fg)' : 'var(--dim)', fontWeight: day.events.length ? 600 : 400 }}
                          >
                            {balance(day.balance)}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--fg)' }}>Day by day</h3>
        {agenda.length === 0 ? (
          <p className="text-[13px] py-3" style={{ color: 'var(--muted)' }}>Nothing scheduled before {dayLabel(until, { month: 'long', day: 'numeric' })}.</p>
        ) : (
          <ul className="row-list" style={{ borderBottom: '1px solid var(--line)' }}>
            {agenda.map(day => (
              <li key={day.date} className="grid grid-cols-[5.5rem_1fr_auto] gap-x-4 py-3 items-baseline">
                <span className="text-[13px] tabular-nums" style={{ color: 'var(--muted)' }}>
                  {dayLabel(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <ul className="min-w-0 space-y-1">
                  {day.events.map(e => (
                    <li key={e.key} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate" style={{ color: 'var(--fg)' }}>
                        {e.name}
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          {e.overdue ? ' · overdue' : ''}
                          {!e.movesCash ? ` · on ${e.accountName ?? 'a card'}, cash unchanged` : e.accountName ? ` · ${e.accountName}` : ''}
                        </span>
                      </span>
                      <span className="tabular-nums shrink-0" style={{ color: e.kind === 'income' ? 'var(--pos)' : 'var(--fg)' }}>
                        {e.isVariable ? '≈' : ''}{signed(e.amount, 2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <span className="text-sm font-semibold tabular-nums text-right w-24" style={{ color: below(day) ? 'var(--neg)' : 'var(--fg)' }}>
                  {balance(day.balance)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--dim)' }}>
          Counts the bills and pay set up as recurring, on the accounts they use; a bill on a credit card leaves cash alone until the card is paid.
          {includeDaily && daily > 0 ? ' Day-to-day spending is your typical amount from the last three months, spread evenly.' : ''}
        </p>
      </div>
    </section>
  );
};

export default BillsCalendar;
