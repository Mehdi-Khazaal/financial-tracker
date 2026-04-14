import React, { useEffect, useState } from 'react';
import { Transaction, Account, Category } from '../types';
import { getTransactions, getAccounts, getCategories, deleteTransaction } from '../utils/api';
import Navigation from '../components/Navigation';
import FloatingAddButton from '../components/FloatingAddButton';
import AddTransactionModal from '../components/AddTransactionModal';

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filterAccount, setFilterAccount] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterType, setFilterType] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [txRes, accRes, catRes] = await Promise.all([getTransactions(), getAccounts(), getCategories()]);
      setTransactions(txRes.data);
      setAccounts(accRes.data);
      setCategories(catRes.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this transaction?')) return;
    try {
      await deleteTransaction(id);
      loadData();
    } catch {
      alert('Failed to delete transaction');
    }
  };

  const getAccountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? 'Unknown';
  const getCategory = (id: number | null) => categories.find((c) => c.id === id);

  const filtered = transactions
    .filter((t) => {
      if (filterAccount !== 'all' && t.account_id !== parseInt(filterAccount)) return false;
      if (filterCategory !== 'all' && t.category_id !== parseInt(filterCategory)) return false;
      if (filterType === 'income' && Number(t.amount) < 0) return false;
      if (filterType === 'expense' && Number(t.amount) >= 0) return false;
      return true;
    })
    .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());

  const totalIncome = filtered.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses = filtered.filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <div className="md:ml-64 min-h-screen bg-slate-50 pb-24 md:pb-8">
        <div className="p-4 md:p-8 max-w-5xl">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-navy">Transactions</h1>
            <button
              onClick={() => setShowAdd(true)}
              className="hidden md:flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition"
            >
              + Add Transaction
            </button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-2xl p-4 border border-slate-100">
              <p className="text-xs text-gray mb-1">Income</p>
              <p className="text-xl font-bold text-primary">+${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-slate-100">
              <p className="text-xs text-gray mb-1">Expenses</p>
              <p className="text-xl font-bold text-accent">-${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-slate-100">
              <p className="text-xs text-gray mb-1">Net</p>
              <p className={`text-xl font-bold ${(totalIncome - totalExpenses) >= 0 ? 'text-primary' : 'text-accent'}`}>
                ${(totalIncome - totalExpenses).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 mb-6">
            <div className="flex gap-2 mb-3">
              {(['all', 'income', 'expense'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                    filterType === t ? 'bg-primary text-white' : 'bg-slate-100 text-gray hover:bg-slate-200'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={filterAccount}
                onChange={(e) => setFilterAccount(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm text-navy bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm text-navy bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Transaction list */}
          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
              <p className="text-4xl mb-3">📭</p>
              <p className="font-semibold text-navy">No transactions found</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              {filtered.map((tx, i) => {
                const cat = getCategory(tx.category_id);
                const isPositive = Number(tx.amount) >= 0;
                return (
                  <div
                    key={tx.id}
                    className={`flex items-center justify-between p-4 group ${i !== filtered.length - 1 ? 'border-b border-slate-50' : ''} hover:bg-slate-50 transition`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-2 h-10 rounded-full shrink-0"
                        style={{ backgroundColor: cat?.color ?? (isPositive ? '#BBD151' : '#B12B24') }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-navy truncate">{tx.description || 'No description'}</p>
                        <div className="flex items-center gap-2 text-xs text-gray">
                          <span>{tx.transaction_date}</span>
                          <span>·</span>
                          <span>{getAccountName(tx.account_id)}</span>
                          {cat && <><span>·</span><span>{cat.name}</span></>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <p className={`font-bold text-sm ${isPositive ? 'text-primary' : 'text-accent'}`}>
                        {isPositive ? '+' : '-'}${Math.abs(Number(tx.amount)).toFixed(2)}
                      </p>
                      <button
                        onClick={() => handleDelete(tx.id)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-accent hover:underline transition-opacity"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <FloatingAddButton
        actions={[{ label: 'Add Transaction', icon: '↕', color: '#B12B24', onClick: () => setShowAdd(true) }]}
      />

      <AddTransactionModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={loadData} />
    </>
  );
};

export default Transactions;
