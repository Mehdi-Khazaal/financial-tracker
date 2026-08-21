import React, { useMemo, useState } from 'react';
import type { Category } from '../../../types';
import type { UseCategories } from '../hooks/useCategories';
import CategoryFormSheet from '../components/CategoryFormSheet';
import RowMenu from '../components/RowMenu';
import { EmptyBlock, LoadingBlock, SectionErrorBlock } from '../components/SettingsPrimitives';

/**
 * The Category Manager.
 *
 * Replaces a list that rendered every category inline with a permanently
 * expanded create form above it and two 44px buttons on every row — roughly
 * 800px of scroll for twenty categories, before Connections or Admin.
 *
 * The shape now is: type tabs with totals, a search field, one "New category"
 * button, and compact rows. Creating and editing both happen in a sheet rather
 * than in place, so the list stays a list.
 *
 * Two rules the UI encodes because the backend enforces them:
 *
 *   • **Default categories are read-only.** They are seeded per user with a
 *     real `user_id`, so the owner filter never protected them; the API now
 *     rejects writes with 403 and the row shows a "Default" badge and no menu.
 *   • **Names are unique per type, case-insensitively.** A collision comes back
 *     as 409 and is shown against the name field rather than as a toast, since
 *     it is that field the user has to change.
 */

export const CATEGORY_TABS = ['expense', 'income', 'investment'] as const;
export type CategoryTab = typeof CATEGORY_TABS[number];

const TAB_ACCENT: Record<CategoryTab, { tint: string; color: string }> = {
  expense: { tint: 'oklch(70% 0.17 25 / 0.15)', color: 'var(--neg)' },
  income: { tint: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)' },
  investment: { tint: 'var(--accent-dim)', color: 'var(--accent)' },
};

/** Case-insensitive substring match on a trimmed query. */
export const matchesQuery = (name: string, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || name.toLowerCase().includes(needle);
};

interface Props {
  categories: UseCategories;
}

const CategoriesSection: React.FC<Props> = ({ categories }) => {
  const [tab, setTab] = useState<CategoryTab>('expense');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const ofType = useMemo(
    () => categories.items.filter(category => category.type === tab),
    [categories.items, tab],
  );
  const shown = useMemo(
    () => ofType.filter(category => matchesQuery(category.name, query)),
    [ofType, query],
  );

  const countOf = (type: Category['type']) =>
    categories.items.filter(category => category.type === type).length;

  const isSearching = query.trim().length > 0;

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (category: Category) => { setEditing(category); setFormOpen(true); };

  const handleSubmit = async (name: string, color: string) =>
    editing
      ? categories.rename(editing.id, name, color)
      : categories.create(name, tab, color);

  return (
    <section aria-labelledby="settings-categories-heading">
      {/* The visible title comes from the shell: an `h1` on mobile, and the
          highlighted rail entry on desktop. Rendering it again here put
          "Categories" on the phone screen twice. */}
      <h2 className="sr-only" id="settings-categories-heading">Categories</h2>

      {/* Totals live on the tabs, and stay totals — a badge that quietly became
          a filtered count would misreport how many categories exist. The
          "N of M" line below reports the filtering instead. */}
      <div
        className="flex p-1 rounded-xl mb-3"
        role="tablist"
        aria-label="Category type"
        style={{ backgroundColor: 'var(--elev-1)' }}
      >
        {CATEGORY_TABS.map(candidate => (
          <button
            key={candidate}
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => setTab(candidate)}
            className="flex-1 min-h-[44px] py-2 px-1 text-sm font-semibold rounded-lg transition-all capitalize"
            style={tab === candidate
              ? { backgroundColor: TAB_ACCENT[candidate].tint, color: TAB_ACCENT[candidate].color }
              : { color: 'var(--muted)' }}
          >
            {candidate}
            <span className="ml-1.5 opacity-70 font-mono text-xs">{countOf(candidate)}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <label className="sr-only" htmlFor="category-search">Search categories</label>
          <input
            id="category-search"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            className="input-dark w-full text-sm"
            placeholder="Search categories…"
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 min-h-[44px] px-3 py-2 text-sm font-semibold rounded-lg transition-all"
          style={{
            backgroundColor: 'var(--accent-dim)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-glow)',
          }}
        >
          + New
        </button>
      </div>

      {isSearching && categories.status === 'ready' && shown.length > 0 && (
        <p className="text-xs mb-2" style={{ color: 'var(--dim)' }}>
          {shown.length} of {ofType.length} shown
        </p>
      )}

      {categories.status === 'loading' ? (
        <LoadingBlock label="Loading categories" />
      ) : categories.status === 'error' ? (
        <SectionErrorBlock
          message="Your categories could not be loaded."
          onRetry={categories.reload}
        />
      ) : shown.length === 0 ? (
        <EmptyBlock>
          {isSearching
            ? `No ${tab} categories match “${query.trim()}”.`
            : `No ${tab} categories yet`}
        </EmptyBlock>
      ) : (
        // No `overflow-hidden` here, unlike the other lists: it would clip a
        // row's open menu to the card. The rows carry no background of their
        // own, so the card's radius still shapes the corners without it.
        <ul className="card">
          {shown.map((category, index) => (
            <li
              key={category.id}
              className="px-4 py-2.5 flex items-center gap-3"
              style={{ borderBottom: index < shown.length - 1 ? '1px solid var(--line)' : 'none' }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: category.color }}
                aria-hidden="true"
              />
              <span className="text-sm text-text flex-1 min-w-0 truncate">{category.name}</span>

              {category.is_system ? (
                /* Text, not just a colour or an icon: the reason a row has no
                   menu has to be legible. */
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--dim)' }}
                >
                  Default
                </span>
              ) : (
                <RowMenu
                  label={`${category.name} actions`}
                  items={[
                    { label: 'Edit', onSelect: () => openEdit(category) },
                    {
                      label: 'Delete',
                      danger: true,
                      onSelect: () => { void categories.remove(category.id, category.name); },
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <CategoryFormSheet
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        type={editing ? (editing.type as CategoryTab) : tab}
        onSubmit={handleSubmit}
      />
    </section>
  );
};

export default CategoriesSection;
