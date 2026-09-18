import React, { useMemo, useState } from 'react';
import type { CategorizationRule, RuleDraft } from '../../../types';
import type { UseCategories } from '../hooks/useCategories';
import type { UseRules } from '../hooks/useRules';
import RuleFormSheet, { describeRule } from '../components/RuleFormSheet';
import RowMenu from '../components/RowMenu';
import { EmptyBlock, LoadingBlock, SectionErrorBlock } from '../components/SettingsPrimitives';

/**
 * Rules: "when a transaction looks like this, file it there."
 *
 * A list in priority order, one line per rule in plain words, with the
 * category it points to and how many transactions it has filed. Creating and
 * editing happen in a sheet with a live preview. A rule can be paused,
 * applied to the past, or removed from its row menu.
 */
interface Props {
  rules: UseRules;
  categories: UseCategories;
  /** A draft handed over from a transaction ("always file this as…"). */
  initialDraft?: Partial<RuleDraft> | null;
  onDraftConsumed?: () => void;
}

const RulesSection: React.FC<Props> = ({ rules, categories, initialDraft = null, onDraftConsumed }) => {
  const [formOpen, setFormOpen] = useState(() => !!initialDraft);
  const [editing, setEditing] = useState<CategorizationRule | null>(null);
  const [draft, setDraft] = useState<Partial<RuleDraft> | null>(initialDraft);

  const categoryName = useMemo(() => {
    const byId = new Map(categories.items.map(c => [c.id, c]));
    return (id: number) => byId.get(id)?.name ?? 'Unknown category';
  }, [categories.items]);
  const categoryColor = useMemo(() => {
    const byId = new Map(categories.items.map(c => [c.id, c.color]));
    return (id: number) => byId.get(id) ?? 'var(--dim)';
  }, [categories.items]);

  const openCreate = () => { setEditing(null); setDraft(null); setFormOpen(true); };
  const openEdit = (rule: CategorizationRule) => { setEditing(rule); setDraft(null); setFormOpen(true); };
  const close = () => { setFormOpen(false); if (draft) { setDraft(null); onDraftConsumed?.(); } };

  const handleSubmit = async (body: RuleDraft) =>
    editing ? rules.edit(editing.id, body) : rules.create(body);

  const label = (rule: CategorizationRule) => `${describeRule(rule)} → ${categoryName(rule.category_id)}`;

  return (
    <section aria-labelledby="settings-rules-heading">
      <h2 className="sr-only" id="settings-rules-heading">Rules</h2>

      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          Rules file new transactions the moment they arrive, before any guess Fintrack would make.
          They never change a category you set by hand.
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 min-h-[44px] px-3 py-2 text-sm font-semibold rounded-lg transition-all"
          style={{ backgroundColor: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-glow)' }}
        >
          + New
        </button>
      </div>

      {rules.status === 'loading' ? (
        <LoadingBlock label="Loading rules" />
      ) : rules.status === 'error' ? (
        <SectionErrorBlock message="Your rules could not be loaded." onRetry={rules.reload} />
      ) : rules.items.length === 0 ? (
        <EmptyBlock>No rules yet. Start one here, or from any transaction with “Always file as…”.</EmptyBlock>
      ) : (
        <ul className="card" aria-label="Rules">
          {rules.items.map((rule, index) => (
            <li
              key={rule.id}
              className="px-4 py-3 flex items-center gap-3"
              style={{ borderBottom: index < rules.items.length - 1 ? '1px solid var(--line)' : 'none', opacity: rule.is_active ? 1 : 0.6 }}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: categoryColor(rule.category_id) }} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: 'var(--fg)' }}>
                  {describeRule(rule)}
                </p>
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                  → {categoryName(rule.category_id)}
                  <span style={{ color: 'var(--dim)' }}> · priority {rule.priority} · filed {rule.applied_count}</span>
                  {!rule.is_active && <span style={{ color: 'var(--dim)' }}> · paused</span>}
                </p>
              </div>
              <RowMenu
                label={`${describeRule(rule)} actions`}
                items={[
                  { label: 'Edit', onSelect: () => openEdit(rule) },
                  { label: 'Apply to past transactions', onSelect: () => { void rules.applyToPast(rule, label(rule)); } },
                  { label: rule.is_active ? 'Pause' : 'Resume', onSelect: () => { void rules.toggle(rule); } },
                  { label: 'Remove', danger: true, onSelect: () => { void rules.remove(rule, label(rule)); } },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <RuleFormSheet
        isOpen={formOpen}
        onClose={close}
        editing={editing}
        initial={draft}
        categories={categories.items}
        onSubmit={handleSubmit}
      />
    </section>
  );
};

export default RulesSection;
