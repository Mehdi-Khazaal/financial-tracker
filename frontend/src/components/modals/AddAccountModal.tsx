import React, { useState } from 'react';
import BottomSheet from '../BottomSheet';
import { createAccount } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

interface Props { isOpen: boolean; onClose: () => void; onSuccess: () => void; }

const TYPES = [
  { value: 'checking',    label: 'Checking',    icon: '🏦', desc: 'Day-to-day spending' },
  { value: 'savings',     label: 'Savings',     icon: '💰', desc: 'Emergency & goals' },
  { value: 'credit_card', label: 'Credit Card', icon: '💳', desc: 'Credit & debt' },
  { value: 'cash',        label: 'Cash',        icon: '💵', desc: 'Physical money' },
  { value: 'investment',  label: 'Brokerage',   icon: '📈', desc: 'Stock account' },
];

const AddAccountModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [balance, setBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [loading, setLoading] = useState(false);

  const isCreditCard = type === 'credit_card';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createAccount({
        name,
        type,
        balance: parseFloat(balance) || 0,
        credit_limit: isCreditCard && creditLimit ? parseFloat(creditLimit) : null,
        currency: 'USD',
      });
      onSuccess(); onClose();
      setName(''); setType('checking'); setBalance(''); setCreditLimit('');
    } catch { toast.error('Failed to create account'); }
    finally { setLoading(false); }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Add Account">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-5">
        {/* Name */}
        <div>
          <p className="label mb-2">Account Name</p>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="input-dark" placeholder="e.g. Chase Checking" required />
        </div>

        {/* Type */}
        <div>
          <p className="label mb-2">Type</p>
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map(t => (
              <button key={t.value} type="button" onClick={() => setType(t.value)}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all"
                style={type === t.value
                  ? { borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.08)' }
                  : { borderColor: '#1a1f2e', backgroundColor: '#0d1018' }}>
                <span className="text-xl">{t.icon}</span>
                <span className="text-xs font-semibold" style={{ color: type === t.value ? '#6366f1' : '#666e90' }}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Balance / Credit limit */}
        <div className={`grid gap-3 ${isCreditCard ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div>
            <p className="label mb-2">{isCreditCard ? 'Current Balance' : 'Balance'}</p>
            <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
              className="input-dark" placeholder={isCreditCard ? '-500.00' : '0.00'} />
          </div>
          {isCreditCard && (
            <div>
              <p className="label mb-2">Credit Limit</p>
              <input type="number" step="0.01" min="0" value={creditLimit} onChange={e => setCreditLimit(e.target.value)}
                className="input-dark" placeholder="5000.00" />
            </div>
          )}
        </div>

        {isCreditCard && (
          <p className="text-xs text-muted">
            💡 Enter current balance as a negative number (e.g. -450) if you owe money.
          </p>
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
