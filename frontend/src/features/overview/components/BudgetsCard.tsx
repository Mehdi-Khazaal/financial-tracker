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
      <section aria-label="Budgets">
        <h2 className="section-title mb-2">Budgets</h2>
        <p className="text-sm py-3.5" style={{ color: 'var(--muted)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>Budgets could not be loaded</p>
      </section>
    );
  }

  if (view.items.length === 0) {
    return (
      <section aria-label="Budgets">
        <h2 className="section-title mb-2">Budgets</h2>
        <div className="flex items-center justify-between gap-3 py-1" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No budgets yet</p>
          <button type="button" onClick={onManage} className="section-link" style={{ minHeight: 44 }}>
            Set a budget →
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Budgets">
      <div className="flex items-center justify-between">
        <h2 className="section-title">Budgets</h2>
        <button type="button" onClick={onManage} className="section-link" style={{ minHeight: 40 }}>
          Manage →
        </button>
      </div>

      {/* The total only adds something with two or more budgets; with one it
          repeated the row below it, unlabelled. */}
      {view.items.length > 1 && (
        <div className="py-3" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-mono tabular-nums text-sm" style={{ color: 'var(--fg)' }}>
              <span className="font-sans text-xs mr-2" style={{ color: 'var(--muted)' }}>All budgets</span>
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
      )}

      {/* With no total above, the list carries the rule under the heading. */}
      <div className="row-list" style={view.items.length > 1 ? undefined : { borderTop: '1px solid var(--line)' }}>
        {view.items.slice(0, MAX_ROWS).map(item => (
          <div key={item.id} className="py-3" aria-label={`${item.name}: ${item.statusLabel}`}>
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
          <button type="button" onClick={onManage} className="section-link text-left py-2" style={{ minHeight: 44 }}>
            {view.items.length - MAX_ROWS} more →
          </button>
        )}
      </div>
    </section>
  );
};

export default BudgetsCard;
