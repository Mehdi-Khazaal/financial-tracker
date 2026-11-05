import React from 'react';
import { Link } from 'react-router-dom';
import ProgressBar from '../../../components/ProgressBar';
import { dollars, percent, plural } from '../format';
import { linkToCollection } from '../../../lib/deepLinks';
import { collectionColor } from '../../collections/calculations/collections';
import type { CollectionPeriodSpend } from '../../collections/calculations/periods';
import CollectionBadge from '../../collections/components/CollectionBadge';
import { SectionHeader } from './AnalyticsPrimitives';

/**
 * What trips, holidays and moves added to this period.
 *
 * Shown only when the period has some. The switch takes collection spending
 * out of every figure on the page, so a month with a trip can be compared
 * with a normal one; turning it off brings the true totals back.
 */
interface Props {
  items: CollectionPeriodSpend[];
  /** The period's spending with collections included. */
  periodExpenses: number;
  /** Spending in any collection, each transaction once (collections can overlap). */
  inCollections: number;
  /** Money received inside collections; leaving them out removes it too. */
  received?: number;
  periodLabel: string;
  excluded: boolean;
  onToggle: () => void;
}

const CollectionsSpendCard: React.FC<Props> = ({ items, periodExpenses, inCollections, received = 0, periodLabel, excluded, onToggle }) => {
  const total = Math.max(0, inCollections);
  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-collections-heading">
      <SectionHeader
        id="analytics-collections-heading"
        eyebrow="Collections"
        title={excluded ? 'Showing the period without collections' : `Trips and events in ${periodLabel}`}
        description={excluded
          ? `Every figure on this page leaves out the ${dollars(total)} spent in collections${received > 0 ? ` and the ${dollars(received)} received in them` : ''}. Turn the switch off for the true totals.`
          : `${dollars(total)} of ${dollars(periodExpenses)} spending${periodExpenses > 0 ? ` (${percent(Math.min(1, total / periodExpenses), 0)})` : ''} went to collections. It still counts in its categories.`}
        right={(
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer shrink-0" style={{ color: 'var(--muted)', minHeight: 44 }}>
            Leave out
            <button
              type="button"
              role="switch"
              aria-checked={excluded}
              aria-label="Leave collection spending out of this page"
              onClick={onToggle}
              className="relative w-11 h-6 rounded-full transition-colors"
              style={{ backgroundColor: excluded ? 'var(--accent)' : 'var(--line)' }}
            >
              <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform"
                style={{ transform: excluded ? 'translateX(20px)' : 'translateX(0)' }} />
            </button>
          </label>
        )}
      />
      <ul className="space-y-3">
        {items.map(({ collection, spent, count }) => (
          <li key={collection.id}>
            <Link to={linkToCollection(collection.id)} className="flex items-center gap-3 pressable rounded-lg">
              <CollectionBadge collection={collection} size="sm" />
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{collection.name}</span>
                  <span className="font-mono tabular-nums text-sm shrink-0" style={{ color: 'var(--fg)' }}>{dollars(spent)}</span>
                </span>
                <span className="block mt-1">
                  <ProgressBar value={periodExpenses > 0 ? Math.min(100, (spent / periodExpenses) * 100) : 0} color={collectionColor(collection)} height={4} semantics="progress"
                    label={`${percent(periodExpenses > 0 ? Math.min(1, spent / periodExpenses) : 0, 0)} of this period's spending`} />
                </span>
                <span className="block text-[11px] mt-1" style={{ color: 'var(--dim)' }}>{plural(count, 'transaction')} in this period</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default CollectionsSpendCard;
