import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Collection } from '../../../types';
import { getCollections } from '../../../utils/api';
import { localDateStr } from '../../../utils/date';
import { linkToCollection } from '../../../lib/deepLinks';
import LoadErrorBanner from '../../../components/LoadErrorBanner';
import { groupCollections } from '../calculations/collections';
import CollectionCard from './CollectionCard';
import CollectionFormSheet from './CollectionFormSheet';

/**
 * The Collections tab: every trip, holiday or move the user has grouped.
 *
 * Running and upcoming ones lead, then the rest, with archived ones folded
 * away. A collection is a lens on the ledger — this list never shows money
 * that is not also in the Timeline.
 */
interface Props {
  /** Open the new-collection form on arrival (⌘K "New collection"). */
  openNew?: boolean;
  onOpenNewHandled?: () => void;
}

const CollectionsView: React.FC<Props> = ({ openNew = false, onOpenNewHandled }) => {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const todayKey = localDateStr();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await getCollections();
      setCollections(Array.isArray(res.data) ? res.data : []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!openNew) return;
    setShowForm(true);
    onOpenNewHandled?.();
  }, [openNew, onOpenNewHandled]);

  const groups = useMemo(() => groupCollections(collections, todayKey), [collections, todayKey]);

  return (
    <div className="flex-1 overflow-y-auto app-scrollbar mobile-tabs-spacer md:pb-4">
      <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--fg)' }}>Collections</h2>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
              Group a trip, a holiday or a move to see what it cost. Transactions stay in the Timeline and their categories.
            </p>
          </div>
          <button type="button" onClick={() => setShowForm(true)} className="header-action header-action--primary text-sm shrink-0">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            <span>New</span>
          </button>
        </div>

        {failed && <LoadErrorBanner message="Collections could not be loaded." onRetry={() => void load()} />}

        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading collections">
            {[0, 1].map(i => <div key={i} className="rounded-xl h-20 animate-pulse" style={{ backgroundColor: 'var(--elev-1)' }} />)}
          </div>
        ) : !failed && collections.length === 0 ? (
          <div className="rounded-xl py-12 px-6 text-center" style={{ backgroundColor: 'var(--elev-1)', border: '1px dashed var(--line)' }}>
            <p className="text-3xl mb-2" aria-hidden="true">🧳</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>No collections yet</p>
            <p className="text-xs mt-1.5 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--muted)' }}>
              Back from a trip? Make a collection, give it the trip's dates, and Fintrack lists the transactions from those days for you to pick.
            </p>
            <button type="button" onClick={() => setShowForm(true)} className="btn-gradient mt-4 px-5 min-h-[44px] text-sm">
              Create a collection
            </button>
          </div>
        ) : (
          <>
            {groups.current.length > 0 && (
              <section aria-labelledby="collections-current">
                <p id="collections-current" className="label mb-2">Now and upcoming</p>
                <div className="space-y-2">
                  {groups.current.map(c => <CollectionCard key={c.id} collection={c} todayKey={todayKey} />)}
                </div>
              </section>
            )}
            {groups.other.length > 0 && (
              <section aria-labelledby="collections-other">
                <p id="collections-other" className="label mb-2">{groups.current.length > 0 ? 'Others' : 'Your collections'}</p>
                <div className="space-y-2">
                  {groups.other.map(c => <CollectionCard key={c.id} collection={c} todayKey={todayKey} />)}
                </div>
              </section>
            )}
            {groups.archived.length > 0 && (
              <section>
                <button
                  type="button"
                  onClick={() => setShowArchived(v => !v)}
                  aria-expanded={showArchived}
                  className="text-xs font-semibold px-1 pressable"
                  style={{ color: 'var(--muted)', minHeight: 40 }}
                >
                  {showArchived ? 'Hide' : 'Show'} archived ({groups.archived.length})
                </button>
                {showArchived && (
                  <div className="space-y-2 mt-1">
                    {groups.archived.map(c => <CollectionCard key={c.id} collection={c} todayKey={todayKey} />)}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      <CollectionFormSheet
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        onSaved={collection => navigate(linkToCollection(collection.id, Boolean(collection.start_date)))}
      />
    </div>
  );
};

export default CollectionsView;
