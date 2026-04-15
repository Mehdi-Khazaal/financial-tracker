import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import { createSavingsGoal, getAccounts } from '../../utils/api';
import { Account } from '../../types';

interface Props { isOpen: boolean; onClose: () => void; onSuccess: () => void; }

const AddSavingsGoalModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getAccounts().then(res => {
        const savings = res.data.filter((a: Account) => a.type === 'savings');
        setAccounts(savings);
        if (savings.length > 0) setAccountId(String(savings[0].id));
      });
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createSavingsGoal({
        name,
        target_amount: parseFloat(targetAmount),
        account_id: accountId ? parseInt(accountId) : null,
        deadline: deadline || null,
      });
      onSuccess(); onClose();
      setName(''); setTargetAmount(''); setDeadline('');
    } catch { alert('Failed to create goal'); }
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
          <p className="label mb-2">Linked Savings Account <span className="text-dim">(optional)</span></p>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input-dark">
            <option value="">No linked account</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (${Number(a.balance).toFixed(2)})</option>)}
          </select>
          {accounts.length === 0 && (
            <p className="text-xs text-muted mt-1">Create a savings account to link it to this goal.</p>
          )}
        </div>

        <div>
          <p className="label mb-2">Deadline <span className="text-dim">(optional)</span></p>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="input-dark" />
        </div>

        <button type="submit" disabled={loading || !name.trim() || !targetAmount}
          className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {loading ? 'Creating…' : 'Create Goal'}
        </button>
      </form>
    </BottomSheet>
  );
};

export default AddSavingsGoalModal;
