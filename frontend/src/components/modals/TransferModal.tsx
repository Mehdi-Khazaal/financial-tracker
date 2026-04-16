import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import AmountInput from '../AmountInput';
import { createTransfer, getAccounts } from '../../utils/api';
import { Account } from '../../types';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedFromId?: number;   // e.g. for "Pay Card" flow
  preselectedToId?: number;
}

const TransferModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, preselectedFromId, preselectedToId }) => {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getAccounts().then(res => {
        setAccounts(res.data);
        if (!preselectedFromId && res.data.length > 0) setFromId(String(res.data[0].id));
        if (!preselectedToId && res.data.length > 1) setToId(String(res.data[1].id));
      });
      if (preselectedFromId) setFromId(String(preselectedFromId));
      if (preselectedToId)   setToId(String(preselectedToId));
    }
  }, [isOpen, preselectedFromId, preselectedToId]);

  const fromAccount = accounts.find(a => a.id === parseInt(fromId));
  const toAccount   = accounts.find(a => a.id === parseInt(toId));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    if (fromId === toId) { toast.error('Cannot transfer to the same account'); return; }
    setLoading(true);
    try {
      await createTransfer({
        from_account_id: parseInt(fromId),
        to_account_id:   parseInt(toId),
        amount: parseFloat(amount),
        note: note || null,
        transfer_date: new Date().toISOString().split('T')[0],
      });
      onSuccess(); onClose();
      setAmount(''); setNote('');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Transfer failed');
    } finally { setLoading(false); }
  };

  const isPayCard = toAccount?.type === 'credit_card';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={isPayCard ? 'Pay Credit Card' : 'Transfer Money'}>
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
        <AmountInput value={amount} onChange={setAmount} />

        {/* From */}
        <div>
          <p className="label mb-2">From Account</p>
          <select value={fromId} onChange={e => setFromId(e.target.value)} className="input-dark">
            {accounts.filter(a => String(a.id) !== toId).map(a => (
              <option key={a.id} value={a.id}>
                {a.name} (${Number(a.balance).toFixed(2)})
              </option>
            ))}
          </select>
        </div>

        {/* To */}
        <div>
          <p className="label mb-2">To Account</p>
          <select value={toId} onChange={e => setToId(e.target.value)} className="input-dark">
            {accounts.filter(a => String(a.id) !== fromId).map(a => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type === 'credit_card' ? `Owes $${Math.abs(Number(a.balance)).toFixed(2)}` : `$${Number(a.balance).toFixed(2)}`})
              </option>
            ))}
          </select>
        </div>

        {/* Flow summary */}
        {fromAccount && toAccount && amount && parseFloat(amount) > 0 && (
          <div className="rounded-xl p-3 text-sm text-center" style={{ backgroundColor: '#070810', border: '1px solid #1a1f2e' }}>
            <span className="text-muted">{fromAccount.name}</span>
            <span className="mx-2 font-bold" style={{ color: '#6366f1' }}>→</span>
            <span className="text-muted">{toAccount.name}</span>
            <p className="text-text font-mono font-bold mt-1">${parseFloat(amount).toFixed(2)}</p>
          </div>
        )}

        <div>
          <p className="label mb-2">Note <span className="text-dim">(optional)</span></p>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            className="input-dark" placeholder={isPayCard ? 'Card payment' : 'Transfer note'} />
        </div>

        <button type="submit" disabled={loading || !amount || fromId === toId}
          className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {loading ? 'Processing…' : isPayCard ? 'Pay Card' : 'Transfer'}
        </button>
      </form>
    </BottomSheet>
  );
};

export default TransferModal;
