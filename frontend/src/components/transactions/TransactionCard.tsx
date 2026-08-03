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
 * look like income and are not, so those — and only those — say what they are.
 */
const NEEDS_LABEL: TransactionKind[] = ['refund', 'card-payment'];

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
}

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
            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--neg)' }}
          >
            {amountStr}
          </p>
          {!noDrag && (
            <button
              onClick={e => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-[8px] font-semibold mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: 'var(--neg)' }}
            >
              del
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      draggable={!noDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`tx-row group flex items-start gap-2.5 select-none ${mobileCard ? 'px-4 py-4 rounded-lg' : 'px-3 py-2.5'} ${noDrag ? 'cursor-pointer active:opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
      style={
        mobileCard
          ? { backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', opacity: isDragging ? 0.25 : 1, boxShadow: 'var(--edge-light)' }
          : { borderBottom: '1px solid var(--line)', opacity: isDragging ? 0.25 : 1 }
      }
    >
      {!mobileCard && (
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
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{ backgroundColor: pos ? 'oklch(78% 0.16 150 / 0.12)' : 'oklch(70% 0.17 25 / 0.1)' }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" style={{ color: pos ? 'var(--pos)' : 'var(--neg)' }}>
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
          {[accountName, categoryName, shortDate].filter(Boolean).join(' · ')}
        </p>
        {showKind && (
          <span
            className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none"
            style={{ color: KIND_COLORS[kind], backgroundColor: 'var(--elev-sub)' }}
          >
            {KIND_LABELS[kind]}
          </span>
        )}
        {mobileCard && (
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
              Review
            </span>
            <span className="h-px flex-1" style={{ backgroundColor: 'var(--line)' }} />
          </div>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end">
        <p
          className={`${mobileCard ? 'text-base' : 'text-[11px]'} font-bold`}
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--neg)' }}
        >
          {amountStr}
        </p>
        {!noDrag && (
          <button
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-[8px] font-semibold mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--neg)' }}
          >
            delete
          </button>
        )}
      </div>
    </div>
  );
};

export default TransactionCard;
