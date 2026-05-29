import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import { updateAccount } from '../../utils/api';
import { Account } from '../../types';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  account: Account | null;
}

const ACCOUNT_TYPES = [
  { value: 'checking',    label: 'Checking' },
  { value: 'savings',     label: 'Savings' },
  { value: 'cash',        label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'investment',  label: 'Investment' },
] as const;

type AccountType = typeof ACCOUNT_TYPES[number]['value'];

const EditAccountModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, account }) => {
  const toast = useToast();
  const [name, setName]               = useState('');
  const [balance, setBalance]         = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [type, setType]               = useState<AccountType>('checking');
  const [loading, setLoading]         = useState(false);

  useEffect(() => {
    if (isOpen && account) {
      setName(account.name);
      setBalance(Math.abs(Number(account.balance)).toString());
      setCreditLimit(account.credit_limit ? String(account.credit_limit) : '');
      setType((account.type as AccountType) ?? 'checking');
    }
  }, [isOpen, account]);

  const isCC = type === 'credit_card';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    setLoading(true);
    try {
      const updates: any = { name: name.trim(), type };
      if (isCC) {
        updates.balance = -Math.abs(parseFloat(balance) || 0);
        if (creditLimit) updates.credit_limit = parseFloat(creditLimit);
        else updates.credit_limit = null;
      } else {
        updates.balance = parseFloat(balance) || 0;
        updates.credit_limit = null;
      }
      await updateAccount(account.id, updates);
      onSuccess(); onClose();
    } catch { toast.error('Failed to update account'); }
    finally { setLoading(false); }
  };

  if (!account) return null;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Edit Account">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">

        {/* Account Type */}
        <div>
          <p className="label mb-2">Account Type</p>
          <div className="grid grid-cols-3 gap-2">
            {ACCOUNT_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className="py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={type === t.value
                  ? { backgroundColor: 'var(--accent)', color: 'white', opacity: 1 }
                  : { backgroundColor: 'var(--elev-sub)', color: 'var(--muted)', border: '1px solid var(--line)' }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {type !== account.type && (
            <p className="text-[11px] mt-2" style={{ color: '#f59e0b' }}>
              ⚠ Changing type affects how this account is counted (e.g. spendable balance)
            </p>
          )}
        </div>

        {/* Name */}
        <div>
          <p className="label mb-2">Account Name</p>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="input-dark" placeholder="Account name" required />
        </div>

        {/* Balance */}
        <div>
          <p className="label mb-2">{isCC ? 'Balance Owed' : 'Balance'}</p>
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
