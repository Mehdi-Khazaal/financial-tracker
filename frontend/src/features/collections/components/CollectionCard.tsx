import React from 'react';
import { Link } from 'react-router-dom';
import type { Collection } from '../../../types';
import ProgressBar from '../../../components/ProgressBar';
import { dollars, plural } from '../../analytics/format';
import { linkToCollection } from '../../../lib/deepLinks';
import { budgetProgress, collectionColor, dateRangeLabel, netDisplay, serverTotals, statusLabel } from '../calculations/collections';
import CollectionBadge from './CollectionBadge';

/** One collection in the list: what it is, when, and what it cost. */
const CollectionCard: React.FC<{ collection: Collection; todayKey: string }> = ({ collection, todayKey }) => {
  const totals = serverTotals(collection);
  const range = dateRangeLabel(collection, todayKey);
  const status = statusLabel(collection, todayKey);
  const budget = budgetProgress(totals.net, collection.budget);
  const subtitle = [range, status].filter(Boolean).join(' · ');
  const net = netDisplay(totals.net);

  return (
    <Link
      to={linkToCollection(collection.id)}
      className="block rounded-xl p-4 pressable"
      style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', opacity: collection.is_archived ? 0.75 : 1 }}
      aria-label={`${collection.name}, ${subtitle}, ${net.label.toLowerCase()} ${net.text}`}
    >
      <div className="flex items-start gap-3">
        <CollectionBadge collection={collection} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }} title={collection.name}>{collection.name}</p>
            <p className="font-mono tabular-nums text-sm font-bold shrink-0" style={{ color: net.color ?? 'var(--fg)' }}>{net.text}</p>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{subtitle}</p>
            <p className="text-[11px] shrink-0" style={{ color: 'var(--dim)' }}>{plural(totals.count, 'transaction')}</p>
          </div>
          {budget && (
            <div className="mt-2.5">
              <ProgressBar
                value={budget.percent}
                color={budget.over ? 'var(--neg)' : collectionColor(collection)}
                height={4}
                semantics="progress"
                label={`${dollars(budget.used)} of ${dollars(budget.budget)} budget used`}
              />
              <p className="text-[11px] mt-1" style={{ color: budget.over ? 'var(--neg)' : 'var(--dim)' }}>
                {budget.over ? `${dollars(-budget.remaining)} over the ${dollars(budget.budget)} budget` : `${dollars(budget.remaining)} left of ${dollars(budget.budget)}`}
              </p>
            </div>
          )}
          {collection.suggestion_count > 0 && (
            <p className="inline-block mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ color: 'var(--accent)', backgroundColor: 'color-mix(in oklab, var(--accent) 12%, transparent)' }}>
              {plural(collection.suggestion_count, 'transaction')} to review
            </p>
          )}
        </div>
      </div>
    </Link>
  );
};

export default CollectionCard;
