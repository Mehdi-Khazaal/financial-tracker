import React from 'react';
import { Link } from 'react-router-dom';
import { dollars, relativeDays } from '../../analytics/format';
import type { UpcomingBill } from '../../analytics/types';
import type { MonthActivity } from '../types';
import { linkToRecurring } from '../../../lib/deepLinks';

/**
 * Replaces the Transfer / Withdraw / Deposit buttons.
 *
 * Those were shortcuts for recording money by hand, which is not how Fintrack
 * works any more — activity arrives from linked accounts. The space is worth
 * more as an answer to "has anything actually landed this month?".
 *
 * Deliberately not a second Recent Activity list: counts and dates only, no
 * transaction rows. Analytics owns the itemised view.
 */

interface Props {
  activity: MonthActivity;
  /** Next declared recurring charge, when one is due. */
  nextCharge: UpcomingBill | null;
}

const MonthActivityCard: React.FC<Props> = ({ activity, nextCharge }) => {
  return (
    <section className="ledger-panel p-4" aria-labelledby="overview-activity-heading">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="label" id="overview-activity-heading">{activity.monthName} activity</p>
        <Link to="/transactions" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          View all →
        </Link>
      </div>

      {/* The count states the fact; the hero carries the fuller explanation of
          a quiet month, so the two are never the same sentence twice. */}
      {/* No `tabular-nums` on a count or a date — privacy mode blurs that class,
          and hiding how many transactions posted protects nothing. */}
      <p
        className="font-mono text-2xl font-semibold"
        style={{ color: activity.postedCount === 0 ? 'var(--muted)' : 'var(--fg)' }}
      >
        {activity.postedCount}
        <span className="text-xs ml-2 font-normal" style={{ color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>
          {activity.postedCount === 1 ? 'transaction posted' : 'transactions posted'}
        </span>
      </p>

      <dl className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs" style={{ color: 'var(--dim)' }}>Last posted</dt>
          <dd className="text-xs font-mono" style={{ color: 'var(--muted)' }}>
            {activity.lastPostedLabel ?? 'None yet'}
          </dd>
        </div>

        {nextCharge && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs truncate min-w-0" style={{ color: 'var(--dim)' }}>
              {/* Straight to the recurring list, where this charge is editable. */}
              <Link to={linkToRecurring()} style={{ color: 'inherit' }}>
                Next charge · {nextCharge.name}
              </Link>
            </dt>
            <dd className="text-xs font-mono tabular-nums shrink-0" style={{ color: 'var(--muted)' }}>
              {nextCharge.isVariable ? '~' : ''}{dollars(nextCharge.amount)} {relativeDays(nextCharge.daysUntil)}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
};

export default MonthActivityCard;
