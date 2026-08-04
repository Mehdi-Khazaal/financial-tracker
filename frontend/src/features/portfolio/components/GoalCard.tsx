import React from 'react';
import { Link } from 'react-router-dom';
import ProgressBar from '../../../components/ProgressBar';
import { dollars, plural } from '../../analytics/format';
import { linkToAccountTransactions } from '../../../lib/deepLinks';
import type { GoalPace, GoalProgress } from '../calculations/goals';

/**
 * One savings goal, framed around pace rather than balance.
 *
 * Hierarchy: name and amount set aside lead, the bar carries progress, and the
 * schedule facts — remaining, target date, required monthly, projected
 * completion — sit beneath as supporting detail. Actions come last and the
 * destructive one is plain text.
 *
 * Two things this deliberately refuses to do: invent a projection where the
 * history cannot support one, and use alarming language for being behind.
 * "Behind schedule" is a fact with an obvious remedy; it is not a failure.
 */

const PACE_COLORS: Record<GoalPace, string> = {
  complete: 'var(--pos)',
  overfunded: 'var(--pos)',
  'no-deadline': 'var(--muted)',
  'date-passed': 'var(--neg)',
  ahead: 'var(--pos)',
  'on-track': 'var(--pos)',
  behind: '#f59e0b',
  unknown: 'var(--muted)',
};

interface Props {
  progress: GoalProgress;
  isFocused?: boolean;
  /** Accounts this goal is allocated against, for the context links. */
  allocationAccounts: { id: number; name: string; amount: number }[];
  onManageAllocations: () => void;
  onSpend: () => void;
  onDelete: () => void;
}

const Fact: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="min-w-0">
    <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: 'var(--dim)' }}>{label}</p>
    <p className="font-mono tabular-nums text-xs font-semibold truncate" style={{ color: color ?? 'var(--fg)' }}>
      {value}
    </p>
  </div>
);

const GoalCard: React.FC<Props> = ({
  progress, isFocused = false, allocationAccounts, onManageAllocations, onSpend, onDelete,
}) => {
  const { presentation, goal } = progress;
  const paceColor = PACE_COLORS[progress.pace];
  const isDone = progress.pace === 'complete' || progress.pace === 'overfunded';

  return (
    <div
      id={`goal-${goal.id}`}
      className="card p-4 group flex flex-col"
      style={isFocused ? {
        borderColor: 'var(--accent)',
        boxShadow: 'var(--edge-light), 0 0 0 1px var(--accent-glow)',
      } : undefined}
    >
      {/* Primary */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }} title={goal.name}>
            {goal.name}
          </p>
          <p className="font-mono tabular-nums text-lg font-bold leading-tight mt-0.5" style={{ color: 'var(--fg)' }}>
            {dollars(progress.setAside)}
            <span className="text-xs font-normal" style={{ color: 'var(--dim)' }}> of {dollars(progress.target)}</span>
          </p>
        </div>
        <p className="font-mono tabular-nums text-sm font-bold shrink-0" style={{ color: presentation.color }}>
          {presentation.status === 'invalid' ? '—' : `${presentation.rawProgress.toFixed(0)}%`}
        </p>
      </div>

      <ProgressBar
        value={presentation.progress}
        colorAuto
        semantics="progress"
        height={5}
        label={`${goal.name}: ${presentation.statusLabel}, ${presentation.rawProgress.toFixed(0)} percent funded. ${progress.paceLabel}.`}
      />

      {/* Status in words — never colour alone. */}
      <div className="mt-2.5 flex items-start gap-1.5">
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
          style={{ color: paceColor, backgroundColor: 'var(--elev-sub)' }}
        >
          {progress.paceLabel}
        </span>
      </div>
      <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
        {progress.paceDetail}
      </p>

      {/* Secondary facts, only the ones that exist */}
      {!isDone && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          <Fact label="Remaining" value={dollars(progress.remaining)} />
          {progress.deadline && (
            <Fact
              label="Target date"
              value={new Date(`${progress.deadline}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              color={progress.deadlinePassed ? 'var(--neg)' : undefined}
            />
          )}
          {progress.requiredMonthly != null && (
            <Fact label="Needed monthly" value={dollars(progress.requiredMonthly)} color={paceColor} />
          )}
          {progress.projectedCompletion && progress.projectionAddsInformation && (
            <Fact label="Projected" value={progress.projectedCompletion} />
          )}
          {progress.monthsRemaining != null && progress.requiredMonthly == null && (
            <Fact label="Time left" value={plural(progress.monthsRemaining, 'month')} />
          )}
        </div>
      )}

      {/* Where the money actually sits */}
      {allocationAccounts.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--dim)' }}>Held in</p>
          <div className="flex flex-wrap gap-1.5">
            {allocationAccounts.map(a => (
              <Link
                key={a.id}
                to={linkToAccountTransactions(a.id)}
                className="text-[11px] px-2 rounded-lg flex items-center"
                style={{ color: 'var(--muted)', border: '1px solid var(--line)', minHeight: 30 }}
                aria-label={`${a.name}: ${dollars(a.amount)} allocated. View transactions.`}
              >
                {a.name} <span className="tabular-nums ml-1" style={{ color: 'var(--dim)' }}>{dollars(a.amount)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Actions — destructive last and quietest */}
      <div className="mt-3 pt-3 flex items-center justify-between gap-2 flex-wrap" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2">
          <button
            onClick={onManageAllocations}
            className="text-xs font-semibold px-3 rounded-lg"
            style={{ color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.25)', minHeight: 36 }}
          >
            Manage allocation
          </button>
          {allocationAccounts.length > 0 && (
            <button
              onClick={onSpend}
              className="text-xs font-medium px-2.5 rounded-lg"
              style={{ color: 'var(--muted)', border: '1px solid var(--line)', minHeight: 36 }}
            >
              Spend
            </button>
          )}
        </div>
        <button
          onClick={onDelete}
          className="text-xs px-2"
          style={{ color: 'var(--dim)', minHeight: 36 }}
          aria-label={`Delete goal ${goal.name}`}
        >
          Delete
        </button>
      </div>
    </div>
  );
};

export default GoalCard;
