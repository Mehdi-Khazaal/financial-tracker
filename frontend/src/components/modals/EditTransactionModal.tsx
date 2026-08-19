import React, { useState, useEffect } from 'react';
import BottomSheet from '../BottomSheet';
import AmountInput from '../AmountInput';
import { updateTransaction, deleteTransaction, getAccounts, getCategories, cleanDescription } from '../../utils/api';
import { Transaction, Account, Category } from '../../types';
import { useToast } from '../../context/ToastContext';
import { selectableCategories } from './categoryOptions';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  transaction: Transaction | null;
}

const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const EditTransactionModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, transaction }) => {
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && transaction) {
      setMode('view');
      const isIncome = Number(transaction.amount) > 0;
      setType(isIncome ? 'income' : 'expense');
      setAmount(Math.abs(Number(transaction.amount)).toString());
      setAccountId(String(transaction.account_id));
      setCategoryId(transaction.category_id ? String(transaction.category_id) : '');
      setDescription(cleanDescription(transaction.description));
      setDate(transaction.transaction_date);
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
      });
      onSuccess(); onClose();
    } catch { toast.error('Failed to update transaction'); }
    finally { setLoading(false); }
  };

  const handleDeleteTx = async () => {
    if (!transaction) return;
    const ok = await toast.confirm('Delete this transaction?', { danger: true });
    if (!ok) return;
    setLoading(true);
    try { await deleteTransaction(transaction.id); onSuccess(); onClose(); toast.success('Transaction deleted'); }
    catch { toast.error('Failed to delete transaction'); }
    finally { setLoading(false); }
  };

  const filteredCats = selectableCategories(categories, type);
  const accentColor = type === 'expense' ? 'var(--neg)' : 'var(--pos)';

  // ── View mode (no keyboard on open) ──────────────────────────────────────────
  if (mode === 'view' && transaction) {
    const pos = Number(transaction.amount) >= 0;
    const accName = accounts.find(a => a.id === transaction.account_id)?.name ?? '—';
    const cat = categories.find(c => c.id === transaction.category_id);
    const dateStr = new Date(transaction.transaction_date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    const amtStr = `${pos ? '+' : '-'}$${fmt(Math.abs(Number(transaction.amount)))}`;

    const rows = [
      { label: 'Date',     value: dateStr,                         color: undefined      },
      { label: 'Account',  value: accName,                         color: undefined      },
      { label: 'Category', value: cat?.name ?? 'Uncategorized',    color: cat?.color     },
      // Mirrors how the ledger counts it, so this row cannot contradict the
      // "Investment" label the transaction carries everywhere else.
      { label: 'Type',     value: cat?.type === 'investment' ? 'Investment' : pos ? 'Income' : 'Expense',
        color: cat?.type === 'investment' ? 'var(--accent)' : pos ? 'var(--pos)' : 'var(--neg)' },
    ];

    return (
      <BottomSheet isOpen={isOpen} onClose={onClose}>
        <div className="px-5 pb-8 pt-1">
          {/* Close */}
          <div className="flex justify-end pt-2">
            <button onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Amount + description */}
          <div className="text-center pt-3 pb-6">
            <p className="text-4xl font-bold tracking-tight"
              style={{ color: pos ? 'var(--pos)' : 'var(--neg)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {amtStr}
            </p>
            <p className="text-sm font-medium mt-2 truncate px-4" style={{ color: 'var(--fg)' }}>
              {cleanDescription(transaction.description)}
            </p>
          </div>

          {/* Detail rows */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--line)', backgroundColor: 'var(--elev-sub)' }}>
            {rows.map((row, i) => (
              <div key={row.label}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--dim)' }}>{row.label}</p>
                <div className="flex items-center gap-1.5">
                  {row.color && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />}
                  <p className="text-sm font-medium" style={{ color: row.color ?? 'var(--fg)' }}>{row.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleDeleteTx}
              disabled={loading}
              className="flex-1 py-3.5 font-bold text-sm rounded-2xl transition-all active:scale-95 disabled:opacity-40"
              style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>
              {loading ? '…' : 'Delete'}
            </button>
            <button
              onClick={() => setMode('edit')}
              className="flex-1 py-3.5 font-bold text-sm rounded-2xl transition-all active:scale-95"
              style={{ backgroundColor: 'var(--elev-1)', color: 'var(--fg)', border: '1px solid var(--line-strong)' }}>
              Edit
            </button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Edit Transaction">
      <div className="px-5 pb-6">
        <div className="h-0.5 w-12 rounded-full mb-5 mx-auto" style={{ backgroundColor: accentColor }} />
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type toggle */}
          <div className="flex p-1 rounded-xl" style={{ backgroundColor: 'var(--bg)' }}>
            {(['expense', 'income'] as const).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all"
                style={type === t
                  ? { backgroundColor: t === 'expense' ? 'oklch(70% 0.17 25 / 0.15)' : 'oklch(78% 0.16 150 / 0.15)',
                      color: t === 'expense' ? 'var(--neg)' : 'var(--pos)' }
                  : { backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>
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
                style={!categoryId ? { backgroundColor: 'var(--line)', color: 'var(--fg)' } : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                None
              </button>
              {filteredCats.map(c => (
                <button key={c.id} type="button" onClick={() => setCategoryId(String(c.id))}
                  className="pill transition-all"
                  style={categoryId === String(c.id)
                    ? { backgroundColor: c.color + '20', color: c.color, border: `1px solid ${c.color}40` }
                    : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
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
