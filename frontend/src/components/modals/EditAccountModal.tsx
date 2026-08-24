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
  const [inCredit, setInCredit]       = useState(false);
  const [loading, setLoading]         = useState(false);

  /**
   * A card can sit on either side of zero.
   *
   * Usually you owe the issuer, which Fintrack stores as a negative balance
   * and this form asks for as a plain positive "balance owed". But overpay a
   * card and the issuer owes *you* — a positive stored balance. This form used
   * to load with `Math.abs` and save with `-Math.abs`, so opening an overpaid
   * card and pressing Save — even after only renaming it — silently converted
   * a credit into a debt of the same size.
   *
   * The amount is still entered as a positive number, because that is how
   * people say it; which side of zero it belongs on is a separate, explicit
   * choice that round-trips.
   */
  useEffect(() => {
    if (isOpen && account) {
      const stored = Number(account.balance);
      setName(account.name);
      setBalance(Math.abs(stored).toString());
      setInCredit(account.type === 'credit_card' && stored > 0);
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
        const amount = Math.abs(parseFloat(balance) || 0);
        // Positive means the issuer owes the holder; negative means the usual
        // debt. See the note beside the loader.
        updates.balance = inCredit ? amount : -amount;
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
          <p className="label mb-2">
            {isCC ? (inCredit ? 'Credit Balance' : 'Balance Owed') : 'Balance'}
          </p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-muted">$</span>
            <input type="number" step="0.01" min="0" value={balance}
              onChange={e => setBalance(e.target.value)}
              className="input-dark pl-8" placeholder="0.00" />
          </div>
          {isCC && (
            <>
              <p className="text-xs text-muted mt-1">
                {inCredit
                  ? 'How much your card issuer owes you'
                  : 'How much you currently owe'}
              </p>
              {/* Shown for every card, not only ones already in credit, so a
                  card that has just been overpaid can be recorded as such. */}
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inCredit}
                  onChange={e => setInCredit(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-xs text-muted">
                  I overpaid — my card is in credit
                </span>
              </label>
            </>
          )}
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
