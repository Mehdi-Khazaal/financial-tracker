import React, { useState } from 'react';
import type { Collection } from '../../../types';
import { collectionColor, collectionLabel } from '../calculations/collections';

/**
 * Chips to put one transaction in collections. A transaction can be in
 * several, so each chip toggles on its own. Running collections lead.
 *
 * `onCreate` adds a "New" chip that asks for a name in place — making a
 * collection should not mean leaving the transaction you are looking at.
 */
interface Props {
  collections: Collection[];
  selected: number[];
  onToggle: (id: number) => void;
  onCreate?: (name: string) => Promise<boolean>;
  disabled?: boolean;
  /** Visible group label, also used for the accessible name. */
  label?: string;
}

const CollectionPicker: React.FC<Props> = ({ collections, selected, onToggle, onCreate, disabled = false, label = 'Collections' }) => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ordered = [...collections].sort((a, b) => Number(b.active) - Number(a.active));

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || !onCreate) return;
    setBusy(true);
    const ok = await onCreate(trimmed);
    setBusy(false);
    if (ok) { setName(''); setCreating(false); }
  };

  return (
    <div role="group" aria-label={label}>
      <p className="label mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {ordered.map(c => {
          const on = selected.includes(c.id);
          const color = collectionColor(c);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c.id)}
              disabled={disabled}
              aria-pressed={on}
              className="pill transition-all disabled:opacity-50"
              style={on
                ? { backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`, color: 'var(--fg)', border: `1px solid color-mix(in oklab, ${color} 45%, transparent)` }
                : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px solid transparent' }}
            >
              {c.active && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: color }} aria-hidden="true" />}
              {collectionLabel(c)}
              {c.active && <span className="sr-only"> (running now)</span>}
            </button>
          );
        })}
        {onCreate && !creating && (
          <button type="button" onClick={() => setCreating(true)} disabled={disabled}
            className="pill transition-all disabled:opacity-50"
            style={{ backgroundColor: 'transparent', color: 'var(--accent)', border: '1px dashed var(--line-strong)' }}>
            + New
          </button>
        )}
      </div>
      {creating && (
        <div className="flex gap-2 mt-2">
          <label className="sr-only" htmlFor="collection-picker-new">New collection name</label>
          <input
            id="collection-picker-new"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } if (e.key === 'Escape') setCreating(false); }}
            className="input-dark flex-1 text-sm"
            placeholder="e.g. Ohio trip"
            maxLength={60}
            autoFocus
          />
          <button type="button" onClick={() => void submit()} disabled={busy || !name.trim()}
            className="btn-gradient px-4 min-h-[44px] text-sm disabled:opacity-40">
            {busy ? '…' : 'Add'}
          </button>
          <button type="button" onClick={() => { setCreating(false); setName(''); }} className="btn-ghost px-3 min-h-[44px] text-sm">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export default CollectionPicker;
