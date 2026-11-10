import React, { useState } from 'react';
import type { Account, PaycheckPlan, PaydayLine, SavingsGoal } from '../../../types';
import { tickPaycheckLine, untickPaycheckLine } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { dollars } from '../../analytics/format';
import PaycheckPlanSheet from './PaycheckPlanSheet';

/**
 * The latest payday, worked through the plan: bills due before the next one,
 * each goal's share, and what is free. Ticking a line says the money was
 * moved; by default it also sets the amount aside for the goal in the line's
 * account. When that account does not hold the money yet, the card says so
 * and offers to mark it done without setting anything aside.
 */

interface Props {
  plan: PaycheckPlan | null;
  goals: SavingsGoal[];
  accounts: Account[];
  today: Date;
  onPlanChange: (plan: PaycheckPlan) => void;
  /** Ticking can change a goal's set-aside money; the page reloads goals. */
  onGoalsChanged: () => void;
}

const dayLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function daysUntil(iso: string, today: Date): number {
  const target = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

const relative = (days: number) =>
  days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 ? `in ${days} days` : `${-days} days ago`;

const errorMessage = (error: unknown): string | null => {
  const detail = (error as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  if (detail?.status !== 409) return null;
  const body = detail.data?.detail as { message?: string } | undefined;
  return body?.message ?? 'That account does not hold the money yet.';
};

const PaycheckPlanCard: React.FC<Props> = ({ plan, goals, accounts, today, onPlanChange, onGoalsChanged }) => {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<Record<number, string>>({});
  const [showBills, setShowBills] = useState(false);

  if (!plan) return null;

  const latest = plan.latest;

  const tick = async (line: PaydayLine, setAside: boolean) => {
    if (!latest) return;
    setBusy(line.id);
    try {
      const res = await tickPaycheckLine(latest.date, line.id, setAside);
      setBlocked(prev => { const next = { ...prev }; delete next[line.id]; return next; });
      onPlanChange(res.data);
      if (setAside) onGoalsChanged();
    } catch (error) {
      const message = errorMessage(error);
      if (message) setBlocked(prev => ({ ...prev, [line.id]: message }));
      else toast.error('Could not mark that done');
    } finally {
      setBusy(null);
    }
  };

  const untick = async (line: PaydayLine) => {
    if (!latest) return;
    setBusy(line.id);
    try {
      const res = await untickPaycheckLine(latest.date, line.id);
      onPlanChange(res.data);
      if (line.set_aside) onGoalsChanged();
    } catch {
      toast.error('Could not undo that');
    } finally {
      setBusy(null);
    }
  };

  const sheet = (
    <PaycheckPlanSheet
      isOpen={editing}
      onClose={() => setEditing(false)}
      plan={plan}
      goals={goals}
      accounts={accounts}
      onSaved={onPlanChange}
    />
  );

  if (!plan.configured) {
    const names = plan.suggested_sources.map(s => s.name);
    return (
      <section className="pb-6" style={{ borderBottom: '1px solid var(--line)' }} aria-labelledby="paycheck-heading">
        <h2 className="section-title" id="paycheck-heading">Paycheck plan</h2>
        <p className="text-sm mt-1 max-w-xl" style={{ color: 'var(--muted)' }}>
          Split each paycheck before it gets spent: the bills due before the next payday, an amount for each goal, and what is left to spend.
          {names.length > 0 && ` ${names.join(' and ')} ${names.length === 1 ? 'looks' : 'look'} like ${names.length === 1 ? 'a paycheck' : 'paychecks'}.`}
        </p>
        <button type="button" className="btn-ghost px-4 mt-3 text-sm font-semibold min-h-[44px]" onClick={() => setEditing(true)}>
          Set up the plan
        </button>
        {sheet}
      </section>
    );
  }

  const free = Number(latest?.free ?? 0);

  return (
    <section className="pb-6" style={{ borderBottom: '1px solid var(--line)' }} aria-labelledby="paycheck-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mb-3">
        <div>
          <h2 className="section-title" id="paycheck-heading">
            {latest ? `Payday ${dayLabel(latest.date)}` : 'Paycheck plan'}
            {latest && <>{' '}<span className="font-mono tabular-nums ml-1">{dollars(Number(latest.amount))}</span></>}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {latest
              ? `Next payday ${dayLabel(latest.next_payday)}, ${relative(daysUntil(latest.next_payday, today))}`
              : `No paycheck from ${plan.sources.map(s => s.name).join(' or ')} in the last six months.`}
          </p>
        </div>
        <button type="button" className="section-link min-h-[44px] md:min-h-0" onClick={() => setEditing(true)}>Edit plan</button>
      </div>

      {latest && (
        <ul className="row-list">
          <li className="py-2.5">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 text-left min-h-[36px]"
              onClick={() => setShowBills(v => !v)}
              aria-expanded={showBills}
              disabled={latest.bills.length === 0}
            >
              <span className="text-sm" style={{ color: 'var(--fg)' }}>
                Bills before {dayLabel(latest.next_payday)}
                {latest.bills.length > 0 && <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>{latest.bills.length} {showBills ? '▴' : '▾'}</span>}
              </span>
              <span className="font-mono tabular-nums text-sm" style={{ color: 'var(--fg)' }}>{dollars(Number(latest.bills_total))}</span>
            </button>
            {showBills && (
              <ul className="mt-2 space-y-1">
                {latest.bills.map((b, i) => (
                  <li key={`${b.name}-${b.date}-${i}`} className="flex justify-between text-xs" style={{ color: 'var(--muted)' }}>
                    <span>{b.name} · {b.paid ? `paid ${dayLabel(b.date)}` : `due ${dayLabel(b.date)}`}</span>
                    <span className="font-mono tabular-nums">{dollars(Number(b.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>

          {latest.lines.map(line => (
            <li key={line.id} className="py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm truncate" style={{ color: 'var(--fg)', textDecoration: line.done ? 'line-through' : undefined }}>
                    {line.goal_name}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                    {line.done
                      ? (line.set_aside ? `Set aside in ${line.account_name}` : 'Done')
                      : (line.account_name ? `Into ${line.account_name}` : 'No account chosen')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono tabular-nums text-sm" style={{ color: 'var(--fg)' }}>{dollars(Number(line.amount))}</span>
                  {line.done ? (
                    <button type="button" className="btn-ghost px-3 text-xs min-h-[44px] md:min-h-[34px]" disabled={busy === line.id}
                      onClick={() => void untick(line)} aria-label={`Undo ${line.goal_name}`}>
                      Undo
                    </button>
                  ) : (
                    <button type="button" className="btn-ghost px-3 text-xs font-semibold min-h-[44px] md:min-h-[34px]" disabled={busy === line.id}
                      onClick={() => void tick(line, line.account_id != null)} aria-label={`Mark ${line.goal_name} done`}>
                      {busy === line.id ? '…' : 'Mark done'}
                    </button>
                  )}
                </div>
              </div>
              {blocked[line.id] && !line.done && (
                <div className="mt-2 text-xs" role="status" style={{ color: 'var(--muted)' }}>
                  <p>{blocked[line.id]}</p>
                  <button type="button" className="section-link mt-1 min-h-[44px] md:min-h-0" onClick={() => void tick(line, false)}>
                    Mark done without setting aside
                  </button>
                </div>
              )}
            </li>
          ))}

          <li className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Free to spend</span>
            <span className="font-mono tabular-nums text-sm font-semibold" style={{ color: free < 0 ? 'var(--neg)' : 'var(--fg)' }}>
              {free < 0 ? '−' : ''}{dollars(Math.abs(free))}
            </span>
          </li>
        </ul>
      )}
      {latest && free < 0 && (
        <p className="text-xs mt-2" style={{ color: 'var(--neg)' }}>
          The plan asks for more than this paycheck. Lower a goal's share or move a bill.
        </p>
      )}
      {sheet}
    </section>
  );
};

export default PaycheckPlanCard;
