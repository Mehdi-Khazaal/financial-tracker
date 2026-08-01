import React from 'react';
import type { ResolvedPeriod, SavingsMetrics } from '../types';
import { dollars, percent, plural } from '../format';
import { SAVINGS_DEFINITION } from '../calculations/savings';
import ProgressBar from '../../../components/ProgressBar';
import { DeltaBadge, InfoHint, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  savings: SavingsMetrics;
  period: ResolvedPeriod;
  onNavigate: (to: string, tab?: string) => void;
}

/**
 * A preview, not the Savings page.
 *
 * Fintrack already has a full savings experience under Portfolio → Savings.
 * This card answers "am I saving, and is one goal on track" and then hands
 * off. It shows a single goal by design — the selection rule is stated in the
 * tooltip so the choice is never mysterious.
 */
const SavingsOverviewCard: React.FC<Props> = ({ savings, period, onNavigate }) => {
  const goal = savings.primaryGoal;
  const periodWord = period.isSingleMonth ? 'this month' : 'this period';

  return (
    <section className="ledger-panel p-4 md:p-5 h-full flex flex-col" aria-labelledby="analytics-savings-heading">
      <SectionHeader
        id="analytics-savings-heading"
        eyebrow="Savings"
        title={`What you kept ${periodWord}`}
        hint={SAVINGS_DEFINITION}
        right={
          <button
            type="button"
            onClick={() => onNavigate('/portfolio', 'savings')}
            className="text-xs font-semibold pressable"
            style={{ color: 'var(--accent)' }}
          >
            View savings →
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="ledger-cell p-3.5">
          <p className="label mb-1.5">Saved</p>
          <p
            className="font-mono tabular-nums text-lg font-bold leading-none"
            style={{ color: savings.saved >= 0 ? 'var(--pos)' : 'var(--neg)' }}
          >
            {savings.saved < 0 ? '−' : ''}{dollars(Math.abs(savings.saved))}
          </p>
          {savings.savedDelta != null && (
            <div className="mt-2">
              <DeltaBadge value={savings.savedDelta} polarity="up-good" />
            </div>
          )}
        </div>

        <div className="ledger-cell p-3.5">
          <p className="label mb-1.5">Savings rate</p>
          <p
            className="font-mono tabular-nums text-lg font-bold leading-none"
            style={{ color: savings.savingsRate == null ? 'var(--muted)' : savings.savingsRate >= 0.2 ? 'var(--pos)' : 'var(--accent)' }}
          >
            {savings.savingsRate != null ? percent(savings.savingsRate) : '—'}
          </p>
          {savings.averageMonthlySaved != null && savings.averageMonths > 0 && (
            <p className="text-[10px] mt-2" style={{ color: 'var(--dim)' }}>
              {dollars(savings.averageMonthlySaved)} typical month
            </p>
          )}
        </div>
      </div>

      {goal ? (
        <div className="ledger-cell p-4 mt-auto">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="label">Primary goal</p>
                <InfoHint
                  label="How the primary goal is chosen"
                  text={goal.basis === 'deadline'
                    ? 'Fintrack goals have no priority flag, so the goal with the nearest upcoming deadline is featured here. Every goal is on the Savings page.'
                    : 'No goal has an upcoming deadline, so the goal furthest along is featured here. Every goal is on the Savings page.'}
                />
              </div>
              <p className="text-sm font-semibold truncate mt-1" style={{ color: 'var(--fg)' }}>
                {goal.name}
              </p>
            </div>
            <p
              className="font-mono tabular-nums text-sm font-bold shrink-0"
              style={{ color: goal.progress >= 100 ? 'var(--pos)' : 'var(--accent)' }}
            >
              {goal.progress.toFixed(0)}%
            </p>
          </div>

          <p className="font-mono tabular-nums text-xs mb-2.5" style={{ color: 'var(--muted)' }}>
            {dollars(goal.current, 0)}
            <span style={{ color: 'var(--dim)' }}> of {dollars(goal.target, 0)}</span>
          </p>

          <ProgressBar value={goal.progress} colorAuto={false} color="var(--accent)" height={5} showLabel={false} />

          <div className="flex items-end justify-between gap-3 mt-3">
            <div>
              <p className="label mb-1">Still needed</p>
              <p className="font-mono tabular-nums text-xs font-semibold" style={{ color: 'var(--fg)' }}>
                {dollars(goal.remaining)}
              </p>
            </div>
            <div className="text-right">
              <p className="label mb-1">Est. completion</p>
              {goal.projectedCompletion ? (
                <p className="font-mono text-xs font-semibold" style={{ color: 'var(--fg)' }}>
                  {goal.projectedCompletion}
                </p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--dim)' }}>Not enough history</p>
              )}
            </div>
          </div>

          {goal.projectedCompletion && goal.monthsToCompletion != null && (
            <p className="text-[10px] mt-2.5 leading-relaxed" style={{ color: 'var(--dim)' }}>
              Estimated from your {dollars(savings.averageMonthlySaved ?? 0)} average monthly saving over{' '}
              {plural(savings.averageMonths, 'completed month')} — about{' '}
              {plural(goal.monthsToCompletion, 'month')} at that pace. A projection, not a commitment.
            </p>
          )}
        </div>
      ) : (
        <div className="ledger-cell p-4 mt-auto text-center">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--fg)' }}>
            You saved {dollars(Math.max(0, savings.saved))} {periodWord}.
          </p>
          <p className="text-xs mb-3.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
            Create a goal to track what you are saving toward and see an estimated completion date here.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/portfolio', 'savings')}
            className="btn-gradient px-5 py-2.5 text-sm"
          >
            Create a goal
          </button>
        </div>
      )}

      {savings.allocatedTotal > 0 && (
        <div className="flex items-center justify-between gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-[11px] truncate" style={{ color: 'var(--muted)' }}>
              Set aside across {plural(savings.goalCount, 'goal')}
            </p>
            <InfoHint
              label="What set aside means"
              text="Money you have earmarked from existing account balances toward goals. It is not added to what you saved this period — that would count the same dollars twice."
            />
          </div>
          <p className="font-mono tabular-nums text-xs font-semibold shrink-0" style={{ color: 'var(--fg)' }}>
            {dollars(savings.allocatedTotal)}
          </p>
        </div>
      )}
    </section>
  );
};

export default SavingsOverviewCard;
