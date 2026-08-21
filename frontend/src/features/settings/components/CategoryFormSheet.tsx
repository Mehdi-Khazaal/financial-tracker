import React, { useEffect, useRef, useState } from 'react';
import BottomSheet from '../../../components/BottomSheet';
import type { Category } from '../../../types';

/**
 * Create and edit a category, in one form.
 *
 * `BottomSheet` is a sheet on mobile and a centred modal on desktop, and it
 * already owns the focus trap, Escape handling and focus restore — so this is
 * the app's existing modal pattern rather than a second one.
 *
 * Type is shown but never editable. Retyping a category moves it between
 * semantic populations and rewrites history: an `investment` category flipped
 * to `expense` reclassifies every past purchase filed under it as spending,
 * because `classifyTransaction` reads the category's type rather than anything
 * stored on the transaction. Renaming is safe by comparison — the id is the
 * identity, so transactions follow it.
 */

export const PRESET_COLORS = [
  '#f43f5e', '#ff8e53', '#f59e0b', '#10b981', '#1abc9c',
  '#6366f1', '#a855f7', '#ec4899', '#8a8a94', '#ededee',
];

const TYPE_LABEL: Record<Category['type'], string> = {
  expense: 'expense',
  income: 'income',
  investment: 'investment',
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Absent when creating. */
  editing: Category | null;
  type: Category['type'];
  /** Resolves to an error message, or null on success. */
  onSubmit: (name: string, color: string) => Promise<string | null>;
}

const CategoryFormSheet: React.FC<Props> = ({ isOpen, onClose, editing, type, onSubmit }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(editing?.name ?? '');
    setColor(editing?.color ?? PRESET_COLORS[0]);
    setError(null);
    setSaving(false);
  }, [isOpen, editing]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !saving;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Guards the double-submit: Enter and the button both land here, and a
    // slow request would otherwise allow a second POST creating a duplicate.
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const message = await onSubmit(trimmed, color);
    if (message) {
      setError(message);
      setSaving(false);
      // Put the user back on the field they need to change.
      nameRef.current?.focus();
      return;
    }
    setSaving(false);
    onClose();
  };

  const title = editing
    ? `Edit ${TYPE_LABEL[type]} category`
    : `New ${TYPE_LABEL[type]} category`;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="form-label" htmlFor="category-form-name">Name</label>
          <input
            id="category-form-name"
            ref={nameRef}
            type="text"
            value={name}
            onChange={event => { setName(event.target.value); setError(null); }}
            className="input-dark"
            placeholder={`e.g. ${type === 'income' ? 'Freelance' : type === 'investment' ? 'Bullion' : 'Coffee'}`}
            autoFocus
            autoComplete="off"
            maxLength={100}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'category-form-error' : undefined}
          />
          {error && (
            <p
              id="category-form-error"
              role="alert"
              className="text-xs mt-1.5"
              style={{ color: 'var(--neg)' }}
            >
              {error}
            </p>
          )}
        </div>

        <fieldset>
          <legend className="form-label">Colour</legend>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {PRESET_COLORS.map(swatch => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                className="color-swatch"
                style={{ backgroundColor: swatch }}
                aria-label={`Use ${swatch} for this category`}
                aria-pressed={color === swatch}
              />
            ))}
          </div>
          {/* A colour this category already has but the palette does not offer
              — every seeded default is in that position, since the defaults and
              the presets share no values at all. Shown so an edit does not
              silently look like it lost the colour. */}
          {!PRESET_COLORS.includes(color) && (
            <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: 'var(--dim)' }}>
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              Keeping its current colour
            </p>
          )}
        </fieldset>

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-gradient flex-1 min-h-[44px] py-2.5 text-sm disabled:opacity-40"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost min-h-[44px] px-4 py-2.5 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </BottomSheet>
  );
};

export default CategoryFormSheet;
