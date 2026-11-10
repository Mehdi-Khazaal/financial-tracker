import React, { useState } from 'react';
import type { SavingsGoal } from '../../../types';
import { setGoalOrder } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { dollars } from '../../analytics/format';
import { describePlannedGoal, type GoalPlan } from '../calculations/goalPlan';

/**
 * The goal plan: goals in the order they are funded, each with when it is
 * really reached and whether that is in time.
 *
 * The live account's goals needed $6,405.69 a month together while about $783
 * a month was being kept, and every goal still showed its own projection as
 * if it got all of it. This states the gap once and shows the order that
 * decides who waits. Moving a goal up or down changes the order on the server
 * and every date follows.
 */

interface Props {
  plan: GoalPlan;
  /** Called with the new order after it is saved. */
  onReordered: (goals: SavingsGoal[]) => void;
}

const statusColor = (status: string) =>
  status === 'late' || status === 'never' || status === 'date-passed'
    ? 'var(--warn)'
    : status === 'on-time' || status === 'complete' ? 'var(--pos)' : 'var(--muted)';

const GoalPlanCard: React.FC<Props> = ({ plan, onReordered }) => {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  if (plan.goals.length === 0) return null;

  const move = async (index: number, delta: -1 | 1) => {
    const order = plan.goals.map(p => p.goal);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setSaving(true);
    try {
      const res = await setGoalOrder(order.map(g => g.id));
      onReordered(Array.isArray(res.data) ? res.data as SavingsGoal[] : order);
    } catch {
      toast.error('Could not change the order');
    } finally {
      setSaving(false);
    }
  };

  const saving$ = plan.monthlySaving != null && plan.monthlySaving > 0 ? plan.monthlySaving : null;
  const shortfall = plan.neededMonthly - Math.max(saving$ ?? 0, plan.fromPaychecks);

  return (
    <section className="pb-6" style={{ borderBottom: '1px solid var(--line)' }} aria-labelledby="goal-plan-heading">
      <h2 className="section-title" id="goal-plan-heading">Goal plan</h2>
      <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--muted)' }}>
        {plan.neededMonthly > 0 && (
          <>Your goals need <span className="tabular-nums font-semibold" style={{ color: 'var(--fg)' }}>{dollars(plan.neededMonthly)}</span> a month to finish on time. </>
        )}
        {saving$ != null
          ? <>You keep about <span className="tabular-nums font-semibold" style={{ color: 'var(--fg)' }}>{dollars(saving$)}</span> a month</>
          : plan.monthlySaving == null
            ? 'There is not enough saving history yet to plan with'
            // Two different facts: no history, or history showing nothing kept.
            : 'Over recent months you have spent about what you earned, so nothing is left over for goals'}
        {plan.fromPaychecks > 0 && (
          <>, and your paycheck plan puts <span className="tabular-nums font-semibold" style={{ color: 'var(--fg)' }}>{dollars(plan.fromPaychecks)}</span> a month toward goals</>
        )}
        .
        {plan.neededMonthly > 0 && shortfall > 0 && plan.hasCapacity && ' Not every goal can make its date, so the order decides which waits.'}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
        What you keep each month goes to the top goal first, then the next.
      </p>

      <ol className="row-list mt-3">
        {plan.goals.map((p, index) => (
          <li key={p.goal.id} className="flex items-center gap-3 py-2.5">
            <span className="font-mono tabular-nums text-xs w-5 shrink-0 text-right" style={{ color: 'var(--dim)' }}>{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
                {p.goal.name}
                {p.goal.is_emergency_fund && <span className="text-xs font-normal ml-2" style={{ color: 'var(--muted)' }}>emergency fund</span>}
              </p>
              <p className="text-xs" style={{ color: statusColor(p.status) }}>{describePlannedGoal(p)}</p>
              {p.neededMonthly != null && p.status !== 'complete' && (
                <p className="text-xs tabular-nums" style={{ color: 'var(--dim)' }}>
                  Needs {dollars(p.neededMonthly)} a month for its date
                  {p.fromPaychecks > 0 && ` · ${dollars(p.fromPaychecks)} a month from paychecks`}
                </p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button type="button" className="btn-ghost w-11 h-11 md:w-8 md:h-8 text-sm"
                disabled={saving || index === 0} onClick={() => void move(index, -1)}
                aria-label={`Move ${p.goal.name} up`}>↑</button>
              <button type="button" className="btn-ghost w-11 h-11 md:w-8 md:h-8 text-sm"
                disabled={saving || index === plan.goals.length - 1} onClick={() => void move(index, 1)}
                aria-label={`Move ${p.goal.name} down`}>↓</button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default GoalPlanCard;
