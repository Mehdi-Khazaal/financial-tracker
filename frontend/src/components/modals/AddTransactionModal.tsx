import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import AmountInput from '../AmountInput';
import { getAccounts, getCategories, createCategory } from '../../utils/api';
import { enqueue } from '../../utils/mutationQueue';
import { Account, Category } from '../../types';
import { localDateStr } from '../../utils/date';
import { useToast } from '../../context/ToastContext';
import { selectableCategories } from './categoryOptions';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultType?: 'income' | 'expense';
}

// const COLORS = ['var(--accent)','#a855f7','var(--pos)','var(--neg)','#f59e0b','var(--muted)','var(--fg)','#ff9f43'];

const AddTransactionModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, defaultType = 'expense' }) => {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<'income' | 'expense'>(defaultType);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(localDateStr());
  const [loading, setLoading] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#f59e0b');
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
    const filtered = selectableCategories(categories, type);
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
    const finalAmount = type === 'expense' ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
    const payload = {
      account_id: parseInt(accountId),
      category_id: categoryId ? parseInt(categoryId) : null,
      amount: finalAmount,
      description: description || null,
      transaction_date: date,
    };

    // Optimistic snapshot rendered in the transaction list until the server
    // confirms. Uses a negative id so it never collides with server ids;
    // pages can filter it out by `id < 0` and add a "syncing" indicator.
    const snapshot = {
      id: -Date.now(),
      user_id: 0,
      ...payload,
      created_at: new Date().toISOString(),
      _pending: true as const,
    };

    try {
      await enqueue({
        kind: 'transaction.create',
        method: 'POST',
        path: '/transactions',
        payload,
        snapshot,
        onSuccess: () => {
          // Server confirmed — pull fresh data so the pending row is replaced
          // by the real one (with the true id, category defaults, etc).
          onSuccess();
        },
        onError: (message) => {
          toast.error(`Save failed: ${message}`);
        },
      });
      // Close immediately; the pending row shows in the list via the queue.
      toast.success(navigator.onLine ? 'Saved' : 'Queued — will sync when back online');
      onClose();
      setAmount(''); setDescription(''); setDate(localDateStr());
    } catch {
      toast.error('Could not queue transaction');
    }
    finally { setLoading(false); }
  };

  const filteredCats = selectableCategories(categories, type);
  const accentColor = type === 'expense' ? 'var(--neg)' : 'var(--pos)';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={type === 'expense' ? 'Record Expense' : 'Record Income'}>
      <div className="px-5 pb-6">
        {accounts.length === 0 ? (
          <p className="text-muted text-sm text-center py-8">Add an account first before recording transactions.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type toggle */}
            <fieldset>
              <legend className="form-label">Transaction type</legend>
              <div className="flex p-1 rounded-lg" style={{ backgroundColor: 'var(--bg)' }}>
              {(['expense', 'income'] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className="min-h-[44px] flex-1 py-2 text-sm font-semibold rounded-lg transition-all"
                  aria-pressed={type === t}
                  style={type === t
                    ? { backgroundColor: t === 'expense' ? 'oklch(70% 0.17 25 / 0.15)' : 'oklch(78% 0.16 150 / 0.15)',
                        color: t === 'expense' ? 'var(--neg)' : 'var(--pos)' }
                    : { backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>
                  {t === 'expense' ? <><svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline mr-1"><path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>Expense</> : <><svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline mr-1"><path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>Income</>}
                </button>
              ))}
              </div>
            </fieldset>

            {/* Amount */}
            <AmountInput id="transaction-amount" value={amount} onChange={setAmount} />

            {/* Account */}
            <div>
              <label className="form-label" htmlFor="transaction-account">Account</label>
              <select id="transaction-account" value={accountId} onChange={e => setAccountId(e.target.value)} className="input-dark">
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} (${Number(a.balance).toFixed(2)})</option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="form-label mb-0">Category</span>
                <button type="button" onClick={() => setShowNewCat(!showNewCat)}
                  className="min-h-[44px] px-2 text-sm font-semibold transition-colors"
                  style={{ color: 'var(--accent)' }}>
                  {showNewCat ? 'Cancel' : '+ New'}
                </button>
              </div>

              {showNewCat ? (
                <div className="p-3 rounded-xl space-y-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)' }}>
                  <label className="form-label" htmlFor="new-category-name">Category name</label>
                  <input id="new-category-name" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                    placeholder="e.g. Dining" className="input-dark text-sm" />
                  <span className="form-label mb-0">Color</span>
                  <div className="flex flex-wrap gap-2">
                    {['#f59e0b','#a855f7','#ff9f43','#38bdf8','#fb7185','#34d399','#a3e635','#e879f9'].map(c => (
                      <button key={c} type="button" onClick={() => setNewCatColor(c)}
                        className="color-swatch"
                        style={{ backgroundColor: c }}
                        aria-label={`Use ${c} for this category`}
                        aria-pressed={newCatColor === c} />
                    ))}
                  </div>
                  <button type="button" onClick={handleAddCat} disabled={addingCat || !newCatName.trim()}
                    className="w-full py-2 text-sm font-semibold rounded-lg disabled:opacity-40 transition-opacity"
                    style={{ backgroundColor: 'var(--accent)', color: 'white' }}>
                    {addingCat ? 'Adding…' : 'Add Category'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setCategoryId('')}
                    className="pill min-h-[44px] transition-all"
                    style={!categoryId ? { backgroundColor: 'var(--line)', color: 'var(--fg)' } : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                    None
                  </button>
                  {filteredCats.map(c => (
                    <button key={c.id} type="button" onClick={() => setCategoryId(String(c.id))}
                      className="pill min-h-[44px] transition-all"
                      aria-pressed={categoryId === String(c.id)}
                      style={categoryId === String(c.id)
                        ? { backgroundColor: c.color + '20', color: c.color, border: `1px solid ${c.color}40` }
                        : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                      {c.name}
                    </button>
                  ))}
                  {filteredCats.length === 0 && <p className="text-xs text-muted">No categories yet — add one above</p>}
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="form-label" htmlFor="transaction-note">Note</label>
              <input id="transaction-note" type="text" value={description} onChange={e => setDescription(e.target.value)}
                className="input-dark" placeholder="What was this for?" />
            </div>

            {/* Date */}
            <div>
              <label className="form-label" htmlFor="transaction-date">Date</label>
              <input id="transaction-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="input-dark" required />
            </div>

            <button type="submit" disabled={loading || !amount}
              className="w-full min-h-[48px] py-3 font-bold text-sm rounded-lg transition-all active:scale-95 disabled:opacity-40"
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
