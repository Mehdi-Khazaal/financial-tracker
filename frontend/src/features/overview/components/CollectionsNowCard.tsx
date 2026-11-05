import React from 'react';
import { Link } from 'react-router-dom';
import { dollars } from '../../analytics/format';
import { linkToCollection, linkToCollections } from '../../../lib/deepLinks';
import { budgetProgress, netDisplay, serverTotals, statusLabel } from '../../collections/calculations/collections';
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
      <div className="flex items-baseline justify-between mb-2">
        <h2 id="overview-collections" className="section-title">Collections</h2>
        <Link to={linkToCollections()} className="section-link">View all →</Link>
      </div>
      <div className="row-list">
        {items.slice(0, 4).map(({ collection, monthSpent }) => {
          const net = serverTotals(collection).net;
          const amount = collection.active ? netDisplay(net) : { text: dollars(monthSpent), color: undefined };
          const budget = collection.active ? budgetProgress(net, collection.budget) : null;
          return (
            <Link key={collection.id} to={linkToCollection(collection.id)} className="row-link flex items-center gap-3 py-3">
              <CollectionBadge collection={collection} size="sm" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{collection.name}</span>
                {/* A collection's own colour marks it, never its text. */}
                <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>
                  {collection.active ? statusLabel(collection, todayKey) : 'This month'}
                  {budget && !budget.over && ` · ${dollars(budget.remaining, 0)} left`}
                  {budget?.over && <> · <span style={{ color: 'var(--neg)' }}>over budget</span></>}
                </span>
              </span>
              <span className="tabular-nums text-sm font-semibold shrink-0 text-right" style={{ color: amount.color ?? 'var(--fg)' }}>
                {amount.text}
                <span className="block text-xs font-normal" style={{ color: 'var(--muted)' }}>{collection.active ? 'so far' : 'spent'}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default CollectionsNowCard;
