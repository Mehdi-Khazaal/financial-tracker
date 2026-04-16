import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import AmountInput from '../AmountInput';
import { createTransaction, getAccounts, getCategories, createCategory } from '../../utils/api';
import { Account, Category } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultType?: 'income' | 'expense';
}

const COLORS = ['#6366f1','#a855f7','#10b981','#f43f5e','#f59e0b','#666e90','#eef0f8','#ff9f43'];

const AddTransactionModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, defaultType = 'expense' }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<'income' | 'expense'>(defaultType);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState(COLORS[0]);
  const [addingCat, setAddingCat] = useState(false);

  useEffect(() => { setType(defaultType); }, [defaultType, isOpen]);

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

  const handleAddCat = async () => {
    if (!newCatName.trim()) return;
    setAddingCat(true);
    try {
      const res = await createCategory({ name: newCatName, type, color: newCatColor });
      setCategories(p => [...p, res.data]);
      setCategoryId(String(res.data.id));
      setNewCatName(''); setShowNewCat(false);
    } catch { /* ignore */ }
    finally { setAddingCat(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    setLoading(true);
    try {
      const finalAmount = type === 'expense' ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
      await createTransaction({
        account_id: parseInt(accountId),
        category_id: categoryId ? parseInt(categoryId) : null,
        amount: finalAmount,
        description: description || null,
        transaction_date: date,
      });
      onSuccess(); onClose();
      setAmount(''); setDescription(''); setDate(new Date().toISOString().split('T')[0]);
    } catch { alert('Failed to save transaction'); }
    finally { setLoading(false); }
  };

  const filteredCats = categories.filter(c => c.type === type);
  const accentColor = type === 'expense' ? '#f43f5e' : '#10b981';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={type === 'expense' ? 'Record Expense' : 'Record Income'}>
      <div className="px-5 pb-6">
        {/* Top accent stripe */}
        <div className="h-0.5 w-12 rounded-full mb-5 mx-auto" style={{ backgroundColor: accentColor }} />

        {accounts.length === 0 ? (
          <p className="text-muted text-sm text-center py-8">Add an account first before recording transactions.</p>
        ) : (
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

            {/* Amount */}
            <AmountInput value={amount} onChange={setAmount} />

            {/* Account */}
            <div>
              <p className="label mb-2">Account</p>
              <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input-dark">
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} (${Number(a.balance).toFixed(2)})</option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="label">Category</p>
                <button type="button" onClick={() => setShowNewCat(!showNewCat)}
                  className="text-xs font-semibold transition-colors"
                  style={{ color: '#6366f1' }}>
                  {showNewCat ? 'Cancel' : '+ New'}
                </button>
              </div>

              {showNewCat ? (
                <div className="p-3 rounded-xl space-y-3" style={{ backgroundColor: '#070810', border: '1px solid #1a1f2e' }}>
                  <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                    placeholder="Category name" className="input-dark text-sm" />
                  <div className="flex gap-2">
                    {COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setNewCatColor(c)}
                        className="w-6 h-6 rounded-full border-2 transition-transform"
                        style={{ backgroundColor: c, borderColor: newCatColor === c ? '#eef0f8' : 'transparent',
                          transform: newCatColor === c ? 'scale(1.25)' : 'scale(1)' }} />
                    ))}
                  </div>
                  <button type="button" onClick={handleAddCat} disabled={addingCat || !newCatName.trim()}
                    className="w-full py-2 text-sm font-semibold rounded-lg disabled:opacity-40 transition-opacity"
                    style={{ backgroundColor: '#6366f1', color: 'white' }}>
                    {addingCat ? 'Adding…' : 'Add Category'}
                  </button>
                </div>
              ) : (
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
                  {filteredCats.length === 0 && <p className="text-xs text-muted">No categories yet — add one above</p>}
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <p className="label mb-2">Note</p>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                className="input-dark" placeholder="What was this for?" />
            </div>

            {/* Date */}
            <div>
              <p className="label mb-2">Date</p>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-dark" required />
            </div>

            <button type="submit" disabled={loading || !amount}
              className="w-full py-3.5 font-bold text-sm rounded-2xl transition-all active:scale-95 disabled:opacity-40"
              style={{ backgroundColor: accentColor, color: 'white' }}>
              {loading ? 'Saving…' : `Save ${type === 'expense' ? 'Expense' : 'Income'} · $${parseFloat(amount || '0').toFixed(2)}`}
            </button>
          </form>
        )}
      </div>
    </BottomSheet>
  );
};

export default AddTransactionModal;
