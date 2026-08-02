import React, { useEffect, useState } from 'react';
import type { Category, Transaction } from '../../types';
import BottomSheet from '../BottomSheet';
import { cleanDescription } from '../../utils/api';

/**
 * The categorize-one-at-a-time sheet.
 *
 * Filing imports used to cost two taps and two sheet animations per
 * transaction: tap the row, the sheet slides in, tap a category, the sheet
 * slides out, repeat. Thirty imports meant sixty taps and sixty animations.
 * The sheet now stays open and advances to the next item, which halves the
 * taps and removes the animation entirely from the middle of the flow.
 *
 * Three things that keep the speed honest:
 *
 *   • The queue is snapshotted when the sheet opens. Deriving it live would
 *     mean the list reorders under the user's thumb after every assignment.
 *   • Suggestions are frozen for the same reason — a button that moves as you
 *     reach for it is worse than a slightly stale suggestion.
 *   • Every assignment is undoable from inside the sheet, because a fast flow
 *     without a way back is just a fast way to make mistakes.
 *
 * Assignment is optimistic: the sheet advances immediately and only comes back
 * if the write failed.
 */

export interface CategorizeSuggestion extends Category {
  /** How many transactions already use this category this month. */
  count: number;
}

interface Props {
  /** The row the user tapped. Opening a new one starts a fresh session. */
  initialTransaction: Transaction | null;
  /** Everything still uncategorized, in display order. */
  queue: Transaction[];
  categories: Category[];
  suggestions: CategorizeSuggestion[];
  /** Resolves false when the write failed, so the sheet can step back. */
  onAssign: (txId: number, categoryId: number | null) => Promise<boolean>;
  onClose: () => void;
  onDelete: (tx: Transaction) => void;
  onEdit: (tx: Transaction) => void;
}

const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface FiledEntry {
  tx: Transaction;
  categoryName: string;
}

const CategorizeSheet: React.FC<Props> = ({
  initialTransaction, queue, categories, suggestions, onAssign, onClose, onDelete, onEdit,
}) => {
  const [session, setSession] = useState<Transaction[]>([]);
  const [sessionSuggestions, setSessionSuggestions] = useState<CategorizeSuggestion[]>([]);
  const [cursor, setCursor] = useState(0);
  const [filed, setFiled] = useState<FiledEntry[]>([]);
  const [done, setDone] = useState(false);

  const startId = initialTransaction?.id ?? null;

  // A new session begins only when a different row is tapped. Re-snapshotting
  // on every queue change would defeat the point of snapshotting at all.
  useEffect(() => {
    if (startId == null) return;
    const index = queue.findIndex(t => t.id === startId);
    setSession(index >= 0 ? queue : [initialTransaction as Transaction]);
    setSessionSuggestions(suggestions);
    setCursor(index >= 0 ? index : 0);
    setFiled([]);
    setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startId]);

  const current = done ? null : session[cursor] ?? null;
  const isOpen = startId != null && (current != null || done);
  const lastFiled = filed.length > 0 ? filed[filed.length - 1] : null;
  const remaining = Math.max(0, session.length - cursor - (done ? 0 : 1));

  const close = () => {
    setDone(false);
    setFiled([]);
    onClose();
  };

  const assign = async (category: Category) => {
    const tx = session[cursor];
    if (!tx) return;

    const wasLast = cursor >= session.length - 1;
    setFiled(prev => [...prev, { tx, categoryName: category.name }]);
    if (wasLast) setDone(true);
    else setCursor(c => c + 1);

    const ok = await onAssign(tx.id, category.id);
    if (ok) return;

    // The write failed and the parent has already rolled the data back. Return
    // to the transaction that did not stick rather than silently skipping it.
    setFiled(prev => prev.filter(entry => entry.tx.id !== tx.id));
    setDone(false);
    const index = session.findIndex(t => t.id === tx.id);
    setCursor(index >= 0 ? index : cursor);
  };

  const undo = async () => {
    if (!lastFiled) return;
    const { tx } = lastFiled;

    setFiled(prev => prev.slice(0, -1));
    setDone(false);
    const index = session.findIndex(t => t.id === tx.id);
    setCursor(index >= 0 ? index : 0);

    await onAssign(tx.id, null);
  };

  if (!isOpen) return null;

  const suggestedIds = new Set(sessionSuggestions.map(c => c.id));
  // Suggestions are lifted out of the full list rather than repeated in it.
  const remainingCategories = categories.filter(c => !suggestedIds.has(c.id));

  // ── Completion ──────────────────────────────────────────────────────────────
  if (done) {
    return (
      <BottomSheet isOpen onClose={close}>
        <div className="px-5 py-8 text-center">
          <svg
            viewBox="0 0 24 24" fill="none" stroke="var(--pos)" strokeWidth="1.5"
            className="w-10 h-10 mx-auto mb-3" aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="font-semibold" style={{ color: 'var(--pos)' }} role="status">
            All transactions categorized
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            {filed.length === 1 ? '1 transaction filed' : `${filed.length} transactions filed`}
          </p>

          <div className="flex gap-2 mt-6">
            {lastFiled && (
              <button
                onClick={undo}
                className="flex-1 py-3 text-sm font-semibold rounded-xl transition-all active:scale-95"
                style={{ color: 'var(--muted)', backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}
              >
                Undo last
              </button>
            )}
            <button
              onClick={close}
              className="flex-1 py-3 text-sm font-bold rounded-xl transition-all active:scale-95"
              style={{ backgroundColor: 'var(--accent)', color: 'white' }}
            >
              Done
            </button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  if (!current) return null;
  const positive = Number(current.amount) >= 0;

  return (
    <BottomSheet isOpen onClose={close}>
      <div>
        {/* What am I filing, and how much is left? */}
        <div className="px-5 pt-5 pb-4 text-center" style={{ borderBottom: '1px solid var(--line)' }}>
          <p
            className="text-3xl font-bold"
            style={{ color: positive ? 'var(--pos)' : 'var(--neg)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
          >
            {positive ? '+' : '-'}${fmt(Math.abs(Number(current.amount)))}
          </p>
          <p className="text-sm font-medium mt-1.5 truncate" style={{ color: 'var(--muted)' }}>
            {cleanDescription(current.description)}
          </p>
          {remaining > 0 && (
            <p className="text-[11px] mt-2 font-mono" style={{ color: 'var(--dim)' }} role="status">
              {remaining} more to review
            </p>
          )}
        </div>

        {/* What just happened, and how to take it back. */}
        {lastFiled && (
          <div
            className="px-5 py-2.5 flex items-center justify-between gap-3"
            style={{ borderBottom: '1px solid var(--line)', backgroundColor: 'var(--elev-sub)' }}
          >
            <p className="text-xs truncate min-w-0" style={{ color: 'var(--muted)' }}>
              Filed under <span style={{ color: 'var(--fg)' }}>{lastFiled.categoryName}</span>
            </p>
            <button
              onClick={undo}
              className="text-xs font-semibold shrink-0 px-2"
              style={{ color: 'var(--accent)', minHeight: 36 }}
            >
              Undo
            </button>
          </div>
        )}

        <div className="px-4 pt-4 pb-2">
          {sessionSuggestions.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>
                Suggested
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sessionSuggestions.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => assign(cat)}
                    className="flex items-center justify-between gap-2 px-3.5 py-3 rounded-lg text-left transition-all active:scale-[0.97]"
                    style={{ backgroundColor: `${cat.color}12`, border: `1px solid ${cat.color}38` }}
                  >
                    <span className="text-sm font-semibold truncate" style={{ color: cat.color }}>{cat.name}</span>
                    <span className="font-mono text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>{cat.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {remainingCategories.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--dim)' }}>
                {sessionSuggestions.length > 0 ? 'All other categories' : 'All categories'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {remainingCategories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => assign(cat)}
                    className="flex items-center gap-2.5 px-3.5 py-3 rounded-lg text-left transition-all active:scale-[0.97]"
                    style={{ backgroundColor: `${cat.color}12`, border: `1px solid ${cat.color}28` }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm font-semibold truncate" style={{ color: cat.color }}>{cat.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="flex gap-2 mt-3 mb-1">
            <button
              onClick={() => onDelete(current)}
              className="flex-1 py-3 text-sm font-semibold rounded-xl transition-all active:scale-95"
              style={{ color: 'var(--neg)', backgroundColor: 'oklch(70% 0.17 25 / 0.1)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}
            >
              Delete
            </button>
            <button
              onClick={() => onEdit(current)}
              className="flex-1 py-3 text-sm font-semibold rounded-xl transition-all active:scale-95"
              style={{ color: 'var(--muted)', backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}
            >
              Edit details
            </button>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
};

export default CategorizeSheet;
