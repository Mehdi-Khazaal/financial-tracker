import React, { useEffect, useState } from 'react';
import BottomSheet from '../BottomSheet';
import { createSavingsGoal, updateSavingsGoal } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import type { SavingsGoal } from '../../types';

/**
 * Create a savings goal, or edit one — one form for both, so the wording and
 * validation cannot drift apart.
 *
 * Editing used to be impossible: a goal whose date had passed said "adjusting
 * the date keeps the goal useful" and offered no way to adjust it.
 *
 * "This is my emergency fund" matters to more than this goal. Money set aside
 * for any other goal is promised to it, so the app leaves it out of available
 * to spend and of emergency cover; the emergency fund's money still counts as
 * cover.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** The goal being edited; absent when creating. */
  goal?: SavingsGoal | null;
}

const AddSavingsGoalModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, goal = null }) => {
  const toast = useToast();
  const editing = goal != null;
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [isEmergency, setIsEmergency] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(goal?.name ?? '');
    setTargetAmount(goal ? String(Number(goal.target_amount)) : '');
    setDeadline(goal?.deadline?.slice(0, 10) ?? '');
    setIsEmergency(goal?.is_emergency_fund ?? false);
  }, [isOpen, goal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const payload = {
      name: name.trim(),
      target_amount: parseFloat(targetAmount),
      // An emergency fund is never due (see `goalDeadline`), so it keeps no date.
      deadline: isEmergency ? null : deadline || null,
      is_emergency_fund: isEmergency,
    };
    try {
      if (goal) {
        await updateSavingsGoal(goal.id, payload);
        toast.success('Goal updated');
      } else {
        await createSavingsGoal(payload);
        toast.success('Goal created — now allocate money to it');
      }
      onSuccess();
      onClose();
    } catch {
      toast.error(goal ? 'Failed to update goal' : 'Failed to create goal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={editing ? 'Edit goal' : 'New Savings Goal'}>
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
        <div>
          <label className="label mb-2 block" htmlFor="goal-name">Goal Name</label>
          <input id="goal-name" type="text" value={name} onChange={e => setName(e.target.value)}
            className="input-dark" placeholder="e.g. Emergency Fund" required />
        </div>

        <div>
          <label className="label mb-2 block" htmlFor="goal-target">Target Amount</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono">$</span>
            <input id="goal-target" type="number" step="0.01" min="0" value={targetAmount}
              onChange={e => setTargetAmount(e.target.value)}
              className="input-dark pl-8" placeholder="10,000.00" required />
          </div>
        </div>

        {!isEmergency && (
          <div>
            <label className="label mb-2 block" htmlFor="goal-deadline">
              Deadline <span className="text-dim">(optional)</span>
            </label>
            <input id="goal-deadline" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="input-dark" />
          </div>
        )}

        <label className="flex items-start gap-3 cursor-pointer min-h-[44px]" htmlFor="goal-emergency">
          <input
            id="goal-emergency"
            type="checkbox"
            checked={isEmergency}
            onChange={e => setIsEmergency(e.target.checked)}
            className="mt-1 w-4 h-4 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium" style={{ color: 'var(--fg)' }}>This is my emergency fund</span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Its money counts as emergency cover. Money for every other goal is left out of available to spend and of cover. It has no deadline: it is measured by the months of spending it covers.
            </span>
          </span>
        </label>

        {!editing && (
          <p className="text-xs text-muted">
            After creating, use <span className="font-semibold" style={{ color: 'var(--accent)' }}>Manage allocation</span> to assign money from your accounts.
          </p>
        )}

        <button type="submit" disabled={loading || !name.trim() || !targetAmount}
          className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {loading ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save goal' : 'Create Goal')}
        </button>
      </form>
    </BottomSheet>
  );
};

export default AddSavingsGoalModal;
