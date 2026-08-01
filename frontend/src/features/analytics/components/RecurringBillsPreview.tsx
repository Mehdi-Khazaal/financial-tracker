import React from 'react';
import type { RecurringOutlook } from '../types';
import { dayLabel, dollars, plural, relativeDays } from '../format';
import { PanelEmpty, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  outlook: RecurringOutlook;
  onNavigate: (to: string, tab?: string) => void;
}

const PREVIEW_COUNT = 4;

/**
 * What is about to leave the account.
 *
 * Sourced entirely from the user's declared recurring transactions, so the
 * dates and amounts are stated rather than inferred. Short-cycle bills are
 * expanded — a weekly charge really does hit four times in thirty days, and
 * showing it once would understate the month.
 */
const RecurringBillsPreview: React.FC<Props> = ({ outlook, onNavigate }) => {
  const upcoming = outlook.upcoming.filter(bill => bill.daysUntil <= 30);
  const overdue = upcoming.filter(bill => bill.daysUntil < 0);
  const preview = upcoming.slice(0, PREVIEW_COUNT);

  return (
    <section className="ledger-panel p-4 md:p-5 h-full flex flex-col" aria-labelledby="analytics-bills-heading">
      <SectionHeader
        id="analytics-bills-heading"
        eyebrow="Coming up"
        title="Bills in the next 30 days"
        hint="Taken from the recurring transactions you have set up. Variable bills use your most recent amount as an estimate, so the total is indicative rather than exact."
        right={
          <button
            type="button"
            onClick={() => onNavigate('/transactions', 'recurring')}
            className="text-xs font-semibold pressable"
            style={{ color: 'var(--accent)' }}
          >
            View all →
          </button>
        }
      />

      {upcoming.length === 0 ? (
        <PanelEmpty
          title="No bills scheduled"
          body="Set up your recurring bills and subscriptions to see what is due, and to split spending into fixed and variable on the cash-flow chart."
          action={
            <button
              type="button"
              onClick={() => onNavigate('/transactions', 'recurring')}
              className="btn-gradient px-5 py-2.5 text-sm mt-1"
            >
              Set up recurring bills
            </button>
          }
        />
      ) : (
        <>
          <div className="ledger-cell p-3.5 mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="label mb-1">Due in the next 30 days</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {plural(outlook.next30DaysCount, 'charge')}
                {overdue.length > 0 && ` · ${plural(overdue.length, 'overdue charge')}`}
              </p>
            </div>
            <p
              className="font-mono tabular-nums text-lg font-bold shrink-0"
              style={{ color: 'var(--fg)' }}
            >
              {dollars(outlook.next30DaysTotal)}
            </p>
          </div>

          <ul className="space-y-2 flex-1">
            {preview.map(bill => (
              <li
                key={`${bill.id}-${bill.dueDate}`}
                className="flex items-center gap-3 py-1.5"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: bill.categoryColor }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>
                    {bill.name}
                  </p>
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--dim)' }}>
                    {dayLabel(bill.dueDate)} · {relativeDays(bill.daysUntil)}
                    {bill.categoryName && ` · ${bill.categoryName}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono tabular-nums text-xs font-semibold" style={{ color: 'var(--fg)' }}>
                    {dollars(bill.amount)}
                  </p>
                  {bill.isVariable && (
                    <p className="text-[9px]" style={{ color: 'var(--dim)' }}>estimated</p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {upcoming.length > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => onNavigate('/transactions', 'recurring')}
              className="w-full mt-3 pt-3 text-xs font-semibold pressable"
              style={{ borderTop: '1px solid var(--line)', color: 'var(--accent)', minHeight: 44 }}
            >
              {plural(upcoming.length - PREVIEW_COUNT, 'more charge')} scheduled
            </button>
          )}
        </>
      )}
    </section>
  );
};

export default RecurringBillsPreview;
