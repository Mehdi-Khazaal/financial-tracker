import React from 'react';
import { MINUS, dollars } from '../../analytics/format';
import type { DayGroup } from '../calculations/timeline';

/**
 * A day's heading in the Timeline.
 *
 * Deliberately one line on mobile and one line on desktop: a day separator that
 * grows taller than the rows it separates stops being a separator. The net is
 * the headline figure because "what did this day cost me" is the question a day
 * boundary raises; income and spending sit behind it as the working.
 *
 * Not sticky. Transactions already has a fixed header above and, on mobile, a
 * segmented control and dock below; a third pinned element would leave very
 * little actually-scrolling viewport on a small phone.
 */

const DayHeader: React.FC<{ day: DayGroup }> = ({ day }) => (
  <div
    className="flex items-baseline justify-between gap-3 px-4 py-2"
    style={{ backgroundColor: 'var(--elev-sub)', borderBottom: '1px solid var(--line)' }}
  >
    <div className="flex items-baseline gap-2 min-w-0">
      <h3 className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--fg)' }}>
        {day.label}
      </h3>
      <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--dim)' }}>
        {day.count === 1 ? '1 transaction' : `${day.count} transactions`}
      </span>
    </div>

    <div className="flex items-baseline gap-2.5 shrink-0">
      {day.income > 0 && (
        <span className="font-mono tabular-nums text-[11px]" style={{ color: 'var(--pos)' }}>
          +{dollars(day.income)}
        </span>
      )}
      {day.expenses > 0 && (
        <span className="font-mono tabular-nums text-[11px]" style={{ color: 'var(--neg)' }}>
          {MINUS}{dollars(day.expenses)}
        </span>
      )}
      {/* Only worth a line when both sides moved; otherwise it just repeats. */}
      {day.income > 0 && day.expenses > 0 && (
        <span
          className="font-mono tabular-nums text-[11px] font-semibold"
          style={{ color: day.net >= 0 ? 'var(--pos)' : 'var(--neg)' }}
        >
          {day.net >= 0 ? '+' : MINUS}{dollars(day.net)}
        </span>
      )}
    </div>
  </div>
);

export default DayHeader;
