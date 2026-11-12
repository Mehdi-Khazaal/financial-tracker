import React, { useEffect, useRef, useState } from 'react';
import BottomSheet from '../../../components/BottomSheet';
import { createCollection, deleteCollection, updateCollection } from '../../../utils/api';
import type { Collection, CollectionDraft } from '../../../types';
import { useToast } from '../../../context/ToastContext';
import { errorText } from '../errors';
import { shouldAutoFocus } from '../../../utils/device';

/**
 * Create or edit a collection (a trip, a holiday, a move).
 *
 * Only the name is required. Dates are optional: with them the app can
 * suggest the transactions that happened in that window and show the
 * collection as running on the Dashboard; without them it is just a folder
 * the user fills by hand.
 */

export const COLLECTION_EMOJIS = ['✈️', '🚗', '🏖️', '🏠', '🎄', '🎁', '💍', '🎓', '🏥', '🛠️', '🎉', '📦'];
export const COLLECTION_COLORS = ['#ff8e53', '#f59e0b', '#10b981', '#1abc9c', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Absent when creating. */
  editing?: Collection | null;
  /** Prefill for a new one, e.g. the dates of the selected transactions. */
  initial?: Partial<CollectionDraft>;
  onSaved: (collection: Collection) => void;
  /** Called after a delete; the sheet closes itself. */
  onDeleted?: (id: number) => void;
}

const CollectionFormSheet: React.FC<Props> = ({ isOpen, onClose, editing = null, initial, onSaved, onDeleted }) => {
  const toast = useToast();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [color, setColor] = useState(COLLECTION_COLORS[0]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const source = editing ?? initial ?? {};
    setName(source.name ?? '');
    setEmoji(source.emoji ?? '');
    setColor(source.color ?? COLLECTION_COLORS[0]);
    setStartDate(source.start_date ?? '');
    setEndDate(source.end_date ?? '');
    setBudget(source.budget ? String(Number(source.budget)) : '');
    setNote(source.note ?? '');
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing]);

  const trimmed = name.trim();
  const datesBackwards = Boolean(startDate && endDate && endDate < startDate);
  const budgetInvalid = budget !== '' && !(Number(budget) > 0);
  const canSubmit = trimmed.length > 0 && !saving && !datesBackwards && !budgetInvalid;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const draft: CollectionDraft = {
      name: trimmed,
      emoji: emoji.trim() || null,
      color,
      start_date: startDate || null,
      // An end date needs a start date; keep the pair consistent.
      end_date: startDate ? endDate || null : null,
      budget: budget ? Number(budget).toFixed(2) : null,
      note: note.trim() || null,
    };
    try {
      const res = editing ? await updateCollection(editing.id, draft) : await createCollection(draft);
      onSaved(res.data);
      onClose();
    } catch (err) {
      setError(errorText(err, 'The collection could not be saved'));
      nameRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await updateCollection(editing.id, { is_archived: !editing.is_archived });
      onSaved(res.data);
      toast.success(editing.is_archived ? 'Collection restored' : 'Collection archived');
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Could not update the collection'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await toast.confirm(
      `Delete “${editing.name}”? Its transactions stay where they are — only the collection goes.`,
      { danger: true },
    );
    if (!ok) return;
    setSaving(true);
    try {
      await deleteCollection(editing.id);
      toast.success('Collection deleted');
      onDeleted?.(editing.id);
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Could not delete the collection'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={editing ? 'Edit collection' : 'New collection'}>
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
        <div>
          <label className="form-label" htmlFor="collection-form-name">Name</label>
          <input
            id="collection-form-name"
            ref={nameRef}
            type="text"
            value={name}
            onChange={event => { setName(event.target.value); setError(null); }}
            className="input-dark"
            placeholder="e.g. Ohio trip, Christmas, House move"
            autoFocus={shouldAutoFocus()}
            autoComplete="off"
            maxLength={60}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'collection-form-error' : undefined}
          />
          {error && (
            <p id="collection-form-error" role="alert" className="text-xs mt-1.5" style={{ color: 'var(--neg)' }}>
              {error}
            </p>
          )}
        </div>

        <fieldset>
          <legend className="form-label">Icon</legend>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {COLLECTION_EMOJIS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setEmoji(current => (current === option ? '' : option))}
                className="w-10 h-10 rounded-lg text-lg flex items-center justify-center pressable"
                style={{
                  backgroundColor: emoji === option ? 'var(--elev-1)' : 'var(--elev-sub)',
                  border: `1px solid ${emoji === option ? 'var(--accent)' : 'var(--line)'}`,
                }}
                aria-label={`Use ${option} as the icon`}
                aria-pressed={emoji === option}
              >
                <span aria-hidden="true">{option}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="form-label">Color</legend>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {COLLECTION_COLORS.map(swatch => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                className="color-swatch"
                style={{ backgroundColor: swatch }}
                aria-label={`Use ${swatch} for this collection`}
                aria-pressed={color === swatch}
              />
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label" htmlFor="collection-form-start">Starts</label>
            <input id="collection-form-start" type="date" value={startDate}
              onChange={event => setStartDate(event.target.value)} className="input-dark" />
          </div>
          <div>
            <label className="form-label" htmlFor="collection-form-end">Ends</label>
            <input id="collection-form-end" type="date" value={endDate} min={startDate || undefined}
              disabled={!startDate}
              onChange={event => setEndDate(event.target.value)} className="input-dark disabled:opacity-40" />
          </div>
        </div>
        <p className="text-xs -mt-2" style={{ color: datesBackwards ? 'var(--neg)' : 'var(--dim)' }} role={datesBackwards ? 'alert' : undefined}>
          {datesBackwards
            ? 'The end date is before the start date.'
            : 'Optional. With dates, Fintrack suggests the transactions from those days for you to confirm.'}
        </p>

        <div>
          <label className="form-label" htmlFor="collection-form-budget">Budget (optional)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono" style={{ color: 'var(--muted)' }}>$</span>
            <input
              id="collection-form-budget"
              type="text"
              inputMode="decimal"
              value={budget}
              onChange={event => setBudget(event.target.value.replace(/[^0-9.]/g, ''))}
              className="input-dark pl-7 font-mono"
              placeholder="1500"
              aria-invalid={budgetInvalid ? true : undefined}
            />
          </div>
        </div>

        <div>
          <label className="form-label" htmlFor="collection-form-note">Note (optional)</label>
          <input id="collection-form-note" type="text" value={note} maxLength={500}
            onChange={event => setNote(event.target.value)} className="input-dark" placeholder="Anything to remember" />
        </div>

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={!canSubmit} className="btn-gradient flex-1 min-h-[44px] py-2.5 text-sm disabled:opacity-40">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create collection'}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] px-4 py-2.5 text-sm">
            Cancel
          </button>
        </div>

        {editing && (
          <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
            <button type="button" onClick={handleArchive} disabled={saving}
              className="flex-1 min-h-[44px] text-sm font-semibold rounded-lg mt-2 disabled:opacity-40"
              style={{ color: 'var(--fg)', backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
              {editing.is_archived ? 'Restore' : 'Archive'}
            </button>
            <button type="button" onClick={handleDelete} disabled={saving}
              className="flex-1 min-h-[44px] text-sm font-semibold rounded-lg mt-2 disabled:opacity-40"
              style={{ color: 'var(--neg)', backgroundColor: 'color-mix(in oklab, var(--neg) 8%, transparent)', border: '1px solid color-mix(in oklab, var(--neg) 20%, transparent)' }}>
              Delete
            </button>
          </div>
        )}
      </form>
    </BottomSheet>
  );
};

export default CollectionFormSheet;
