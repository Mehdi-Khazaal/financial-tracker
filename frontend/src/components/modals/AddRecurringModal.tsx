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
  const [isVariable, setIsVariable] = useState(false);
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
        is_variable: isVariable,
      });
      onSuccess(); onClose();
      setAmount(''); setDescription(''); setIsVariable(false);
      setNextDate(new Date().toISOString().split('T')[0]);
    } catch { alert('Failed to create recurring transaction'); }
    finally { setLoading(false); }
  };

  const filteredCats = categories.filter(c => c.type === type);
  const accentColor = type === 'expense' ? '#f43f5e' : '#10b981';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="New Recurring">
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
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

        {/* Amount */}
        <div>
          <p className="label mb-2">
            {isVariable ? 'Estimated Amount' : 'Amount'}
            {isVariable && <span className="text-muted font-normal ml-1">(used as hint next time)</span>}
          </p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-muted">$</span>
            <input type="number" step="0.01" min="0" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="input-dark pl-8 text-lg font-mono"
              placeholder={isVariable ? 'e.g. last bill amount' : '0.00'}
              required />
          </div>
        </div>

        {/* Variable amount toggle */}
        <button
          type="button"
          onClick={() => setIsVariable(v => !v)}
          className="flex items-center justify-between w-full px-4 py-3 rounded-xl transition-all"
          style={{
            backgroundColor: isVariable ? 'rgba(245,158,11,.08)' : '#0d1018',
            border: `1px solid ${isVariable ? 'rgba(245,158,11,.3)' : '#1a1f2e'}`,
          }}>
          <div className="text-left">
            <p className="text-sm font-semibold" style={{ color: isVariable ? '#f59e0b' : '#eef0f8' }}>
              Variable amount
            </p>
            <p className="text-xs text-muted mt-0.5">
              {isVariable ? 'You\'ll enter the real amount each time it\'s due (e.g. bills)' : 'Fixed amount every time (e.g. subscriptions)'}
            </p>
          </div>
          <div className="w-10 h-6 rounded-full transition-all relative ml-3 shrink-0"
            style={{ backgroundColor: isVariable ? '#f59e0b' : '#1a1f2e' }}>
            <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all"
              style={{ left: isVariable ? '22px' : '4px' }} />
          </div>
        </button>

        {/* Period */}
        <div>
          <p className="label mb-2">Frequency</p>
          <div className="flex flex-wrap gap-2">
            {PERIODS.map(p => (
              <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
                className="pill transition-all"
                style={period === p.value
                  ? { backgroundColor: 'rgba(99,102,241,.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,.3)' }
                  : { backgroundColor: '#0d1018', color: '#666e90' }}>
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
