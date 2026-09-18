import React, { useEffect, useMemo, useRef, useState } from 'react';
import BottomSheet from '../../../components/BottomSheet';
import type { CategorizationRule, Category, RuleDraft, RuleField, RuleMatchType, RulePreview } from '../../../types';
import { previewRule } from '../../../utils/api';
import { dollars } from '../../analytics/format';

/**
 * Create and edit a categorization rule, with a live preview.
 *
 * The preview is the point of the sheet: a rule is a promise about the
 * future, and the only way to check it is against the past. Every change to
 * the pattern asks the server what it would hit today — how many rows, how
 * many would change, how many are protected because the user filed them by
 * hand — and shows a few examples. Nothing is written until Save.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  editing: CategorizationRule | null;
  /** Prefill for a rule started from a transaction. */
  initial?: Partial<RuleDraft> | null;
  categories: Category[];
  onSubmit: (draft: RuleDraft) => Promise<string | null>;
}

const PREVIEW_DELAY_MS = 350;

export const describeRule = (rule: Pick<CategorizationRule, 'field' | 'match_type' | 'pattern'>): string =>
  `${rule.field === 'merchant' ? 'merchant' : 'description'} ${rule.match_type === 'regex' ? 'matches' : 'contains'} “${rule.pattern}”`;

const RuleFormSheet: React.FC<Props> = ({ isOpen, onClose, editing, initial, categories, onSubmit }) => {
  const [pattern, setPattern] = useState('');
  const [field, setField] = useState<RuleField>('description');
  const [matchType, setMatchType] = useState<RuleMatchType>('contains');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState('100');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const patternRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setPattern(editing?.pattern ?? initial?.pattern ?? '');
    setField(editing?.field ?? initial?.field ?? 'description');
    setMatchType(editing?.match_type ?? initial?.match_type ?? 'contains');
    setCategoryId(String(editing?.category_id ?? initial?.category_id ?? ''));
    setPriority(String(editing?.priority ?? initial?.priority ?? 100));
    setError(null);
    setSaving(false);
    setPreview(null);
    setPreviewState('idle');
  }, [isOpen, editing, initial]);

  const selectable = useMemo(
    () => [...categories].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)),
    [categories],
  );
  const trimmed = pattern.trim();
  const canSubmit = trimmed.length > 0 && categoryId !== '' && !saving;

  // Preview follows the draft, debounced, and ignores stale responses.
  useEffect(() => {
    if (!isOpen || !trimmed || !categoryId) { setPreview(null); setPreviewState('idle'); return; }
    const id = ++requestId.current;
    setPreviewState('loading');
    const timer = setTimeout(async () => {
      try {
        const response = await previewRule({ category_id: Number(categoryId), field, match_type: matchType, pattern: trimmed });
        if (id !== requestId.current) return;
        setPreview(response.data as RulePreview);
        setPreviewState('idle');
        setError(null);
      } catch (err: any) {
        if (id !== requestId.current) return;
        setPreview(null);
        setPreviewState('error');
        const detail = err?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : null);
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isOpen, trimmed, field, matchType, categoryId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const message = await onSubmit({
      category_id: Number(categoryId), field, match_type: matchType, pattern: trimmed,
      priority: Math.max(0, Math.min(10000, Number(priority) || 100)),
    });
    setSaving(false);
    if (message) { setError(message); patternRef.current?.focus(); return; }
    onClose();
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={editing ? 'Edit rule' : 'New rule'} size="lg">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4" aria-label={editing ? 'Edit rule' : 'New rule'}>
        <div>
          <p className="label mb-2">When the</p>
          <div className="grid grid-cols-2 gap-2">
            <select value={field} onChange={e => setField(e.target.value as RuleField)} className="input-dark" aria-label="Field">
              <option value="description">description</option>
              <option value="merchant">merchant</option>
            </select>
            <select value={matchType} onChange={e => setMatchType(e.target.value as RuleMatchType)} className="input-dark" aria-label="Match type">
              <option value="contains">contains</option>
              <option value="regex">matches regex</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label mb-2 block" htmlFor="rule-pattern">{matchType === 'regex' ? 'Pattern' : 'Text'}</label>
          <input
            id="rule-pattern"
            ref={patternRef}
            type="text"
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            className="input-dark w-full font-mono text-sm"
            placeholder={matchType === 'regex' ? '^(uber|lyft)\\b' : 'netflix'}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? 'rule-error' : undefined}
            required
          />
          {error && <p id="rule-error" className="text-xs mt-1.5" style={{ color: 'var(--neg)' }} role="alert">{error}</p>}
          <p className="text-xs mt-1.5" style={{ color: 'var(--dim)' }}>
            {field === 'merchant'
              ? 'Compared against the cleaned merchant name, so “Netflix.com” and “NETFLIX 800-585-3000” both count.'
              : 'Case does not matter.'}
          </p>
        </div>

        <div>
          <label className="label mb-2 block" htmlFor="rule-category">File it under</label>
          <select id="rule-category" value={categoryId} onChange={e => setCategoryId(e.target.value)} className="input-dark w-full" required>
            <option value="">Choose a category</option>
            {selectable.map(c => <option key={c.id} value={c.id}>{c.name} · {c.type}</option>)}
          </select>
        </div>

        <div>
          <label className="label mb-2 block" htmlFor="rule-priority">Priority</label>
          <input id="rule-priority" type="number" inputMode="numeric" min={0} max={10000} value={priority} onChange={e => setPriority(e.target.value)} className="input-dark w-32" />
          <p className="text-xs mt-1.5" style={{ color: 'var(--dim)' }}>When two rules match, the lower number wins.</p>
        </div>

        <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }} aria-live="polite">
          <p className="label mb-1">Preview</p>
          {!trimmed || !categoryId ? (
            <p className="text-xs" style={{ color: 'var(--dim)' }}>Type a pattern and pick a category to see what it would match.</p>
          ) : previewState === 'loading' && !preview ? (
            <p className="text-xs" style={{ color: 'var(--dim)' }}>Checking…</p>
          ) : previewState === 'error' ? (
            <p className="text-xs" style={{ color: 'var(--neg)' }}>The pattern could not be checked.</p>
          ) : preview ? (
            <>
              <p className="text-sm" style={{ color: 'var(--fg)' }}>
                {preview.matched === 0 ? 'No past transactions match.' : (
                  <>
                    Matches <span className="font-mono tabular-nums">{preview.matched}</span> past transaction{preview.matched === 1 ? '' : 's'}
                    {preview.would_change > 0 && <> · <span className="font-mono tabular-nums">{preview.would_change}</span> would move</>}
                    {preview.protected > 0 && <> · <span className="font-mono tabular-nums">{preview.protected}</span> filed by hand, left alone</>}
                  </>
                )}
              </p>
              {preview.sample.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Example matches">
                  {preview.sample.slice(0, 5).map(row => (
                    <li key={row.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate" style={{ color: row.would_change ? 'var(--fg)' : 'var(--dim)' }}>{row.description || '—'}</span>
                      <span className="font-mono tabular-nums shrink-0" style={{ color: 'var(--muted)' }}>{dollars(Math.abs(Number(row.amount)))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>

        <button type="submit" className="btn-gradient pressable w-full" style={{ minHeight: 44 }} disabled={!canSubmit}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save rule'}
        </button>
      </form>
    </BottomSheet>
  );
};

export default RuleFormSheet;
