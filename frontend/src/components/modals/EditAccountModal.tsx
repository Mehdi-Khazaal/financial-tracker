import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import { updateAccount } from '../../utils/api';
import { Account } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  account: Account | null;
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', credit_card: 'Credit Card',
  cash: 'Cash', investment: 'Brokerage',
};

const EditAccountModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, account }) => {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && account) {
      setName(account.name);
      setBalance(Math.abs(Number(account.balance)).toString());
      setCreditLimit(account.credit_limit ? String(account.credit_limit) : '');
    }
  }, [isOpen, account]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    setLoading(true);
    try {
      const updates: any = { name: name.trim() };
      // For credit cards, balance is always negative (owed)
      if (account.type === 'credit_card') {
        updates.balance = -Math.abs(parseFloat(balance) || 0);
        if (creditLimit) updates.credit_limit = parseFloat(creditLimit);
      } else {
        updates.balance = parseFloat(balance) || 0;
      }
      await updateAccount(account.id, updates);
      onSuccess(); onClose();
    } catch { alert('Failed to update account'); }
    finally { setLoading(false); }
  };

  if (!account) return null;
  const isCC = account.type === 'credit_card';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Edit Account">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
        {/* Type badge */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded-full font-medium"
            style={{ backgroundColor: '#1a1f2e', color: '#666e90' }}>
            {ACCOUNT_TYPE_LABELS[account.type] ?? account.type}
          </span>
          <span className="text-xs text-muted">Type cannot be changed</span>
        </div>

        {/* Name */}
        <div>
          <p className="label mb-2">Account Name</p>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="input-dark" placeholder="Account name" required />
        </div>

        {/* Balance */}
        <div>
          <p className="label mb-2">{isCC ? 'Current Balance Owed' : 'Balance'}</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-muted">$</span>
            <input type="number" step="0.01" min="0" value={balance}
              onChange={e => setBalance(e.target.value)}
              className="input-dark pl-8" placeholder="0.00" />
          </div>
          {isCC && <p className="text-xs text-muted mt-1">Enter how much you currently owe</p>}
        </div>

        {/* Credit limit (CC only) */}
        {isCC && (
          <div>
            <p className="label mb-2">Credit Limit</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-muted">$</span>
              <input type="number" step="0.01" min="0" value={creditLimit}
                onChange={e => setCreditLimit(e.target.value)}
                className="input-dark pl-8" placeholder="0.00" />
            </div>
          </div>
        )}

        <button type="submit" disabled={loading || !name.trim()}
          className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {loading ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </BottomSheet>
  );
};

export default EditAccountModal;
