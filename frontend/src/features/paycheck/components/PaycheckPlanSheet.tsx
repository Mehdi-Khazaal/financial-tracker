import React, { useEffect, useMemo, useState } from 'react';
import BottomSheet from '../../../components/BottomSheet';
import type { Account, PaycheckPlan, SavingsGoal } from '../../../types';
import { savePaycheckPlan } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { dollars } from '../../analytics/format';

/**
 * Set up the paycheck plan: which deposits are pay, and what each payday puts
 * toward each goal, kept in which account.
 *
 * Payers that deposit on a regular rhythm are offered as paychecks and start
 * ticked the first time, because that is almost always what they are; a
 * one-off like a scholarship is never offered.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  plan: PaycheckPlan;
  goals: SavingsGoal[];
  accounts: Account[];
  onSaved: (plan: PaycheckPlan) => void;
}

interface LineDraft {
  amount: string;
  accountId: number | null;
}

const PaycheckPlanSheet: React.FC<Props> = ({ isOpen, onClose, plan, goals, accounts, onSaved }) => {
  const toast = useToast();
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<Record<number, LineDraft>>({});
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);

  const payers = useMemo(() => {
    const byKey = new Map<string, { merchant_key: string; name: string; detail: string | null }>();
    plan.suggested_sources.forEach(s => byKey.set(s.merchant_key, {
      merchant_key: s.merchant_key,
      name: s.name,
      detail: `every ${s.gap_days} days · usually ${dollars(Number(s.typical_amount))}`,
    }));
    plan.sources.forEach(s => { if (!byKey.has(s.merchant_key)) byKey.set(s.merchant_key, { ...s, detail: null }); });
    return Array.from(byKey.values());
  }, [plan]);

  const holdingAccounts = accounts.filter(a => a.type !== 'credit_card');

  useEffect(() => {
    if (!isOpen) return;
    setSources(new Set(plan.configured
      ? plan.sources.map(s => s.merchant_key)
      : plan.suggested_sources.map(s => s.merchant_key)));
    const drafts: Record<number, LineDraft> = {};
    plan.lines.forEach(l => { drafts[l.goal_id] = { amount: String(Number(l.amount)), accountId: l.account_id }; });
    setLines(drafts);
    setNotify(plan.notify);
  }, [isOpen, plan]);

  const perPayday = Object.values(lines).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const perMonth = perPayday * (Number(plan.paydays_per_month) || 0);

  const setLine = (goalId: number, patch: Partial<LineDraft>) =>
    setLines(prev => {
      const current: LineDraft = prev[goalId] ?? { amount: '', accountId: null };
      return { ...prev, [goalId]: { ...current, ...patch } };
    });

  const toggleSource = (key: string) => setSources(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await savePaycheckPlan({
        sources: payers.filter(p => sources.has(p.merchant_key)).map(p => ({ merchant_key: p.merchant_key, name: p.name })),
        lines: goals
          .filter(g => (parseFloat(lines[g.id]?.amount ?? '') || 0) > 0)
          .map(g => ({ goal_id: g.id, amount: parseFloat(lines[g.id].amount), account_id: lines[g.id].accountId ?? null })),
        notify,
      });
      onSaved(res.data);
      toast.success('Paycheck plan saved');
      onClose();
    } catch {
      toast.error('Could not save the paycheck plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Paycheck plan">
      <form onSubmit={save} className="px-5 pb-6 space-y-6">
        <fieldset>
          <legend className="label mb-2">Which deposits are paychecks?</legend>
          {payers.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              No regular deposits yet. Once a payer has paid you three times on a rhythm, it shows up here.
            </p>
          ) : (
            <ul className="row-list">
              {payers.map(p => (
                <li key={p.merchant_key}>
                  <label className="flex items-center gap-3 py-2.5 min-h-[44px] cursor-pointer">
                    <input type="checkbox" className="w-4 h-4" checked={sources.has(p.merchant_key)} onChange={() => toggleSource(p.merchant_key)} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium" style={{ color: 'var(--fg)' }}>{p.name}</span>
                      {p.detail && <span className="block text-xs" style={{ color: 'var(--muted)' }}>{p.detail}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <fieldset>
          <legend className="label mb-1">From each payday</legend>
          <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
            How much goes to each goal, and the account you keep it in. Leave a goal empty to keep it out of the plan.
          </p>
          {goals.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Add a savings goal first.</p>
          ) : (
            <ul className="row-list">
              {goals.map(g => (
                <li key={g.id} className="py-2.5 grid grid-cols-[1fr_7rem] sm:grid-cols-[1fr_7rem_9rem] gap-2 items-center">
                  <label className="text-sm font-medium truncate" htmlFor={`line-amount-${g.id}`} style={{ color: 'var(--fg)' }}>{g.name}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-mono text-sm">$</span>
                    <input
                      id={`line-amount-${g.id}`}
                      type="number" step="0.01" min="0" inputMode="decimal"
                      className="input-dark pl-6"
                      placeholder="0"
                      value={lines[g.id]?.amount ?? ''}
                      onChange={e => setLine(g.id, { amount: e.target.value })}
                    />
                  </div>
                  <select
                    aria-label={`Account for ${g.name}`}
                    className="input-dark col-span-2 sm:col-span-1"
                    value={lines[g.id]?.accountId ?? ''}
                    onChange={e => setLine(g.id, { accountId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">No account</option>
                    {holdingAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
          {perPayday > 0 && (
            <p className="text-xs mt-2 tabular-nums" style={{ color: 'var(--muted)' }}>
              {dollars(perPayday)} a payday to goals, about {dollars(perMonth)} a month.
            </p>
          )}
        </fieldset>

        <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
          <input type="checkbox" className="mt-1 w-4 h-4" checked={notify} onChange={e => setNotify(e.target.checked)} />
          <span className="text-sm" style={{ color: 'var(--fg)' }}>
            Notify me when a paycheck lands, with the split
          </span>
        </label>

        <button type="submit" disabled={saving} className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save plan'}
        </button>
      </form>
    </BottomSheet>
  );
};

export default PaycheckPlanSheet;
