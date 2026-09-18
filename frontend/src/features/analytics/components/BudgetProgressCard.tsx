import React from 'react';
import type { BudgetProgressSummary } from '../../../types';
import ProgressBar from '../../../components/ProgressBar';
import { dollars } from '../format';
import { summarizeBudgets } from '../../overview/calculations/budgets';
import { PanelEmpty, SectionHeader } from './AnalyticsPrimitives';

/**
 * Budgets on Analytics: the same figures as Overview, laid out for reading
 * rather than glancing — every budget, with what was carried in and what is
 * left, for the month the page is looking at.
 */
interface Props {
  summary: BudgetProgressSummary | null;
  monthLabel: string;
  today: Date;
  onManage: () => void;
}

const BudgetProgressCard: React.FC<Props> = ({ summary, monthLabel, today, onManage }) => {
  const view = summarizeBudgets(summary, today);

  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-budgets-heading">
      <SectionHeader
        id="analytics-budgets-heading"
        eyebrow="Budgets"
        title={`Allowances for ${monthLabel}`}
        description={view.items.length > 0 ? `${dollars(view.spent)} of ${dollars(view.budgeted)} spent across ${view.items.length} budget${view.items.length === 1 ? '' : 's'}.` : undefined}
        right={(
          <button type="button" onClick={onManage} className="btn-ghost pressable px-3 text-xs" style={{ minHeight: 44 }}>
            Manage
          </button>
        )}
      />
      {view.items.length === 0 ? (
        <PanelEmpty
          title="No budgets for this month"
          body="Set a monthly allowance per category and this card shows how each one is going, including anything carried over."
          action={<button type="button" onClick={onManage} className="text-xs font-medium pressable" style={{ color: 'var(--accent)', minHeight: 44 }}>Set a budget →</button>}
        />
      ) : (
        <ul className="mt-4 space-y-3" aria-label="Budget progress">
          {view.items.map(item => (
            <li key={item.id}>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="min-w-0 flex items-baseline gap-2">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{item.name}</p>
                  {item.rollover && <span className="label" style={{ color: 'var(--dim)', fontSize: 9 }}>rollover</span>}
                </div>
                <p className="font-mono tabular-nums text-xs shrink-0" style={{ color: item.color }}>{item.statusLabel}</p>
              </div>
              <ProgressBar value={item.percent} color={item.color} height={5} label={`${item.name} budget used`} />
              <p className="font-mono tabular-nums text-[11px] mt-1" style={{ color: 'var(--dim)' }}>
                {dollars(item.spent)} spent · {dollars(item.available)} available{item.carried > 0 ? ` (${dollars(item.carried)} carried in)` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default BudgetProgressCard;
