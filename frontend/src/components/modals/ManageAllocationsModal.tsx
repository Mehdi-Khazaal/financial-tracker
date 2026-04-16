import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import { setGoalAllocations } from '../../utils/api';
import { SavingsGoal, Account } from '../../types';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  goal: SavingsGoal | null;
  allGoals: SavingsGoal[];
  accounts: Account[];
}

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_COLORS: Record<string, string> = {
  checking: '#6366f1', savings: '#10b981', cash: '#f59e0b',
  investment: '#a855f7', credit_card: '#f43f5e',
};

const ManageAllocationsModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, goal, allGoals, accounts }) => {
  const toast = useToast();
  // inputs: account_id -> string amount
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && goal) {
      const init: Record<number, string> = {};
      goal.allocations.forEach(a => {
        init[a.account_id] = String(a.amount);
      });
      setInputs(init);
    }
  }, [isOpen, goal]);

  if (!goal) return null;

  // For each account, how much is locked by OTHER goals
  const getUsedByOthers = (accountId: number): number => {
    let used = 0;
    allGoals.forEach(g => {
      if (g.id === goal.id) return;
      g.allocations.forEach(a => {
        if (a.account_id === accountId) used += Number(a.amount);
      });
    });
    return used;
  };

  const getAvailable = (account: Account): number => {
    const usedByOthers = getUsedByOthers(account.id);
    return Math.max(0, Number(account.balance) - usedByOthers);
  };

  const totalAllocated = Object.values(inputs).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const progress = Math.min((totalAllocated / Number(goal.target_amount)) * 100, 100);
  const remaining = Math.max(Number(goal.target_amount) - totalAllocated, 0);

  // Spendable accounts only (exclude credit cards since they have negative balances)
  const eligibleAccounts = accounts
    .filter(a => (a.type !== 'credit_card' && Number(a.balance) > 0) || (inputs[a.id] && parseFloat(inputs[a.id]) > 0))
    .sort((a, b) => Number(b.balance) - Number(a.balance));

  const handleChange = (accountId: number, value: string) => {
    // Strip non-numeric except decimal point
    const cleaned = value.replace(/[^0-9.]/g, '');
    setInputs(prev => ({ ...prev, [accountId]: cleaned }));
  };

  const handleMax = (account: Account) => {
    const available = getAvailable(account);
    const stillNeeded = Math.max(Number(goal.target_amount) - totalAllocated + (parseFloat(inputs[account.id] || '0')), 0);
    const max = Math.min(available, stillNeeded);
    setInputs(prev => ({ ...prev, [account.id]: max.toFixed(2) }));
  };

  const handleClear = (accountId: number) => {
    setInputs(prev => ({ ...prev, [accountId]: '' }));
  };

  const handleSave = async () => {
    // Validate
    for (const account of eligibleAccounts) {
      const val = parseFloat(inputs[account.id] || '0') || 0;
      if (val <= 0) continue;
      const available = getAvailable(account);
      if (val > available + 0.001) {
        toast.error(`Only $${fmt(available)} available in "${account.name}"`);
        return;
      }
    }

    setLoading(true);
    try {
      const allocations = eligibleAccounts
        .map(a => ({ account_id: a.id, amount: parseFloat(inputs[a.id] || '0') || 0 }))
        .filter(a => a.amount > 0);

      await setGoalAllocations(goal.id, allocations);
      toast.success('Allocations saved');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to save allocations');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={`Allocate to "${goal.name}"`}>
      <div className="px-5 pb-6 space-y-4">

        {/* Goal summary */}
        <div className="rounded-2xl p-4" style={{ backgroundColor: '#0d1018', border: '1px solid #1a1f2e' }}>
          <div className="flex justify-between text-xs mb-2">
            <span className="text-muted">Allocated</span>
            <span className="font-mono font-semibold text-text">${fmt(totalAllocated)} / ${fmt(Number(goal.target_amount))}</span>
          </div>
          {/* Progress bar */}
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1f2e' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                backgroundColor: progress >= 100 ? '#10b981' : '#6366f1',
              }} />
          </div>
          <div className="flex justify-between text-xs mt-1.5">
            <span style={{ color: progress >= 100 ? '#10b981' : '#6366f1' }}>{progress.toFixed(0)}%</span>
            {remaining > 0 && <span className="text-muted">${fmt(remaining)} remaining</span>}
            {progress >= 100 && <span style={{ color: '#10b981' }}>Goal reached!</span>}
          </div>
        </div>

        {/* Account list */}
        {eligibleAccounts.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted">
            No accounts with positive balance found.
          </div>
        ) : (
          <div className="space-y-3">
            {eligibleAccounts.map(account => {
              const available = getAvailable(account);
              const usedByOthers = getUsedByOthers(account.id);
              const inputVal = inputs[account.id] || '';
              const numVal = parseFloat(inputVal) || 0;
              const isOver = numVal > available + 0.001;
              const color = TYPE_COLORS[account.type] ?? '#6366f1';

              return (
                <div key={account.id} className="rounded-2xl p-4" style={{ backgroundColor: '#0d1018', border: `1px solid ${isOver ? 'rgba(244,63,94,.4)' : '#1a1f2e'}` }}>
                  {/* Account header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-sm font-semibold text-text">{account.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full capitalize"
                        style={{ backgroundColor: color + '20', color }}>
                        {account.type.replace('_', ' ')}
                      </span>
                    </div>
                    <span className="font-mono text-sm font-bold text-text">${fmt(Number(account.balance))}</span>
                  </div>

                  {/* Balance breakdown */}
                  <div className="flex gap-4 mb-3 text-xs">
                    {usedByOthers > 0 && (
                      <div>
                        <p className="text-muted mb-0.5">Other goals</p>
                        <p className="font-mono font-semibold" style={{ color: '#f43f5e' }}>-${fmt(usedByOthers)}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-muted mb-0.5">Available</p>
                      <p className="font-mono font-semibold" style={{ color: available > 0 ? '#10b981' : '#666e90' }}>${fmt(available)}</p>
                    </div>
                  </div>

                  {/* Input row */}
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted text-xs">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={available}
                        value={inputVal}
                        onChange={e => handleChange(account.id, e.target.value)}
                        className="input-dark pl-7 text-sm py-2"
                        placeholder="0.00"
                        style={isOver ? { borderColor: 'rgba(244,63,94,.5)' } : {}}
                      />
                    </div>
                    {available > 0 && (
                      <button
                        type="button"
                        onClick={() => handleMax(account)}
                        className="px-3 py-2 text-xs font-semibold rounded-xl transition-all"
                        style={{ backgroundColor: color + '15', color }}>
                        Max
                      </button>
                    )}
                    {numVal > 0 && (
                      <button
                        type="button"
                        onClick={() => handleClear(account.id)}
                        className="px-3 py-2 text-xs font-semibold rounded-xl transition-all"
                        style={{ backgroundColor: 'rgba(244,63,94,.1)', color: '#f43f5e' }}>
                        Clear
                      </button>
                    )}
                  </div>

                  {isOver && (
                    <p className="text-xs mt-1.5" style={{ color: '#f43f5e' }}>
                      Exceeds available balance by ${fmt(numVal - available)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={loading || eligibleAccounts.some(a => (parseFloat(inputs[a.id] || '0') || 0) > getAvailable(a) + 0.001)}
          className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {loading ? 'Saving…' : 'Save Allocations'}
        </button>
      </div>
    </BottomSheet>
  );
};

export default ManageAllocationsModal;
