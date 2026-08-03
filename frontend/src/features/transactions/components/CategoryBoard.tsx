import React, { useState } from 'react';
import type { Category, Transaction } from '../../../types';
import TransactionCard from '../../../components/transactions/TransactionCard';
import { dollars } from '../../analytics/format';
import type { BoardLayout } from '../calculations/board';

/**
 * The review board.
 *
 * A wrapping `auto-fill` grid replaces the sideways-scrolling three-row grid
 * and its mirrored scrollbar. Everything that made the old board useful is
 * kept — drag targets, counts, totals, colours, the "more" action — but the
 * columns now flow down the page, which is the direction the page already
 * scrolls.
 *
 * `minmax(230px, 1fr)` is the whole responsive story: four columns on a wide
 * desktop, one on a small phone, and never a column so narrow that a merchant
 * name has nowhere to go.
 */

interface Props {
  layout: BoardLayout;
  /** How many rows to preview inside a column before the "more" action. */
  maxPreview: number;
  draggingTxId: number | null;
  dragOverTarget: number | 'uncategorized' | null;
  onDragOver: (target: number) => (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (categoryId: number) => (e: React.DragEvent) => void;
  onOpenCategory: (category: Category) => void;
  makeDragHandlers: (tx: Transaction) => {
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onClick: () => void;
    onDelete: () => void;
  };
  /** Compact preview rows, used on the desktop board. */
  compact?: boolean;
}

const CategoryBoard: React.FC<Props> = ({
  layout, maxPreview, draggingTxId, dragOverTarget,
  onDragOver, onDragLeave, onDrop, onOpenCategory, makeDragHandlers, compact = true,
}) => {
  // Collapsed by default: an empty category is a destination, not information.
  // It is still reachable in one click, and still a drop target while dragging.
  const [showEmpty, setShowEmpty] = useState(false);
  const dragging = draggingTxId != null;
  const emptyVisible = showEmpty || dragging;

  return (
    <div className="px-3 md:px-4 pb-6">
      {layout.active.length === 0 && layout.empty.length === 0 && (
        <div className="py-14 text-center">
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>No categories yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
            Add categories in Settings, then drag transactions onto them here.
          </p>
        </div>
      )}

      {layout.active.length > 0 && (
        <div
          className="grid gap-2.5 md:gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}
        >
          {layout.active.map(({ category, transactions, count, total }) => {
            const isDragOver = dragOverTarget === category.id;
            const preview = transactions.slice(0, maxPreview);
            const hidden = count - preview.length;

            return (
              <div
                key={category.id}
                className="flex flex-col overflow-hidden"
                style={{
                  borderRadius: 12,
                  backgroundColor: isDragOver ? `${category.color}14` : `${category.color}07`,
                  border: `1px solid ${isDragOver ? `${category.color}50` : `${category.color}28`}`,
                  transition: 'background-color 120ms ease, border-color 120ms ease',
                }}
                onDragOver={onDragOver(category.id)}
                onDragLeave={onDragLeave}
                onDrop={onDrop(category.id)}
              >
                <button
                  type="button"
                  onClick={() => onOpenCategory(category)}
                  className="w-full text-left transition-colors"
                  style={{ borderBottom: `1px solid ${category.color}20`, padding: '10px 12px' }}
                  aria-label={`${category.name}: ${dollars(total)} across ${count} transactions. Open details.`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                      <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--fg)' }} title={category.name}>
                        {category.name}
                      </p>
                    </div>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0"
                      style={{ backgroundColor: `${category.color}22`, color: category.color }}
                    >
                      {count}
                    </span>
                  </div>
                  <p
                    className="text-[16px] font-bold leading-tight tabular-nums"
                    style={{ fontFamily: 'var(--font-mono)', color: category.color }}
                  >
                    {dollars(total)}
                  </p>
                </button>

                <div>
                  {preview.map(tx => (
                    <TransactionCard
                      key={tx.id}
                      tx={tx}
                      accounts={[]}
                      compact={compact}
                      isDragging={draggingTxId === tx.id}
                      {...makeDragHandlers(tx)}
                    />
                  ))}
                  {isDragOver && (
                    <div
                      className="mx-2.5 my-2 rounded-xl py-4 text-center"
                      style={{ border: `2px dashed ${category.color}80`, backgroundColor: `${category.color}0a` }}
                    >
                      <p className="text-[10px] font-bold" style={{ color: category.color }}>Drop here</p>
                    </div>
                  )}
                </div>

                {hidden > 0 && (
                  <button
                    onClick={() => onOpenCategory(category)}
                    className="w-full py-2.5 text-[10px] font-semibold transition-colors mt-auto"
                    style={{
                      color: category.color,
                      borderTop: `1px solid ${category.color}25`,
                      backgroundColor: `${category.color}08`,
                    }}
                  >
                    +{hidden} more →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {layout.empty.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowEmpty(v => !v)}
            aria-expanded={emptyVisible}
            className="flex items-center gap-2 text-[11px] font-medium"
            style={{ color: 'var(--muted)', minHeight: 40 }}
          >
            <svg
              viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5"
              style={{ transform: emptyVisible ? 'rotate(180deg)' : 'none', transition: 'transform 180ms var(--ease-out)' }}
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            {layout.empty.length} {layout.empty.length === 1 ? 'category' : 'categories'} with nothing this month
          </button>

          {/* Revealed automatically during a drag, so an empty category is never
              an unreachable drop target. */}
          {emptyVisible && (
            <div className="mt-2 flex flex-wrap gap-2">
              {layout.empty.map(category => {
                const isDragOver = dragOverTarget === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => onOpenCategory(category)}
                    onDragOver={onDragOver(category.id)}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop(category.id)}
                    className="flex items-center gap-1.5 px-3 rounded-lg text-[11px] font-medium transition-colors"
                    style={{
                      minHeight: 36,
                      backgroundColor: isDragOver ? `${category.color}1f` : 'var(--elev-sub)',
                      border: `1px ${isDragOver ? 'dashed' : 'solid'} ${isDragOver ? category.color : 'var(--line)'}`,
                      color: isDragOver ? category.color : 'var(--muted)',
                    }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                    {category.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CategoryBoard;
