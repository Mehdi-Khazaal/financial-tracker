import React, { useState } from 'react';
import BottomSheet from '../BottomSheet';
import { createLoan } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddLoanModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const toast = useToast();
  const [borrowerName, setBorrowerName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loanDate, setLoanDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!borrowerName.trim() || !amount || parseFloat(amount) <= 0) return;
    setLoading(true);
    try {
      await createLoan({
        borrower_name: borrowerName.trim(),
        amount: parseFloat(amount),
        note: note.trim() || null,
        loan_date: loanDate,
        due_date: dueDate || null,
      });
      onSuccess();
      onClose();
      setBorrowerName('');
      setAmount('');
      setNote('');
      setLoanDate(new Date().toISOString().split('T')[0]);
      setDueDate('');
    } catch { toast.error('Failed to create loan'); }
    finally { setLoading(false); }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="New Loan">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
        <div className="h-0.5 w-12 rounded-full mb-1 mx-auto" style={{ backgroundColor: '#f59e0b' }} />

        {/* Borrower */}
        <div>
          <p className="label mb-2">Borrower's Name</p>
          <input
            type="text"
            value={borrowerName}
            onChange={e => setBorrowerName(e.target.value)}
            className="input-dark"
            placeholder="e.g. John Doe"
            required
          />
        </div>

        {/* Amount */}
        <div>
          <p className="label mb-2">Amount Lent</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-muted">$</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="input-dark pl-8 text-lg font-mono"
              placeholder="0.00"
              required
            />
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="label mb-2">Date Lent</p>
            <input type="date" value={loanDate} onChange={e => setLoanDate(e.target.value)}
              className="input-dark" required />
          </div>
          <div>
            <p className="label mb-2">Expected Back <span className="text-dim">(optional)</span></p>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="input-dark" />
          </div>
        </div>

        {/* Note */}
        <div>
          <p className="label mb-2">Note <span className="text-dim">(optional)</span></p>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="input-dark"
            placeholder="e.g. For rent, dinner, etc."
          />
        </div>

        <button
          type="submit"
          disabled={loading || !borrowerName.trim() || !amount}
          className="w-full py-3.5 font-bold text-sm rounded-2xl transition-all active:scale-95 disabled:opacity-40"
          style={{ backgroundColor: '#f59e0b', color: 'white' }}>
          {loading ? 'Saving…' : `Record Loan${amount ? ` · $${parseFloat(amount || '0').toFixed(2)}` : ''}`}
        </button>
      </form>
    </BottomSheet>
  );
};

export default AddLoanModal;
