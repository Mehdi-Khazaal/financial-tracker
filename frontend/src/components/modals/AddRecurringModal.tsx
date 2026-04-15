import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import { createRecurring, getAccounts, getCategories } from '../../utils/api';
import { Account, Category, RecurringPeriod } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PERIODS: { value: RecurringPeriod; label: string }[] = [
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Biweekly' },
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly',    label: 'Yearly' },
];

const AddRecurringModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [period, setPeriod] = useState<RecurringPeriod>('monthly');
  const [nextDate, setNextDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      Promise.all([getAccounts(), getCategories()]).then(([aRes, cRes]) => {
        setAccounts(aRes.data);
        setCategories(cRes.data);
        if (aRes.data.length > 0) setAccountId(String(aRes.data[0].id));
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const filtered = categories.filter(c => c.type === type);
    setCategoryId(filtered.length ? String(filtered[0].id) : '');
  }, [type, categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    setLoading(true);
    try {
      const finalAmount = type === 'expense' ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
      await createRecurring({
        account_id: parseInt(accountId),
        category_id: categoryId ? parseInt(categoryId) : null,
        amount: finalAmount,
        description: description || null,
        period,
        next_date: nextDate,
      });
      onSuccess(); onClose();
      setAmount(''); setDescription('');
      setNextDate(new Date().toISOString().split('T')[0]);
    } catch { alert('Failed to create recurring transaction'); }
    finally { setLoading(false); }
  };

  const filteredCats = categories.filter(c => c.type === type);
  const accentColor = type === 'expense' ? '#ff5f6d' : '#2ecc8a';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="New Recurring">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
        {/* Type toggle */}
        <div className="flex p-1 rounded-xl" style={{ backgroundColor: '#0b0d12' }}>
          {(['expense', 'income'] as const).map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all"
              style={type === t
                ? { backgroundColor: t === 'expense' ? 'rgba(255,95,109,.15)' : 'rgba(46,204,138,.15)',
                    color: t === 'expense' ? '#ff5f6d' : '#2ecc8a' }
                : { color: '#7880a0' }}>
              {t === 'expense' ? '↓ Expense' : '↑ Income'}
            </button>
          ))}
        </div>

        {/* Amount */}
        <div>
          <p className="label mb-2">Amount</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-muted">$</span>
            <input type="number" step="0.01" min="0" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="input-dark pl-8 text-lg font-mono" placeholder="0.00" required />
          </div>
        </div>

        {/* Period */}
        <div>
          <p className="label mb-2">Frequency</p>
          <div className="flex flex-wrap gap-2">
            {PERIODS.map(p => (
              <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
                className="pill transition-all"
                style={period === p.value
                  ? { backgroundColor: 'rgba(91,143,255,.15)', color: '#5b8fff', border: '1px solid rgba(91,143,255,.3)' }
                  : { backgroundColor: '#11141c', color: '#7880a0' }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Account */}
        <div>
          <p className="label mb-2">Account</p>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input-dark">
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {/* Category */}
        <div>
          <p className="label mb-2">Category</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCategoryId('')}
              className="pill transition-all"
              style={!categoryId ? { backgroundColor: '#252a3a', color: '#e8eaf2' } : { backgroundColor: '#11141c', color: '#7880a0' }}>
              None
            </button>
            {filteredCats.map(c => (
              <button key={c.id} type="button" onClick={() => setCategoryId(String(c.id))}
                className="pill transition-all"
                style={categoryId === String(c.id)
                  ? { backgroundColor: c.color + '20', color: c.color, border: `1px solid ${c.color}40` }
                  : { backgroundColor: '#11141c', color: '#7880a0' }}>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <p className="label mb-2">Description</p>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)}
            className="input-dark" placeholder="e.g. Rent, Salary, Netflix…" />
        </div>

        {/* Next date */}
        <div>
          <p className="label mb-2">First / Next Date</p>
          <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)}
            className="input-dark" required />
        </div>

        <button type="submit" disabled={loading || !amount || !accountId}
          className="w-full py-3.5 font-bold text-sm rounded-2xl transition-all active:scale-95 disabled:opacity-40"
          style={{ backgroundColor: accentColor, color: 'white' }}>
          {loading ? 'Saving…' : `Create Recurring · $${parseFloat(amount || '0').toFixed(2)}`}
        </button>
      </form>
    </BottomSheet>
  );
};

export default AddRecurringModal;
