import React from 'react';
import { Account, Transaction } from '../../types';
import { cleanDescription } from '../../utils/api';
import type { TransactionKind } from '../../features/analytics/types';
import { KIND_COLORS, KIND_LABELS } from '../../features/analytics/calculations/transactions';

/**
 * A label only when the sign alone would mislead.
 *
 * A negative amount already reads as spending and a positive one as money in,
 * so tagging those adds noise. A refund and a card payment are the two that
 * look like income and are not, so those say what they are — as do purchases of
 * an asset and transfers, which read as spending by sign and are not.
 */
const NEEDS_LABEL: TransactionKind[] = ['refund', 'card-payment', 'investment', 'transfer'];

const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface TransactionCardProps {
  tx: Transaction;
  accounts: Account[];
  isDragging: boolean;
  compact?: boolean;
  noDrag?: boolean;
  mobileCard?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onDelete: () => void;
  /** Classification, when the caller has already computed it. */
  kind?: TransactionKind;
  /** Shown beside the account on the timeline row. */
  categoryName?: string | null;
  /** The collections this transaction is in, shown as small chips. */
  collections?: CollectionChip[];
  /** Select mode: the row shows a checkbox and a click toggles it. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export interface CollectionChip {
  id: number;
  name: string;
  emoji: string | null;
  color: string | null;
}

const MAX_CHIPS = 2;

const TransactionCard: React.FC<TransactionCardProps> = ({
  tx,
  accounts,
  isDragging,
  compact = false,
  noDrag = false,
  mobileCard = false,
  onDragStart,
  onDragEnd,
  onClick,
  onDelete,
  kind,
  categoryName,
  collections = [],
  selectable = false,
  selected = false,
  onToggleSelect,
}) => {
  const pos = Number(tx.amount) >= 0;
  const accountName = accounts.find(a => a.id === tx.account_id)?.name ?? '';
  const shortDate = new Date(`${tx.transaction_date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const amountStr = `${pos ? '+' : '-'}$${fmt(Math.abs(Number(tx.amount)))}`;
  const description = cleanDescription(tx.description);
  const showKind = kind != null && NEEDS_LABEL.includes(kind);
  const categoryLabel = tx.splits && tx.splits.length > 0 ? `Split · ${tx.splits.length}` : categoryName;

  if (compact) {
    return (
      <div
        draggable={!noDrag}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onClick}
        className={`tx-row group flex items-center gap-2 px-3 py-2.5 select-none ${noDrag ? 'cursor-pointer active:opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
        style={{ borderBottom: '1px solid var(--line)', opacity: isDragging ? 0.25 : 1 }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium truncate leading-snug" style={{ color: 'var(--fg)' }} title={description}>
            {description}
          </p>
          <p className="text-[11px] mt-0.5 leading-none" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
            {shortDate}
          </p>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <p
            className="text-[11px] font-bold"
            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--fg)' }}
          >
            {amountStr}
          </p>
          {!noDrag && (
            <button
              onClick={e => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label={`Delete ${description}`}
            className="text-[10px] font-semibold mt-0.5 px-1 -mx-1 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              style={{ color: 'var(--neg)' }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      draggable={!noDrag && !selectable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={selectable ? onToggleSelect : onClick}
      className={`tx-row group flex items-start gap-2.5 select-none ${mobileCard ? 'px-4 py-4 rounded-lg' : 'px-3 py-2.5'} ${noDrag || selectable ? 'cursor-pointer active:opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
      style={
        mobileCard
          ? { backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', opacity: isDragging ? 0.25 : 1, boxShadow: 'var(--edge-light)' }
          : {
            borderBottom: '1px solid var(--line)',
            opacity: isDragging ? 0.25 : 1,
            backgroundColor: selectable && selected ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : undefined,
          }
      }
    >
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect?.()}
          onClick={e => e.stopPropagation()}
          aria-label={`Select ${description}`}
          className="w-4 h-4 mt-[3px] shrink-0 accent-[var(--accent)]"
        />
      )}

      {!mobileCard && !selectable && (
        <div className="mt-[3px] shrink-0 opacity-0 group-hover:opacity-30 transition-opacity" style={{ color: 'var(--muted)' }}>
          <svg width="8" height="13" viewBox="0 0 8 13" fill="currentColor">
            <circle cx="2" cy="2" r="1.2" />
            <circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="6.5" r="1.2" />
            <circle cx="6" cy="6.5" r="1.2" />
            <circle cx="2" cy="11" r="1.2" />
            <circle cx="6" cy="11" r="1.2" />
          </svg>
        </div>
      )}

      {mobileCard && (
        <div
          className="w-6 h-9 flex items-center justify-center shrink-0 mt-0.5"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" style={{ color: pos ? 'var(--pos)' : 'var(--muted)' }}>
            {pos ? (
              <path
                fillRule="evenodd"
                d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            ) : (
              <path
                fillRule="evenodd"
                d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            )}
          </svg>
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* `min-w-0` above plus `truncate` here is what stops a long merchant
            name from pushing the amount off the right edge. The full string
            stays reachable through the title, and through the editor. */}
        <p
          className={`${mobileCard ? 'text-sm' : 'text-[13px]'} font-semibold leading-snug truncate`}
          style={{ color: 'var(--fg)' }}
          title={description}
        >
          {description}
        </p>
        <p className={`${mobileCard ? 'text-xs' : 'text-[11px]'} mt-0.5 truncate`} style={{ color: 'var(--dim)' }}>
          {[accountName, categoryLabel, shortDate].filter(Boolean).join(' · ')}
        </p>
        {(showKind || collections.length > 0) && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {showKind && (
              <span
                className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none"
                style={{ color: KIND_COLORS[kind], backgroundColor: 'var(--elev-sub)' }}
              >
                {KIND_LABELS[kind]}
              </span>
            )}
            {collections.slice(0, MAX_CHIPS).map(c => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none max-w-[140px]"
                style={{ color: 'var(--muted)', backgroundColor: 'var(--elev-sub)' }}
                title={`In ${c.name}`}
              >
                {c.emoji
                  ? <span aria-hidden="true">{c.emoji}</span>
                  : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color || 'var(--accent)' }} aria-hidden="true" />}
                <span className="truncate">{c.name}</span>
              </span>
            ))}
            {collections.length > MAX_CHIPS && (
              <span className="text-[10px] font-medium" style={{ color: 'var(--dim)' }} title={collections.slice(MAX_CHIPS).map(c => c.name).join(', ')}>
                +{collections.length - MAX_CHIPS}
              </span>
            )}
          </div>
        )}
        {mobileCard && (
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
              Review
            </span>
            <span className="h-px flex-1" style={{ backgroundColor: 'var(--line)' }} />
          </div>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end">
        <p
          className={`${mobileCard ? 'text-base' : 'text-[11px]'} font-bold`}
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--fg)' }}
        >
          {amountStr}
        </p>
        {!noDrag && (
          <button
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${description}`}
            className="text-[10px] font-semibold mt-0.5 px-1 -mx-1 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            style={{ color: 'var(--neg)' }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};

export default TransactionCard;
