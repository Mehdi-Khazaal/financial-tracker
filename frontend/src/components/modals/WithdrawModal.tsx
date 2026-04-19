import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import AmountInput from '../AmountInput';
import { createTransfer, getAccounts } from '../../utils/api';
import { Account } from '../../types';
import { localDateStr } from '../../utils/date';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const WithdrawModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const toast = useToast();
  const [bankAccounts, setBankAccounts] = useState<Account[]>([]);
  const [cashAccounts, setCashAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getAccounts().then(res => {
        const all: Account[] = res.data;
        const banks = all.filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'investment');
        const cash  = all.filter(a => a.type === 'cash');
        setBankAccounts(banks);
        setCashAccounts(cash);
        if (banks.length > 0) setFromId(String(banks[0].id));
        if (cash.length  > 0) setToId(String(cash[0].id));
      });
    }
  }, [isOpen]);

  const fromAccount = bankAccounts.find(a => a.id === parseInt(fromId));
  const toAccount   = cashAccounts.find(a => a.id === parseInt(toId));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    if (!fromId || !toId) return;
    setLoading(true);
    try {
      await createTransfer({
        from_account_id: parseInt(fromId),
        to_account_id:   parseInt(toId),
        amount: parseFloat(amount),
        note: note.trim() || 'Cash withdrawal',
        transfer_date: localDateStr(),
      });
      toast.success(`$${parseFloat(amount).toFixed(2)} withdrawn to ${toAccount?.name ?? 'cash'}`);
      onSuccess();
      onClose();
      setAmount('');
      setNote('');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Withdrawal failed');
    } finally {
      setLoading(false);
    }
  };

  const noCash = cashAccounts.length === 0;
  const noBank = bankAccounts.length === 0;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Withdraw Cash">
      <div className="px-5 pb-6">
        {/* Header accent */}
        <div className="h-0.5 w-12 rounded-full mb-5 mx-auto" style={{ backgroundColor: '#f59e0b' }} />

        {noCash || noBank ? (
          <div className="py-8 text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto"
              style={{ backgroundColor: 'rgba(245,158,11,.1)' }}>
              <svg viewBox="0 0 20 20" fill="#f59e0b" className="w-6 h-6">
                <path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
            </div>
            <p className="font-semibold text-text">
              {noCash ? 'No cash account found' : 'No bank account found'}
            </p>
            <p className="text-sm text-muted">
              {noCash
                ? 'Add a Cash account in Wallet first so withdrawn money has somewhere to go.'
                : 'Add a Checking or Savings account to withdraw from.'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Amount */}
            <AmountInput value={amount} onChange={setAmount} />

            {/* From (bank) */}
            <div>
              <p className="label mb-2">From Bank Account</p>
              <select value={fromId} onChange={e => setFromId(e.target.value)} className="input-dark">
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} · ${Number(a.balance).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            {/* To (cash) */}
            <div>
              <p className="label mb-2">To Cash Account</p>
              <select value={toId} onChange={e => setToId(e.target.value)} className="input-dark">
                {cashAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} · ${Number(a.balance).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            {/* Flow summary */}
            {fromAccount && toAccount && amount && parseFloat(amount) > 0 && (
              <div className="rounded-2xl p-3 text-center" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)' }}>
                <div className="flex items-center justify-center gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">Bank</p>
                    <p className="font-semibold text-text">{fromAccount.name}</p>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <svg viewBox="0 0 20 20" fill="#f59e0b" className="w-5 h-5">
                      <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    <p className="font-mono font-bold text-sm" style={{ color: '#f59e0b' }}>
                      ${parseFloat(amount).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">Cash</p>
                    <p className="font-semibold text-text">{toAccount.name}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Note */}
            <div>
              <p className="label mb-2">Note <span className="text-dim">(optional)</span></p>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                className="input-dark"
                placeholder="e.g. ATM withdrawal"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !amount || parseFloat(amount) <= 0}
              className="w-full py-3.5 font-bold text-sm rounded-2xl transition-all active:scale-95 disabled:opacity-40"
              style={{ backgroundColor: '#f59e0b', color: 'white' }}>
              {loading ? 'Processing…' : `Withdraw${amount ? ` · $${parseFloat(amount || '0').toFixed(2)}` : ''}`}
            </button>
          </form>
        )}
      </div>
    </BottomSheet>
  );
};

export default WithdrawModal;
