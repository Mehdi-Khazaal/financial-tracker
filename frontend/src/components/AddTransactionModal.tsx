import React, { useState, useEffect } from 'react';
import { createTransaction, getAccounts, getCategories, createCategory } from '../utils/api';
import { Account, Category } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORY_COLORS = [
  '#B12B24', '#F9B672', '#BBD151', '#1F422C', '#050725', '#84848A', '#6366f1', '#0ea5e9',
];

const AddTransactionModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [description, setDescription] = useState('');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  // Inline category creation
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');
  const [addingCat, setAddingCat] = useState(false);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen]);

  const loadData = async () => {
    try {
      const [accRes, catRes] = await Promise.all([getAccounts(), getCategories()]);
      setAccounts(accRes.data);
      setCategories(catRes.data);
      if (accRes.data.length > 0) setAccountId(accRes.data[0].id.toString());
      const filtered = catRes.data.filter((c: Category) => c.type === type);
      if (filtered.length > 0) setCategoryId(filtered[0].id.toString());
    } catch {
      // ignore
    }
  };

  // When type changes, reset category to first of that type
  useEffect(() => {
    const filtered = categories.filter((c) => c.type === type);
    setCategoryId(filtered.length > 0 ? filtered[0].id.toString() : '');
  }, [type, categories]);

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    setAddingCat(true);
    try {
      const res = await createCategory({ name: newCatName, type, color: newCatColor });
      const newCat: Category = res.data;
      setCategories((prev) => [...prev, newCat]);
      setCategoryId(newCat.id.toString());
      setNewCatName('');
      setShowNewCategory(false);
    } catch {
      alert('Failed to create category');
    } finally {
      setAddingCat(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const finalAmount = type === 'expense' ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
      await createTransaction({
        account_id: parseInt(accountId),
        category_id: categoryId ? parseInt(categoryId) : null,
        amount: finalAmount,
        description,
        transaction_date: transactionDate,
      });
      onSuccess();
      onClose();
      setAmount('');
      setDescription('');
      setTransactionDate(new Date().toISOString().split('T')[0]);
    } catch {
      alert('Failed to create transaction');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const filteredCategories = categories.filter((c) => c.type === type);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex justify-between items-center p-6 pb-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-navy">Add Transaction</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-navy transition">✕</button>
        </div>

        <div className="p-6">
          {accounts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray mb-2">No accounts yet.</p>
              <p className="text-sm text-gray">Create an account first before adding transactions.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Type toggle */}
              <div className="flex rounded-xl overflow-hidden border border-slate-200">
                <button
                  type="button"
                  onClick={() => setType('expense')}
                  className={`flex-1 py-2.5 text-sm font-medium transition ${type === 'expense' ? 'bg-accent text-white' : 'bg-white text-gray hover:bg-slate-50'}`}
                >
                  Expense
                </button>
                <button
                  type="button"
                  onClick={() => setType('income')}
                  className={`flex-1 py-2.5 text-sm font-medium transition ${type === 'income' ? 'bg-primary text-white' : 'bg-white text-gray hover:bg-slate-50'}`}
                >
                  Income
                </button>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-navy mb-1.5">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray font-medium">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {/* Account */}
              <div>
                <label className="block text-sm font-medium text-navy mb-1.5">Account</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy bg-white"
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-sm font-medium text-navy">Category</label>
                  <button
                    type="button"
                    onClick={() => setShowNewCategory(!showNewCategory)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showNewCategory ? 'Cancel' : '+ New category'}
                  </button>
                </div>

                {showNewCategory ? (
                  <div className="p-3 border border-slate-200 rounded-xl space-y-3">
                    <input
                      type="text"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Category name"
                    />
                    <div className="flex gap-2 flex-wrap">
                      {CATEGORY_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewCatColor(c)}
                          className={`w-7 h-7 rounded-full border-2 transition ${newCatColor === c ? 'border-navy scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      disabled={addingCat || !newCatName.trim()}
                      className="w-full py-2 bg-primary text-white text-sm rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                      {addingCat ? 'Adding...' : 'Add Category'}
                    </button>
                  </div>
                ) : (
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy bg-white"
                  >
                    <option value="">No category</option>
                    {filteredCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-navy mb-1.5">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
                  placeholder="What was this for?"
                />
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium text-navy mb-1.5">Date</label>
                <input
                  type="date"
                  value={transactionDate}
                  onChange={(e) => setTransactionDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 border border-slate-200 rounded-xl text-navy text-sm font-medium hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 bg-primary text-white rounded-xl text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add Transaction'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddTransactionModal;
