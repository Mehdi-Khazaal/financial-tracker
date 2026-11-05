import React, { useEffect, useMemo, useState } from 'react';
import BottomSheet from '../../../components/BottomSheet';
import type { Account, Collection, CollectionAddResult, CollectionSuggestion } from '../../../types';
import { cleanDescription, getCollectionSuggestions, reviewCollectionSuggestions } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { dayLabel, dollars, plural } from '../../analytics/format';
import { errorText } from '../errors';

/**
 * "These happened during your trip — which belong to it?"
 *
 * Suggest, never decide: nothing joins the collection until the user taps
 * Add. Regular bills, pay and the like start unchecked because a trip rarely
 * includes the rent. Whatever is left unchecked counts as seen and only comes
 * back if the user asks for everything again.
 */
interface Props {
  collection: Collection;
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onReviewed: (result: CollectionAddResult) => void;
}

const SuggestionsSheet: React.FC<Props> = ({ collection, isOpen, onClose, accounts, onReviewed }) => {
  const toast = useToast();
  const [rows, setRows] = useState<CollectionSuggestion[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getCollectionSuggestions(collection.id, showAll)
      .then(res => {
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setRows(list);
        setPicked(new Set(list.filter(s => s.recommended).map(s => s.transaction.id)));
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, collection.id, showAll]);

  useEffect(() => { if (!isOpen) setShowAll(false); }, [isOpen]);

  const pickedTotal = useMemo(
    () => rows.filter(s => picked.has(s.transaction.id)).reduce((sum, s) => sum + -Number(s.transaction.amount), 0),
    [rows, picked],
  );

  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    setSaving(true);
    try {
      const res = await reviewCollectionSuggestions(collection.id, Array.from(picked));
      const { added } = res.data;
      toast.success(added > 0 ? `Added ${plural(added, 'transaction')} to ${collection.name}` : 'Marked as reviewed');
      onReviewed(res.data);
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Could not save your picks'));
    } finally {
      setSaving(false);
    }
  };

  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? '';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={`Add to ${collection.name}`} size="lg">
      <div className="px-5 pb-5">
        <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--muted)' }}>
          Transactions from these dates that are not in the collection yet. Pick the ones that belong;
          regular bills and pay start unchecked.
        </p>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map(i => <div key={i} className="h-12 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--elev-1)' }} />)}
          </div>
        ) : failed ? (
          <p className="text-sm py-6 text-center" role="alert" style={{ color: 'var(--neg)' }}>Suggestions could not be loaded.</p>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>Nothing new from these dates</p>
            {!showAll && (
              <button type="button" onClick={() => setShowAll(true)} className="text-xs font-semibold mt-2 pressable"
                style={{ color: 'var(--accent)', minHeight: 40 }}>
                Show ones I skipped before
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs" style={{ color: 'var(--dim)' }}>{picked.size} of {rows.length} picked</p>
              <button
                type="button"
                className="text-xs font-semibold pressable px-1"
                style={{ color: 'var(--accent)', minHeight: 36 }}
                onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map(s => s.transaction.id)))}
              >
                {picked.size === rows.length ? 'Select none' : 'Select all'}
              </button>
            </div>
            <ul className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--line)' }}>
              {rows.map((s, i) => {
                const tx = s.transaction;
                const amount = Number(tx.amount);
                const checked = picked.has(tx.id);
                const id = `suggestion-${tx.id}`;
                return (
                  <li key={tx.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none', backgroundColor: checked ? 'var(--elev-1)' : 'transparent' }}>
                    <label htmlFor={id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                      <input id={id} type="checkbox" checked={checked} onChange={() => toggle(tx.id)} className="w-4 h-4 shrink-0 accent-[var(--accent)]" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{cleanDescription(tx.description)}</span>
                        <span className="block text-[11px] truncate" style={{ color: 'var(--dim)' }}>
                          {[dayLabel(tx.transaction_date), accountName(tx.account_id), s.reason].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums text-sm shrink-0" style={{ color: amount >= 0 ? 'var(--pos)' : 'var(--fg)' }}>
                        {amount >= 0 ? '+' : '−'}{dollars(Math.abs(amount))}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={submit}
            disabled={saving || loading || failed || rows.length === 0}
            className="btn-gradient flex-1 min-h-[44px] text-sm disabled:opacity-40"
          >
            {saving ? 'Saving…' : picked.size > 0 ? `Add ${picked.size} · ${dollars(Math.max(0, pickedTotal))}` : 'Skip these'}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] px-4 text-sm">Not now</button>
        </div>
      </div>
    </BottomSheet>
  );
};

export default SuggestionsSheet;
