import React from 'react';
import type { BudgetProgressSummary } from '../../../types';
import ProgressBar from '../../../components/ProgressBar';
import { dollars } from '../../analytics/format';
import { summarizeBudgets } from '../calculations/budgets';

/**
 * Budgets on Overview: this month's allowances, worst first.
 *
 * Reference-tier like Goals: a word and a number per row, a bar underneath,
 * no chart. The header carries the one figure that matters — how much of the
 * whole month's budget is gone — and a pace verdict against the calendar.
 */
interface Props {
  summary: BudgetProgressSummary | null;
  today: Date;
  onManage: () => void;
  /** True while the source failed to load; the card then says so and offers a retry through Manage. */
  unavailable?: boolean;
}

const MAX_ROWS = 5;

const BudgetsCard: React.FC<Props> = ({ summary, today, onManage, unavailable = false }) => {
  const view = summarizeBudgets(summary, today);

  if (unavailable) {
    return (
      <div className="rounded-lg py-8 px-4 text-center" style={{ backgroundColor: 'var(--elev-1)', border: '1px dashed var(--line)' }}>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Budgets could not be loaded</p>
      </div>
    );
  }

  if (view.items.length === 0) {
    return (
      <div
        className="rounded-lg py-10 px-4 text-center flex flex-col items-center justify-center gap-2"
        style={{ backgroundColor: 'var(--elev-1)', border: '1px dashed var(--line)' }}
      >
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No budgets yet</p>
        <button type="button" onClick={onManage} className="text-xs font-medium pressable" style={{ color: 'var(--accent)', minHeight: 44 }}>
          Set a budget →
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="label">Budgets</p>
        <button type="button" onClick={onManage} className="text-xs font-medium pressable" style={{ color: 'var(--accent)', minHeight: 44 }}>
          Manage →
        </button>
      </div>

      <div className="rounded-lg p-4 mb-2" style={{ backgroundColor: 'var(--elev-1)' }}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-mono tabular-nums text-sm" style={{ color: 'var(--fg)' }}>
            {dollars(view.spent)}<span style={{ color: 'var(--dim)' }}> / {dollars(view.budgeted)}</span>
          </p>
          <p className="text-[10px] font-medium shrink-0" style={{ color: view.overCount > 0 ? 'var(--neg)' : 'var(--muted)' }}>
            {view.overCount > 0 ? `${view.overCount} over` : view.paceLabel}
          </p>
        </div>
        <div className="mt-2">
          <ProgressBar
            value={view.budgeted > 0 ? (view.spent / view.budgeted) * 100 : 0}
            color={view.overCount > 0 ? 'var(--neg)' : 'var(--accent)'}
            height={4}
            label="Share of this month's budgets spent"
          />
        </div>
      </div>

      <div className="space-y-2">
        {view.items.slice(0, MAX_ROWS).map(item => (
          <div key={item.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }} aria-label={`${item.name}: ${item.statusLabel}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm font-medium truncate min-w-0" style={{ color: 'var(--fg)' }}>{item.name}</p>
              <p className="font-mono tabular-nums text-xs font-bold shrink-0" style={{ color: item.color }}>
                {Math.round(item.rawPercent)}%
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <p className="font-mono tabular-nums text-xs truncate" style={{ color: 'var(--muted)' }}>
                {dollars(item.spent)}<span style={{ color: 'var(--dim)' }}> / {dollars(item.available)}</span>
                {item.carried > 0 && <span style={{ color: 'var(--dim)' }}> · {dollars(item.carried)} carried</span>}
              </p>
              <p className="text-[10px] font-medium shrink-0" style={{ color: item.color }}>{item.statusLabel}</p>
            </div>
            <ProgressBar value={item.percent} color={item.color} height={4} />
          </div>
        ))}
        {view.items.length > MAX_ROWS && (
          <button type="button" onClick={onManage} className="text-xs font-medium px-1 pressable" style={{ color: 'var(--accent)', minHeight: 44 }}>
            {view.items.length - MAX_ROWS} more →
          </button>
        )}
      </div>
    </div>
  );
};

export default BudgetsCard;
