import React, { useState } from 'react';
import type { Category } from '../../../types';
import type { UseCategories } from '../hooks/useCategories';
import { EmptyBlock, LoadingBlock, SectionErrorBlock, SectionHeading } from '../components/SettingsPrimitives';

/**
 * Categories, moved rather than redesigned.
 *
 * Phase 6B owns the Category Manager: search, compact rows, usage counts, safer
 * deletion. This is a faithful extraction, so the tabs, the colour picker, the
 * inline edit and the ordering all behave exactly as they did — the only thing
 * that changed is where the code lives and that a failed load now says so.
 *
 * System categories render without Edit or Delete. That is not styling: the
 * backend filters both writes on `user_id == current_user.id` and system rows
 * have a null `user_id`, so the controls could never succeed.
 */

export const CATEGORY_TABS = ['expense', 'income', 'investment'] as const;
export type CategoryTab = typeof CATEGORY_TABS[number];

const CAT_TAB_ACCENT: Record<CategoryTab, {
  tint: string; buttonTint: string; color: string; border: string;
}> = {
  expense: { tint: 'oklch(70% 0.17 25 / 0.15)', buttonTint: 'oklch(70% 0.17 25 / 0.12)', color: 'var(--neg)', border: 'oklch(70% 0.17 25 / 0.25)' },
  income: { tint: 'oklch(78% 0.16 150 / 0.15)', buttonTint: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)', border: 'oklch(78% 0.16 150 / 0.25)' },
  investment: { tint: 'var(--accent-dim)', buttonTint: 'var(--accent-dim)', color: 'var(--accent)', border: 'var(--accent-glow)' },
};

export const PRESET_COLORS = [
  '#f43f5e', '#ff8e53', '#f59e0b', '#10b981', '#1abc9c',
  '#6366f1', '#a855f7', '#ec4899', '#8a8a94', '#ededee',
];

interface Props {
  categories: UseCategories;
}

const CategoriesSection: React.FC<Props> = ({ categories }) => {
  const [tab, setTab] = useState<CategoryTab>('expense');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [adding, setAdding] = useState(false);

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [saving, setSaving] = useState(false);

  const shown = categories.items.filter(c => c.type === tab);
  const countOf = (type: Category['type']) => categories.items.filter(c => c.type === type).length;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    const created = await categories.create(newName.trim(), tab, newColor);
    if (created) {
      setNewName('');
      setNewColor(PRESET_COLORS[0]);
    }
    setAdding(false);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    setSaving(true);
    const saved = await categories.rename(id, editName.trim(), editColor);
    if (saved) setEditId(null);
    setSaving(false);
  };

  return (
    <section aria-labelledby="settings-categories-heading">
      <SectionHeading
        title="Categories"
        meta={(
          <p className="text-xs text-muted">
            {countOf('expense')} expense · {countOf('income')} income · {countOf('investment')} investment
          </p>
        )}
      />
      <h2 className="sr-only" id="settings-categories-heading">Categories</h2>

      <div className="flex p-1 rounded-xl mb-4" style={{ backgroundColor: 'var(--elev-1)' }}>
        {CATEGORY_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className="flex-1 min-h-[44px] py-2 text-sm font-semibold rounded-lg transition-all capitalize"
            style={tab === t
              ? { backgroundColor: CAT_TAB_ACCENT[t].tint, color: CAT_TAB_ACCENT[t].color }
              : { color: 'var(--muted)' }}
          >
            {t}
          </button>
        ))}
      </div>

      <form onSubmit={handleAdd} className="card p-4 mb-3">
        <p className="label mb-3">Add {tab} category</p>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {PRESET_COLORS.map(color => (
            <button
              key={color} type="button" onClick={() => setNewColor(color)}
              className="color-swatch" style={{ backgroundColor: color }}
              aria-label={`Use ${color} for this category`}
              aria-pressed={newColor === color}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <div className="flex min-w-0 items-center gap-2 flex-1">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: newColor }} />
            <label className="sr-only" htmlFor="new-category-name">Category name</label>
            <input
              id="new-category-name" type="text" value={newName}
              onChange={e => setNewName(e.target.value)}
              className="input-dark flex-1 text-sm" placeholder="Category name"
            />
          </div>
          <button
            type="submit" disabled={adding || !newName.trim()}
            className="min-h-[44px] px-4 py-2.5 text-sm font-semibold rounded-lg transition-all disabled:opacity-40"
            style={{
              backgroundColor: CAT_TAB_ACCENT[tab].buttonTint,
              color: CAT_TAB_ACCENT[tab].color,
              border: `1px solid ${CAT_TAB_ACCENT[tab].border}`,
            }}
          >
            {adding ? '…' : '+ Add'}
          </button>
        </div>
      </form>

      {categories.status === 'loading' ? (
        <LoadingBlock label="Loading categories" />
      ) : categories.status === 'error' ? (
        <SectionErrorBlock
          message="Your categories could not be loaded."
          onRetry={categories.reload}
        />
      ) : shown.length === 0 ? (
        <EmptyBlock>No {tab} categories yet</EmptyBlock>
      ) : (
        <div className="card overflow-hidden">
          {shown.map((cat, index) => (
            <div
              key={cat.id}
              className="px-4 py-3 group"
              style={{ borderBottom: index < shown.length - 1 ? '1px solid var(--line)' : 'none' }}
            >
              {editId === cat.id ? (
                <div className="space-y-3">
                  <div className="flex gap-1.5 flex-wrap">
                    {PRESET_COLORS.map(color => (
                      <button
                        key={color} type="button" onClick={() => setEditColor(color)}
                        className="color-swatch" style={{ backgroundColor: color }}
                        aria-label={`Use ${color} for this category`}
                        aria-pressed={editColor === color}
                      />
                    ))}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex min-w-0 items-center gap-2 flex-1">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editColor }} />
                      <label className="sr-only" htmlFor={`edit-category-${cat.id}`}>Category name</label>
                      <input
                        id={`edit-category-${cat.id}`} type="text" value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="input-dark flex-1 text-sm" autoFocus
                      />
                    </div>
                    <button
                      onClick={() => handleSaveEdit(cat.id)} disabled={saving || !editName.trim()}
                      className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg disabled:opacity-40"
                      style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)' }}
                    >
                      {saving ? '…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg"
                      style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} aria-hidden="true" />
                  <p className="text-sm text-text flex-1">{cat.name}</p>
                  {cat.is_system && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--dim)' }}
                    >
                      default
                    </span>
                  )}
                  {/* Immutable server-side; offering controls that always 404
                      is worse than offering none. */}
                  {!cat.is_system && (
                    <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditId(cat.id); setEditName(cat.name); setEditColor(cat.color); }}
                        className="w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-xs transition-all"
                        aria-label={`Edit ${cat.name}`}
                        style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)' }}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                      </button>
                      <button
                        onClick={() => { void categories.remove(cat.id, cat.name); }}
                        className="w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-xs transition-all"
                        aria-label={`Delete ${cat.name}`}
                        style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default CategoriesSection;
