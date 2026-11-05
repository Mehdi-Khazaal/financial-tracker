import React from 'react';
import { Link } from 'react-router-dom';
import type { SavingsGoal } from '../../../types';
import ProgressBar from '../../../components/ProgressBar';
import { dollars } from '../../analytics/format';
import { describeGoal } from '../calculations/goals';
import { linkToGoal, linkToSavings } from '../../../lib/deepLinks';

/**
 * Savings goals on Overview.
 *
 * Status is carried by a word as well as a colour, and a finished goal is green
 * rather than red — see `calculations/goals.ts` for why it ever was red.
 */

interface Props {
  goals: SavingsGoal[];
  today: Date;
}

const GoalsList: React.FC<Props> = ({ goals, today }) => {
  if (goals.length === 0) {
    return (
      <section aria-label="Savings goals">
        <h2 className="section-title mb-2">Savings goals</h2>
        <div className="flex items-center justify-between gap-3 py-3.5" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No savings goals yet</p>
          <Link to={linkToSavings()} className="section-link">
            Add a goal →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Savings goals">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="section-title">Savings goals</h2>
        <Link to={linkToSavings()} className="section-link">
          View all →
        </Link>
      </div>

      <div className="row-list">
        {goals.slice(0, 4).map(goal => {
          const status = describeGoal(goal, today);
          const target = Number(goal.target_amount) || 0;
          const current = Number(goal.current_amount) || 0;

          return (
            // Opens the Savings tab scrolled to this goal, not the top of it.
            <Link
              key={goal.id}
              to={linkToGoal(goal.id)}
              aria-label={`${goal.name}: ${status.statusLabel}, ${status.rawProgress.toFixed(0)} percent funded. Open goal.`}
              className="row-link block py-3"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-medium truncate min-w-0" style={{ color: 'var(--fg)' }}>{goal.name}</p>
                <p className="font-mono tabular-nums text-xs font-bold shrink-0" style={{ color: status.color }}>
                  {status.status === 'invalid' ? '—' : `${status.rawProgress.toFixed(0)}%`}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 mb-2.5">
                <p className="font-mono tabular-nums text-xs truncate" style={{ color: 'var(--muted)' }}>
                  {dollars(current)}<span style={{ color: 'var(--dim)' }}> / {dollars(target)}</span>
                </p>
                {/* Status in words, so it does not depend on the bar's colour. */}
                <p className="text-[10px] font-medium shrink-0" style={{ color: status.color }}>
                  {status.statusLabel}
                </p>
              </div>

              <ProgressBar
                value={status.progress}
                colorAuto
                semantics="progress"
                height={4}
                showLabel={false}
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default GoalsList;
