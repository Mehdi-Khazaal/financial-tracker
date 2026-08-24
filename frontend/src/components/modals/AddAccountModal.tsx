import React, { useState } from 'react';
import BottomSheet from '../BottomSheet';
import { createAccount } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { AccountTypeIcon } from '../dashboard/DashboardPrimitives';

interface Props { isOpen: boolean; onClose: () => void; onSuccess: () => void; }

const TYPES = [
  { value: 'checking',    label: 'Checking',    desc: 'Day-to-day spending' },
  { value: 'savings',     label: 'Savings',     desc: 'Emergency and goals' },
  { value: 'credit_card', label: 'Credit Card', desc: 'Credit and debt' },
  { value: 'cash',        label: 'Cash',        desc: 'Physical money' },
  { value: 'investment',  label: 'Brokerage',   desc: 'Investment account' },
];

const AddAccountModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [balance, setBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [inCredit, setInCredit] = useState(false);
  const [loading, setLoading] = useState(false);

  const isCreditCard = type === 'credit_card';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // A card is entered as a plain amount plus which side of zero it sits
      // on, matching Edit Account. This form used to ask for the raw stored
      // value — "enter -450 when you owe money" — which put the database's
      // sign convention in front of the user and disagreed with the other
      // dialog for the same field.
      const typed = parseFloat(balance) || 0;
      const cardBalance = inCredit ? Math.abs(typed) : -Math.abs(typed);

      await createAccount({
        name,
        type,
        balance: isCreditCard ? cardBalance : typed,
        credit_limit: isCreditCard && creditLimit ? parseFloat(creditLimit) : null,
        currency: 'USD',
      });
      onSuccess(); onClose();
      setName(''); setType('checking'); setBalance(''); setCreditLimit(''); setInCredit(false);
    } catch { toast.error('Failed to create account'); }
    finally { setLoading(false); }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Add Account">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-5">
        {/* Name */}
        <div>
          <label className="form-label" htmlFor="account-name">Account name</label>
          <input id="account-name" type="text" value={name} onChange={e => setName(e.target.value)}
            autoComplete="off"
            className="input-dark" placeholder="e.g. Chase Checking" required />
        </div>

        {/* Type */}
        <fieldset>
          <legend className="form-label">Account type</legend>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TYPES.map(t => (
              <button key={t.value} type="button" onClick={() => setType(t.value)}
                className="min-h-[88px] flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border text-center transition-all"
                aria-pressed={type === t.value}
                aria-label={`${t.label}: ${t.desc}`}
                style={type === t.value
                  ? { borderColor: 'var(--accent)', backgroundColor: 'oklch(72% 0.17 55 / 0.08)' }
                  : { borderColor: 'var(--line)', backgroundColor: 'var(--elev-1)' }}>
                <AccountTypeIcon type={t.value} className="w-8 h-8" iconClassName="w-4 h-4" />
                <span className="text-xs font-semibold" style={{ color: type === t.value ? 'var(--accent)' : 'var(--muted)' }}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* Balance / Credit limit */}
        <div className={`grid gap-3 ${isCreditCard ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div>
            <label className="form-label" htmlFor="account-balance">
              {isCreditCard ? (inCredit ? 'Credit balance' : 'Balance owed') : 'Balance'}
            </label>
            <input id="account-balance" type="number" inputMode="decimal" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
              className="input-dark" placeholder={isCreditCard ? '500.00' : '0.00'} />
          </div>
          {isCreditCard && (
            <div>
              <label className="form-label" htmlFor="account-credit-limit">Credit limit</label>
              <input id="account-credit-limit" type="number" inputMode="decimal" step="0.01" min="0" value={creditLimit} onChange={e => setCreditLimit(e.target.value)}
                className="input-dark" placeholder="5000.00" />
            </div>
          )}
        </div>

        {isCreditCard && (
          <>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={inCredit}
                onChange={e => setInCredit(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-xs text-muted">I overpaid — my card is in credit</span>
            </label>
            <p className="text-xs text-muted">
              {inCredit
                ? 'How much your card issuer owes you.'
                : 'How much you currently owe. No minus sign needed.'}
            </p>
          </>
        )}

        <button type="submit" disabled={loading || !name.trim()}
          className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {loading ? 'Creating…' : 'Create Account'}
        </button>
      </form>
    </BottomSheet>
  );
};

export default AddAccountModal;
