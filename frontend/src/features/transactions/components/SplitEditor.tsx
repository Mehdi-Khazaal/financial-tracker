import React, { useMemo, useState } from 'react';
import type { Category, Transaction } from '../../../types';
import { clearTransactionSplits, setTransactionSplits } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { selectableCategories } from '../../../components/modals/categoryOptions';
import {
  MAX_SPLIT_LINES,
  centsToText,
  checkSplit,
  initialLines,
  newLineKey,
  rebalanceFirst,
  toSplitPayload,
  transactionCents,
  type SplitDraftLine,
} from '../calculations/splits';

/**
 * File one transaction across several categories.
 *
 * The first line absorbs whatever the others leave until it is typed in
 * directly, so the common case — "$40 of this $100 shop was household" — is
 * one line of input. Save stays disabled until the parts add up to the cent,
 * and the running difference says which way it is off.
 */
interface Props {
  transaction: Transaction;
  categories: Category[];
  onDone: () => void;
  onCancel: () => void;
}

const SplitEditor: React.FC<Props> = ({ transaction, categories, onDone, onCancel }) => {
  const toast = useToast();
  const total = transactionCents(transaction);
  const direction: 'income' | 'expense' = Number(transaction.amount) < 0 ? 'expense' : 'income';
  const options = useMemo(() => selectableCategories(categories, direction), [categories, direction]);
  const [lines, setLines] = useState<SplitDraftLine[]>(() => initialLines(transaction));
  const [firstTouched, setFirstTouched] = useState(() => (transaction.splits?.length ?? 0) > 0);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const hasSplit = (transaction.splits?.length ?? 0) > 0;

  const check = checkSplit(total, lines);

  const update = (index: number, patch: Partial<SplitDraftLine>) => {
    setServerError(null);
    const typedInFirst = index === 0 && patch.amount !== undefined;
    if (typedInFirst) setFirstTouched(true);
    const keepBalancing = !firstTouched && !typedInFirst;
    setLines(current => {
      const next = current.map((line, i) => (i === index ? { ...line, ...patch } : line));
      return keepBalancing ? rebalanceFirst(total, next) : next;
    });
  };

  const addLine = () => setLines(current => [...current, { key: newLineKey(), categoryId: '', amount: '', note: '' }]);
  const removeLine = (index: number) => setLines(current => {
    const next = current.filter((_, i) => i !== index);
    return firstTouched ? next : rebalanceFirst(total, next);
  });

  const save = async () => {
    if (!check.ok) return;
    setSaving(true);
    try {
      await setTransactionSplits(transaction.id, toSplitPayload(transaction, lines));
      toast.success('Split saved');
      onDone();
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setServerError(typeof detail === 'string' ? detail : 'The split could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const unsplit = async () => {
    setSaving(true);
    try {
      await clearTransactionSplits(transaction.id);
      toast.success('Split removed');
      onDone();
    } catch {
      toast.error('The split could not be removed');
    } finally {
      setSaving(false);
    }
  };

  const remainingLabel = check.remainingCents === 0
    ? 'Adds up'
    : check.remainingCents > 0
      ? `$${centsToText(check.remainingCents)} left to assign`
      : `$${centsToText(-check.remainingCents)} too much`;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Split <span className="font-mono tabular-nums" style={{ color: 'var(--fg)' }}>${centsToText(total)}</span> across categories
        </p>
        <p className="text-xs font-medium font-mono tabular-nums" role="status" style={{ color: check.remainingCents === 0 ? 'var(--pos)' : 'var(--accent)' }}>
          {remainingLabel}
        </p>
      </div>

      <ol className="space-y-2" aria-label="Split parts">
        {lines.map((line, index) => (
          <li key={line.key} className="rounded-xl p-3 space-y-2" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
            <div className="grid grid-cols-[1fr_7rem_auto] gap-2 items-center">
              <select
                value={line.categoryId}
                onChange={event => update(index, { categoryId: event.target.value })}
                className="input-dark text-sm"
                aria-label={`Part ${index + 1} category`}
              >
                <option value="">Category</option>
                {options.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-sm" style={{ color: 'var(--muted)' }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.amount}
                  onChange={event => update(index, { amount: event.target.value })}
                  className="input-dark pl-6 font-mono text-sm w-full"
                  aria-label={`Part ${index + 1} amount`}
                  placeholder="0.00"
                />
              </div>
              <button
                type="button"
                onClick={() => removeLine(index)}
                disabled={lines.length <= 2}
                className="btn-ghost pressable px-2 text-xs disabled:opacity-30"
                style={{ minHeight: 44, color: 'var(--dim)' }}
                aria-label={`Remove part ${index + 1}`}
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              value={line.note}
              onChange={event => update(index, { note: event.target.value })}
              className="input-dark text-xs w-full"
              placeholder="Note (optional)"
              maxLength={200}
              aria-label={`Part ${index + 1} note`}
            />
          </li>
        ))}
      </ol>

      {lines.length < MAX_SPLIT_LINES && (
        <button type="button" onClick={addLine} className="text-xs font-medium pressable" style={{ color: 'var(--accent)', minHeight: 44 }}>
          + Add a part
        </button>
      )}

      {(serverError || (!check.ok && check.problems.length > 0 && lines.every(line => line.amount && line.categoryId))) && (
        <p className="text-xs" role="alert" style={{ color: 'var(--neg)' }}>{serverError ?? check.problems[0]}</p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost pressable flex-1" style={{ minHeight: 44 }} disabled={saving}>Cancel</button>
        <button type="button" onClick={() => { void save(); }} className="btn-gradient pressable flex-1" style={{ minHeight: 44 }} disabled={saving || !check.ok}>
          {saving ? 'Saving…' : 'Save split'}
        </button>
      </div>
      {hasSplit && (
        <button type="button" onClick={() => { void unsplit(); }} className="w-full text-xs pressable" style={{ color: 'var(--neg)', minHeight: 44 }} disabled={saving}>
          Remove split — file it all under one category
        </button>
      )}
    </div>
  );
};

export default SplitEditor;
