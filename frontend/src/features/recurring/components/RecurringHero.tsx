import React from 'react';
import type { RecurringOverview } from '../../../types';
import { InfoHint } from '../../analytics/components/AnalyticsPrimitives';
import { dollars, plural } from '../../analytics/format';
import { num, paidShare } from '../calculations';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const EXPECTED_DEFINITION =
  'Everything your tracked bills and subscriptions will cost this calendar month: what has already been paid, plus every charge still due before the month ends. '
  + 'Weekly bills count each week they fall in; a yearly renewal counts only in the month it renews.';

export const TYPICAL_DEFINITION =
  'Every active bill converted to a monthly equivalent — a $120 yearly charge counts as $10. This is what recurring costs average out to, month after month.';

/**
 * The page's one question: how much will recurring bills cost this month?
 *
 * Paid and still-to-come are shown as one bar because they are one total —
 * the server guarantees the two parts never overlap, so the bar can be read
 * left to right as the month progressing.
 */
const RecurringHero: React.FC<{ overview: RecurringOverview }> = ({ overview }) => {
  const monthIndex = Number(overview.month.slice(5, 7)) - 1;
  const monthName = MONTH_NAMES[monthIndex] ?? 'This month';
  const expected = num(overview.expected_this_month);
  const paid = num(overview.paid_this_month);
  const remaining = num(overview.remaining_this_month);
  const share = paidShare(overview);
  const income = num(overview.income_typical_monthly);

  return (
    <section
      className="hero-card rounded-xl p-5 md:p-7"
      aria-labelledby="recurring-expected-label"
      style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', boxShadow: 'var(--edge-light), var(--shadow-card)' }}
    >
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="flex items-center gap-1.5 mb-3">
          <p className="label" id="recurring-expected-label">Recurring in {monthName}</p>
          <InfoHint label="How the monthly recurring figure is calculated" text={EXPECTED_DEFINITION} />
        </div>

        <p className="value-display tabular-nums" style={{ fontFamily: 'var(--font-money)', fontSize: 'clamp(2.25rem, 5vw, 3.5rem)' }}>
          {dollars(expected)}
        </p>
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
          expected across {plural(overview.bill_count, 'recurring charge')}
        </p>

        <div
          className="mt-5 h-2.5 rounded-full overflow-hidden flex"
          style={{ backgroundColor: 'var(--line-strong)' }}
          role="img"
          aria-label={`${dollars(paid)} paid, ${dollars(remaining)} still to come`}
        >
          <span className="h-full" style={{ width: `${share * 100}%`, backgroundColor: 'var(--pos)', transition: 'width 500ms var(--ease-out)' }} />
        </div>

        <dl className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <dt className="label mb-1.5">Paid so far</dt>
            <dd className="font-mono tabular-nums text-sm font-medium" style={{ color: 'var(--pos)' }}>{dollars(paid)}</dd>
          </div>
          <div>
            <dt className="label mb-1.5">Still to come</dt>
            <dd className="font-mono tabular-nums text-sm font-medium" style={{ color: remaining > 0 ? 'var(--accent)' : 'var(--muted)' }}>
              {remaining > 0 ? dollars(remaining) : 'Nothing left this month'}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-5 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Typical month</span>
            <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--fg)' }}>{dollars(num(overview.typical_monthly))}</span>
            <InfoHint label="What a typical month means" text={TYPICAL_DEFINITION} />
          </span>
          {income > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>Recurring income</span>
              <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--pos)' }}>{dollars(income)}</span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
};

export default RecurringHero;
