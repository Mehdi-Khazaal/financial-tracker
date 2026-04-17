import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import { spendFromGoal } from '../../utils/api';
import { SavingsGoal, Account } from '../../types';
import { localDateStr } from '../../utils/date';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  goal: SavingsGoal | null;
  accounts: Account[];
}

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SpendFromGoalModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, goal, accounts }) => {
  const toast = useToast();
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(localDateStr());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && goal) {
      setAmount('');
      setDescription('');
      setDate(localDateStr());
      // Auto-select if only one allocation
      if (goal.allocations.length === 1) {
        setAccountId(String(goal.allocations[0].account_id));
      } else {
        setAccountId('');
      }
    }
  }, [isOpen, goal]);

  if (!goal) return null;

  const selectedAlloc = goal.allocations.find(a => String(a.account_id) === accountId);
  const maxAmount = selectedAlloc ? Number(selectedAlloc.amount) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !amount || parseFloat(amount) <= 0) return;
    if (parseFloat(amount) > maxAmount + 0.001) {
      toast.error(`Max you can spend from this allocation is $${fmt(maxAmount)}`);
      return;
    }
    setLoading(true);
    try {
      await spendFromGoal(goal.id, {
        account_id: parseInt(accountId),
        amount: parseFloat(amount),
        description: description || `Spent from ${goal.name}`,
        transaction_date: date,
      });
      onSuccess();
      onClose();
      toast.success('Spending recorded');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to record spending');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={`Spend from "${goal.name}"`}>
      <div className="px-5 pb-6">
        <div className="h-0.5 w-12 rounded-full mb-5 mx-auto" style={{ backgroundColor: '#f43f5e' }} />

        {goal.allocations.length === 0 ? (
          <p className="text-muted text-sm text-center py-8">No funds allocated to this goal yet.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Account picker — only shown when multiple allocations */}
            {goal.allocations.length > 1 && (
              <div>
                <p className="label mb-2">Which account?</p>
                <div className="space-y-2">
                  {goal.allocations.map(alloc => {
                    const acc = accounts.find(a => a.id === alloc.account_id);
                    const selected = String(alloc.account_id) === accountId;
                    return (
                      <button
                        key={alloc.account_id}
                        type="button"
                        onClick={() => setAccountId(String(alloc.account_id))}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all text-left"
                        style={selected
                          ? { backgroundColor: 'rgba(244,63,94,.1)', border: '1px solid rgba(244,63,94,.3)' }
                          : { backgroundColor: '#0d1018', border: '1px solid #1a1f2e' }}>
                        <span className="text-sm font-medium text-text">{alloc.account_name}</span>
                        <span className="font-mono text-sm font-semibold" style={{ color: '#10b981' }}>
                          ${fmt(Number(alloc.amount))} available
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Single allocation info */}
            {goal.allocations.length === 1 && (
              <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{ backgroundColor: '#0d1018', border: '1px solid #1a1f2e' }}>
                <span className="text-sm text-muted">From</span>
                <div className="text-right">
                  <p className="text-sm font-semibold text-text">{goal.allocations[0].account_name}</p>
                  <p className="text-xs text-muted">${fmt(Number(goal.allocations[0].amount))} available</p>
                </div>
              </div>
            )}

            {/* Amount */}
            {accountId && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="label">Amount spent</p>
                    {maxAmount > 0 && (
                      <button type="button" onClick={() => setAmount(String(maxAmount))}
                        className="text-xs font-semibold" style={{ color: '#6366f1' }}>
                        All (${fmt(maxAmount)})
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-muted">$</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={maxAmount}
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      className="input-dark pl-8 font-mono text-lg font-bold"
                      placeholder="0.00"
                      autoFocus
                      required
                    />
                  </div>
                </div>

                <div>
                  <p className="label mb-2">Note</p>
                  <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="input-dark"
                    placeholder={`Spent from ${goal.name}`}
                  />
                </div>

                <div>
                  <p className="label mb-2">Date</p>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-dark" required />
                </div>

                <button
                  type="submit"
                  disabled={loading || !amount || parseFloat(amount || '0') <= 0}
                  className="w-full py-3.5 font-bold text-sm rounded-2xl transition-all active:scale-95 disabled:opacity-40"
                  style={{ backgroundColor: '#f43f5e', color: 'white' }}>
                  {loading ? 'Saving…' : `Record $${parseFloat(amount || '0').toFixed(2)} spend`}
                </button>
              </>
            )}

            {!accountId && goal.allocations.length > 1 && (
              <p className="text-muted text-sm text-center">Select an account above to continue</p>
            )}
          </form>
        )}
      </div>
    </BottomSheet>
  );
};

export default SpendFromGoalModal;
