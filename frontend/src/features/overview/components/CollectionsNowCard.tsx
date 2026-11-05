import React from 'react';
import { Link } from 'react-router-dom';
import { dollars } from '../../analytics/format';
import { linkToCollection, linkToCollections } from '../../../lib/deepLinks';
import { budgetProgress, collectionColor, serverTotals, statusLabel } from '../../collections/calculations/collections';
import type { DashboardCollection } from '../../collections/calculations/periods';
import CollectionBadge from '../../collections/components/CollectionBadge';

/**
 * Collections on the Dashboard: only while one is running or had spending
 * this month. Most months have none, and then this card is not rendered.
 * A running one shows its cost so far; a past one, what it added this month.
 */
const CollectionsNowCard: React.FC<{ items: DashboardCollection[]; todayKey: string }> = ({ items, todayKey }) => {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="overview-collections">
      <div className="flex items-center justify-between mb-3">
        <p id="overview-collections" className="label">Collections</p>
        <Link to={linkToCollections()} className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all →</Link>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {items.slice(0, 4).map(({ collection, monthSpent }) => {
          const net = serverTotals(collection).net;
          const amount = collection.active ? net : monthSpent;
          const budget = collection.active ? budgetProgress(net, collection.budget) : null;
          return (
            <Link key={collection.id} to={linkToCollection(collection.id)} className="rounded-lg p-4 flex items-center gap-3 pressable"
              style={{ backgroundColor: 'var(--elev-1)' }}>
              <CollectionBadge collection={collection} size="sm" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{collection.name}</span>
                <span className="block text-[11px] truncate" style={{ color: collection.active ? collectionColor(collection) : 'var(--dim)' }}>
                  {collection.active ? statusLabel(collection, todayKey) : 'This month'}
                  {budget && ` · ${budget.over ? 'over budget' : `${dollars(budget.remaining, 0)} left`}`}
                </span>
              </span>
              <span className="font-mono tabular-nums text-sm font-bold shrink-0" style={{ color: 'var(--fg)' }}>
                {dollars(amount)}
                <span className="block text-[10px] font-normal text-right" style={{ color: 'var(--dim)' }}>{collection.active ? 'so far' : 'spent'}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default CollectionsNowCard;
