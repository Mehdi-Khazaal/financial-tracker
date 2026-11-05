import React from 'react';
import { Link } from 'react-router-dom';
import { plural, verbFor } from '../../analytics/format';
import type { ImportReview } from '../calculations/review';
import { linkToReview } from '../../../lib/deepLinks';

/**
 * Compact when there is nothing to do, expanded when there is.
 *
 * The old card was full height whatever it had to say, and padded itself out
 * with "Savings 0%" and "Top none". A savings rate has no bearing on whether
 * imports are filed, and "none" is a placeholder pretending to be data. Both
 * are gone: an empty fact is now simply absent rather than printed as a word.
 *
 * The route into the Review tab survives in both states — finishing the queue
 * should not hide the way back to it.
 */

interface Props {
  review: ImportReview;
  monthName: string;
}

const ImportReviewCard: React.FC<Props> = ({ review, monthName }) => {
  if (review.isComplete) {
    return (
      <section className="py-3" aria-labelledby="overview-review-heading" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center gap-3">
          <svg
            viewBox="0 0 20 20" fill="none" stroke="var(--pos)" strokeWidth={1.7}
            strokeLinecap="round" strokeLinejoin="round"
            className="w-[18px] h-[18px] shrink-0" aria-hidden="true"
          >
            <path d="M6.5 10.5l2.5 2.5 4.5-5M10 17.5a7.5 7.5 0 110-15 7.5 7.5 0 010 15z" />
          </svg>
          <div className="min-w-0 flex-1">
            {/* "All categorized" would be false while older months still
                have gaps, so the title only claims this month then. */}
            <p className="text-sm font-semibold" id="overview-review-heading" style={{ color: 'var(--fg)' }}>
              {review.total === 0
                ? review.olderUnreviewed > 0 ? `Nothing new in ${monthName}` : 'Nothing to review yet'
                : review.olderUnreviewed > 0 ? `${monthName} is fully categorized` : 'All transactions categorized'}
            </p>
            {review.olderUnreviewed > 0 && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {plural(review.olderUnreviewed, 'transaction')} from earlier months
                {' '}still {verbFor(review.olderUnreviewed, 'need')} a category.
              </p>
            )}
          </div>
          <Link
            to={linkToReview()}
            className="section-link shrink-0 flex items-center px-1"
            style={{ minHeight: 36 }}
          >
            Review →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <Link
      to={linkToReview()}
      className="row-link block py-4"
      style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
      aria-label={`Review uncategorized transactions. ${review.unreviewed} of ${review.total} transactions in ${monthName} need a category.`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] mb-0.5" style={{ color: 'var(--muted)' }}>Transaction review</p>
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>
            {plural(review.unreviewed, 'transaction')} {verbFor(review.unreviewed, 'need')} a category
          </p>
        </div>
        <span className="font-mono text-sm font-semibold shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true">
          {review.rate}%
        </span>
      </div>
      <div className="review-meter mt-3" aria-hidden="true"><span style={{ width: `${review.rate}%` }} /></div>
      <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
        {review.rate}% of {monthName}&rsquo;s {plural(review.total, 'transaction')} reviewed
        {review.olderUnreviewed > 0 && ` · ${review.olderUnreviewed} older still unfiled`}
      </p>
    </Link>
  );
};

export default ImportReviewCard;
