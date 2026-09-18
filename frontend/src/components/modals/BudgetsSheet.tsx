import React, { useEffect, useMemo, useState } from 'react';
import BottomSheet from '../BottomSheet';
import type { Budget, BudgetProgressSummary, Category } from '../../types';
import { createBudget, deleteBudget, getBudgets, updateBudget } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { dollars } from '../../features/analytics/format';

/**
 * Manage budgets: one row per budgeted category with inline edit, and a form
 * to add one for any expense category that has none yet.
 *
 * Amounts are entered as decimals and sent as strings, so what the user typed
 * is what the server stores — no float on the way. Rollover is explained in
 * one line because it is the only concept here that needs one.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called after any change so the page can refresh its progress. */
  onChanged: () => void;
  categories: Category[];
  progress: BudgetProgressSummary | null;
}

const BudgetsSheet: React.FC<Props> = ({ isOpen, onClose, onChanged, categories, progress }) => {
  const toast = useToast();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [rollover, setRollover] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getBudgets();
      setBudgets(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error('Budgets could not be loaded');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isOpen) void load(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const budgetedIds = useMemo(() => new Set(budgets.map(b => b.category_id)), [budgets]);
  const available = useMemo(
    () => categories.filter(c => c.type === 'expense' && !budgetedIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [categories, budgetedIds],
  );
  const nameOf = (id: number) => categories.find(c => c.id === id)?.name ?? 'Category';
  const progressOf = (id: number) => progress?.budgets.find(b => b.id === id);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!categoryId || !amount) return;
    setBusy(true);
    try {
      await createBudget({ category_id: Number(categoryId), amount, rollover });
      toast.success('Budget set');
      setCategoryId(''); setAmount(''); setRollover(false);
      await load();
      onChanged();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'The budget could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (budget: Budget) => {
    if (!editAmount) return;
    setBusy(true);
    try {
      await updateBudget(budget.id, { amount: editAmount });
      setEditingId(null);
      await load();
      onChanged();
    } catch {
      toast.error('The budget could not be updated');
    } finally {
      setBusy(false);
    }
  };

  const toggleRollover = async (budget: Budget) => {
    setBusy(true);
    try {
      await updateBudget(budget.id, { rollover: !budget.rollover });
      await load();
      onChanged();
    } catch {
      toast.error('The budget could not be updated');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (budget: Budget) => {
    const ok = await toast.confirm(`Remove the ${nameOf(budget.category_id)} budget? Transactions are not affected.`, { title: 'Remove budget', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteBudget(budget.id);
      await load();
      onChanged();
    } catch {
      toast.error('The budget could not be removed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Budgets" size="lg">
      <div className="px-5 pb-6 space-y-5">
        <form onSubmit={add} className="space-y-3" aria-label="Add a budget">
          <p className="label">New budget</p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="input-dark" aria-label="Category" required disabled={available.length === 0}>
              <option value="">{available.length === 0 ? 'Every expense category has a budget' : 'Choose a category'}</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-mono">$</span>
              <input type="text" inputMode="decimal" pattern="[0-9]*[.]?[0-9]{0,2}" value={amount} onChange={e => setAmount(e.target.value)} className="input-dark pl-7" placeholder="400" aria-label="Monthly amount" required />
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm" style={{ color: 'var(--muted)', minHeight: 44 }}>
            <input type="checkbox" checked={rollover} onChange={e => setRollover(e.target.checked)} className="w-4 h-4" />
            <span>Roll unspent money into next month <span style={{ color: 'var(--dim)' }}>(overspending never carries)</span></span>
          </label>
          <button type="submit" className="btn-gradient pressable w-full" style={{ minHeight: 44 }} disabled={busy || !categoryId || !amount}>
            Set budget
          </button>
        </form>

        <div>
          <p className="label mb-2">This month</p>
          {loading ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--dim)' }} role="status">Loading…</p>
          ) : budgets.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--dim)' }}>No budgets yet. Pick a category above.</p>
          ) : (
            <ul className="space-y-2" aria-label="Budgets">
              {budgets.map(budget => {
                const p = progressOf(budget.id);
                const editing = editingId === budget.id;
                return (
                  <li key={budget.id} className="rounded-xl p-3" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{nameOf(budget.category_id)}</p>
                        <p className="font-mono tabular-nums text-xs" style={{ color: p?.over ? 'var(--neg)' : 'var(--muted)' }}>
                          {p ? `${dollars(Number(p.spent))} of ${dollars(Number(p.available))}` : `${dollars(Number(budget.amount))} / month`}
                          {p && Number(p.carried) > 0 ? ` · ${dollars(Number(p.carried))} carried` : ''}
                        </p>
                      </div>
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <input type="text" inputMode="decimal" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="input-dark w-24" aria-label={`New amount for ${nameOf(budget.category_id)}`} />
                          <button type="button" className="btn-gradient pressable px-3" style={{ minHeight: 40 }} onClick={() => { void saveEdit(budget); }} disabled={busy}>Save</button>
                          <button type="button" className="btn-ghost pressable px-3" style={{ minHeight: 40 }} onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" className="btn-ghost pressable px-3 text-xs" style={{ minHeight: 40 }} onClick={() => { setEditingId(budget.id); setEditAmount(String(budget.amount)); }} aria-label={`Edit ${nameOf(budget.category_id)} budget`}>
                            {dollars(Number(budget.amount), 0)}
                          </button>
                          <button type="button" className="btn-ghost pressable px-2 text-xs" style={{ minHeight: 40, color: budget.rollover ? 'var(--accent)' : 'var(--dim)' }} onClick={() => { void toggleRollover(budget); }} disabled={busy} aria-pressed={budget.rollover} aria-label={`Rollover for ${nameOf(budget.category_id)}`}>
                            ↻
                          </button>
                          <button type="button" className="btn-ghost pressable px-2 text-xs" style={{ minHeight: 40, color: 'var(--neg)' }} onClick={() => { void remove(budget); }} disabled={busy} aria-label={`Remove ${nameOf(budget.category_id)} budget`}>
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </BottomSheet>
  );
};

export default BudgetsSheet;
