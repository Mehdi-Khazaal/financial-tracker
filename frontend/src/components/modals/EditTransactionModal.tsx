import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import AmountInput from '../AmountInput';
import { updateTransaction, getAccounts, getCategories } from '../../utils/api';
import { Transaction, Account, Category } from '../../types';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  transaction: Transaction | null;
}

const EditTransactionModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, transaction }) => {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (isOpen && transaction) {
      const isIncome = Number(transaction.amount) > 0;
      setType(isIncome ? 'income' : 'expense');
      setAmount(Math.abs(Number(transaction.amount)).toString());
      setAccountId(String(transaction.account_id));
      setCategoryId(transaction.category_id ? String(transaction.category_id) : '');
      setDescription(transaction.description || '');
      setDate(transaction.transaction_date);
      setTags(transaction.tags ?? []);
      setTagInput('');
      Promise.all([getAccounts(), getCategories()]).then(([aRes, cRes]) => {
        setAccounts(aRes.data);
        setCategories(cRes.data);
      });
    }
  }, [isOpen, transaction]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transaction || !amount || parseFloat(amount) <= 0) return;
    setLoading(true);
    try {
      const finalAmount = type === 'expense' ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
      await updateTransaction(transaction.id, {
        account_id: parseInt(accountId),
        category_id: categoryId ? parseInt(categoryId) : null,
        amount: finalAmount,
        description: description || null,
        transaction_date: date,
        tags: tags.length > 0 ? tags : null,
      });
      onSuccess(); onClose();
    } catch { toast.error('Failed to update transaction'); }
    finally { setLoading(false); }
  };

  const filteredCats = categories.filter(c => c.type === type);
  const accentColor = type === 'expense' ? '#f43f5e' : '#10b981';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Edit Transaction">
      <div className="px-5 pb-6">
        <div className="h-0.5 w-12 rounded-full mb-5 mx-auto" style={{ backgroundColor: accentColor }} />
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type toggle */}
          <div className="flex p-1 rounded-xl" style={{ backgroundColor: '#070810' }}>
            {(['expense', 'income'] as const).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all"
                style={type === t
                  ? { backgroundColor: t === 'expense' ? 'rgba(244,63,94,.15)' : 'rgba(16,185,129,.15)',
                      color: t === 'expense' ? '#f43f5e' : '#10b981' }
                  : { color: '#666e90' }}>
                {t === 'expense' ? <><svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline mr-1"><path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>Expense</> : <><svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline mr-1"><path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>Income</>}
              </button>
            ))}
          </div>

          <AmountInput value={amount} onChange={setAmount} />

          <div>
            <p className="label mb-2">Account</p>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input-dark">
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="label mb-2">Category</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setCategoryId('')}
                className="pill transition-all"
                style={!categoryId ? { backgroundColor: '#1a1f2e', color: '#eef0f8' } : { backgroundColor: '#0d1018', color: '#666e90' }}>
                None
              </button>
              {filteredCats.map(c => (
                <button key={c.id} type="button" onClick={() => setCategoryId(String(c.id))}
                  className="pill transition-all"
                  style={categoryId === String(c.id)
                    ? { backgroundColor: c.color + '20', color: c.color, border: `1px solid ${c.color}40` }
                    : { backgroundColor: '#0d1018', color: '#666e90' }}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label mb-2">Note</p>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              className="input-dark" placeholder="What was this for?" />
          </div>

          {/* Tags */}
          <div>
            <p className="label mb-2">Tags</p>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(99,102,241,.12)', color: '#818cf8' }}>
                    #{tag}
                    <button type="button" onClick={() => setTags(prev => prev.filter(t => t !== tag))}
                      className="opacity-60 hover:opacity-100 ml-0.5">×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  const tag = tagInput.trim().replace(/^#/, '').toLowerCase();
                  if (tag && !tags.includes(tag)) setTags(prev => [...prev, tag]);
                  setTagInput('');
                }
              }}
              className="input-dark text-sm"
              placeholder="Type a tag and press Enter (e.g. vacation)"
            />
          </div>

          <div>
            <p className="label mb-2">Date</p>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-dark" required />
          </div>

          <button type="submit" disabled={loading || !amount}
            className="w-full py-3.5 font-bold text-sm rounded-2xl transition-all active:scale-95 disabled:opacity-40"
            style={{ backgroundColor: accentColor, color: 'white' }}>
            {loading ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    </BottomSheet>
  );
};

export default EditTransactionModal;
