import React, { useState } from 'react';
import BottomSheet from '../BottomSheet';
import { createSavingsGoal } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

interface Props { isOpen: boolean; onClose: () => void; onSuccess: () => void; }

const AddSavingsGoalModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const toast = useToast();
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createSavingsGoal({
        name,
        target_amount: parseFloat(targetAmount),
        deadline: deadline || null,
      });
      onSuccess();
      onClose();
      setName(''); setTargetAmount(''); setDeadline('');
      toast.success('Goal created — now allocate money to it');
    } catch { toast.error('Failed to create goal'); }
    finally { setLoading(false); }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="New Savings Goal">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
        <div>
          <p className="label mb-2">Goal Name</p>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="input-dark" placeholder="e.g. Emergency Fund" required />
        </div>

        <div>
          <p className="label mb-2">Target Amount</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono">$</span>
            <input type="number" step="0.01" min="0" value={targetAmount}
              onChange={e => setTargetAmount(e.target.value)}
              className="input-dark pl-8" placeholder="10,000.00" required />
          </div>
        </div>

        <div>
          <p className="label mb-2">Deadline <span className="text-dim">(optional)</span></p>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="input-dark" />
        </div>

        <p className="text-xs text-muted">
          After creating, use the <span className="font-semibold" style={{ color: '#6366f1' }}>Allocate</span> button to assign money from your accounts.
        </p>

        <button type="submit" disabled={loading || !name.trim() || !targetAmount}
          className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {loading ? 'Creating…' : 'Create Goal'}
        </button>
      </form>
    </BottomSheet>
  );
};

export default AddSavingsGoalModal;
