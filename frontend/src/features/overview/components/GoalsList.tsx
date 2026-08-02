import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import type { SavingsGoal } from '../../../types';
import ProgressBar from '../../../components/ProgressBar';
import { TabContext } from '../../../context/TabContext';
import { dollars } from '../../analytics/format';
import { describeGoal } from '../calculations/goals';

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
  const { setRouteTab } = useContext(TabContext);
  const openGoals = () => setRouteTab('/portfolio', 'savings');

  if (goals.length === 0) {
    return (
      <div
        className="rounded-lg py-10 px-4 text-center flex flex-col items-center justify-center gap-2"
        style={{ backgroundColor: 'var(--elev-1)', border: '1px dashed var(--line)' }}
      >
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No savings goals yet</p>
        <Link to="/portfolio" onClick={openGoals} className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          Add a goal →
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="label">Savings Goals</p>
        <Link to="/portfolio" onClick={openGoals} className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          View all →
        </Link>
      </div>

      <div className="space-y-2">
        {goals.slice(0, 4).map(goal => {
          const status = describeGoal(goal, today);
          const target = Number(goal.target_amount) || 0;
          const current = Number(goal.current_amount) || 0;

          return (
            <div key={goal.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
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
                label={`${goal.name}: ${status.statusLabel}, ${status.rawProgress.toFixed(0)} percent funded`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GoalsList;
