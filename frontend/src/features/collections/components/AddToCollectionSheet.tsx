import React, { useEffect, useState } from 'react';
import BottomSheet from '../../../components/BottomSheet';
import type { Collection, CollectionAddResult } from '../../../types';
import { addToCollection, createCollection } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { plural } from '../../analytics/format';
import { dateRangeLabel, pickableCollections } from '../calculations/collections';
import { errorText } from '../errors';
import CollectionBadge from './CollectionBadge';

/**
 * Where should the selected transactions go? Pick a collection, or name a new
 * one — its dates default to the span of the selection, so a trip made after
 * the fact still gets suggestions for anything that was missed.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  collections: Collection[];
  transactionIds: number[];
  /** First and last date among the selected transactions. */
  span: { from: string; to: string } | null;
  todayKey: string;
  onAdded: (result: CollectionAddResult) => void;
}

export function addedMessage(result: CollectionAddResult): string {
  const parts = [
    result.added > 0
      ? `Added ${plural(result.added, 'transaction')} to ${result.collection.name}`
      : `Nothing new added to ${result.collection.name}`,
  ];
  if (result.already > 0) parts.push(`${result.already} already there`);
  if (result.skipped_card_payments > 0) parts.push(`${plural(result.skipped_card_payments, 'card payment')} left out`);
  return parts.join(' · ');
}

const AddToCollectionSheet: React.FC<Props> = ({ isOpen, onClose, collections, transactionIds, span, todayKey, onAdded }) => {
  const toast = useToast();
  const [name, setName] = useState('');
  const [useDates, setUseDates] = useState(true);
  const [busy, setBusy] = useState(false);
  const options = pickableCollections(collections).sort((a, b) => Number(b.active) - Number(a.active));

  useEffect(() => { if (isOpen) { setName(''); setUseDates(true); setBusy(false); } }, [isOpen]);

  const add = async (collection: Collection) => {
    setBusy(true);
    try {
      const res = await addToCollection(collection.id, transactionIds);
      toast.success(addedMessage(res.data));
      onAdded(res.data);
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Could not add to the collection'));
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await createCollection({
        name: trimmed,
        start_date: useDates && span ? span.from : null,
        end_date: useDates && span ? span.to : null,
      });
      await add(created.data);
    } catch (err) {
      toast.error(errorText(err, 'Could not create the collection'));
      setBusy(false);
    }
  };

  const spanLabel = span ? dateRangeLabel({ start_date: span.from, end_date: span.to }, todayKey) : '';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={`Add ${plural(transactionIds.length, 'transaction')} to…`}>
      <div className="px-5 pb-6 space-y-4">
        {options.length > 0 && (
          <ul className="space-y-1.5" aria-label="Collections">
            {options.map(c => {
              const range = dateRangeLabel(c, todayKey);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => void add(c)} disabled={busy}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left pressable disabled:opacity-50"
                    style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                    <CollectionBadge collection={c} size="sm" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{c.name}</span>
                      <span className="block text-[11px] truncate" style={{ color: 'var(--dim)' }}>
                        {[range, c.active ? 'Running now' : null, plural(c.totals.count, 'transaction')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={createAndAdd} className="space-y-2">
          <label className="form-label" htmlFor="add-to-new-collection">{options.length > 0 ? 'Or a new collection' : 'New collection'}</label>
          <div className="flex gap-2">
            <input id="add-to-new-collection" type="text" value={name} onChange={e => setName(e.target.value)}
              className="input-dark flex-1 text-sm" placeholder="e.g. Ohio trip" maxLength={60} autoComplete="off" />
            <button type="submit" disabled={busy || !name.trim()} className="btn-gradient px-4 min-h-[44px] text-sm disabled:opacity-40">
              Create
            </button>
          </div>
          {span && (
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--muted)', minHeight: 32 }}>
              <input type="checkbox" checked={useDates} onChange={e => setUseDates(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
              Use these dates ({spanLabel})
            </label>
          )}
        </form>
      </div>
    </BottomSheet>
  );
};

export default AddToCollectionSheet;
