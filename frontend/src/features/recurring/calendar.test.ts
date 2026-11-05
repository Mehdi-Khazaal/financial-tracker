import { describe, expect, it } from 'vitest';
import { addDays, buildCashCalendar, endOfNextMonth, occurrences, stepDate, type Schedule } from './calendar';

const CHECKING = 1;
const CARD = 2;
const spendable = new Set([CHECKING]);

const schedule = (over: Partial<Schedule>): Schedule => ({
  id: 1, name: 'Rent', amount: -1500, nextDate: '2026-12-01', period: 'monthly',
  accountId: CHECKING, accountName: 'Everyday', isVariable: false, ...over,
});

describe('dates', () => {
  it('steps each period and finds the horizon', () => {
    expect(stepDate('2026-11-05', 'weekly')).toBe('2026-11-12');
    expect(stepDate('2026-11-05', 'biweekly')).toBe('2026-11-19');
    expect(stepDate('2026-11-05', 'monthly')).toBe('2026-12-05');
    expect(stepDate('2026-11-05', 'quarterly')).toBe('2027-02-05');
    expect(stepDate('2026-11-05', 'yearly')).toBe('2027-11-05');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(endOfNextMonth('2026-11-05')).toBe('2026-12-31');
  });
});

describe('occurrences', () => {
  it('repeats a weekly bill through the window', () => {
    const events = occurrences([schedule({ period: 'weekly', nextDate: '2026-11-06' })], '2026-11-05', '2026-11-30', spendable);
    expect(events.map(e => e.date)).toEqual(['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
  });

  it('shows a charge still open from before today once, on today', () => {
    const events = occurrences([schedule({ nextDate: '2026-10-28' })], '2026-11-05', '2026-12-31', spendable);
    expect(events.map(e => [e.date, e.overdue])).toEqual([['2026-11-05', true], ['2026-11-28', false], ['2026-12-28', false]]);
  });

  it('knows a card charge does not move cash', () => {
    const [onCard] = occurrences([schedule({ accountId: CARD })], '2026-11-05', '2026-12-31', spendable);
    expect(onCard.movesCash).toBe(false);
  });
});

describe('buildCashCalendar', () => {
  const base = {
    startBalance: 2000,
    spendableAccountIds: spendable,
    today: '2026-11-05',
    until: '2026-12-10',
    dailySpend: 0,
    threshold: 500,
  };

  it('walks the balance forward through bills and pay', () => {
    const calendar = buildCashCalendar({
      ...base,
      schedules: [
        schedule({ id: 1, amount: -1800, nextDate: '2026-12-01' }),
        schedule({ id: 2, name: 'Salary', amount: 3000, nextDate: '2026-12-02' }),
        schedule({ id: 3, name: 'Netflix', amount: -16, nextDate: '2026-11-07', accountId: CARD }),
      ],
    });

    const day = (iso: string) => calendar.days.find(d => d.date === iso)!;
    // The card charge is listed but leaves cash alone.
    expect(day('2026-11-07').events.map(e => e.name)).toEqual(['Netflix']);
    expect(day('2026-11-07').balance).toBe(2000);
    expect(day('2026-12-01').balance).toBe(200);
    expect(day('2026-12-02').balance).toBe(3200);

    expect(calendar.lowest?.date).toBe('2026-12-01');
    expect(calendar.firstBelow?.date).toBe('2026-12-01');
    expect(calendar.nextIncome?.date).toBe('2026-12-02');
    // Netflix fires again on Dec 7, inside the window.
    expect(calendar.billCount).toBe(3);
    expect(calendar.billsTotal).toBe(1832);
  });

  it('takes typical day-to-day spending off every day after today', () => {
    const calendar = buildCashCalendar({ ...base, until: '2026-11-08', schedules: [], dailySpend: 25 });
    expect(calendar.days.map(d => d.balance)).toEqual([2000, 1975, 1950, 1925]);
  });

  it('has nothing to warn about without a line or a dip', () => {
    expect(buildCashCalendar({ ...base, schedules: [], threshold: null }).firstBelow).toBeNull();
    expect(buildCashCalendar({ ...base, schedules: [] }).firstBelow).toBeNull();
  });
});
