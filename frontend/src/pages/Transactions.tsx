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
  const [showAddTransaction, setShowAddTransaction] = useState(false);

  // Filters
  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all'); // all, income, expense

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [transactionsRes, accountsRes, categoriesRes] = await Promise.all([
        getTransactions(),
        getAccounts(),
        getCategories(),
      ]);
      setTransactions(transactionsRes.data);
      setAccounts(accountsRes.data);
      setCategories(categoriesRes.data);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this transaction?')) return;

    try {
      await deleteTransaction(id);
      loadData();
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      alert('Failed to delete transaction');
    }
  };

  const getAccountName = (accountId: number) => {
    return accounts.find(a => a.id === accountId)?.name || 'Unknown';
  };

  const getCategoryName = (categoryId: number | null) => {
    if (!categoryId) return 'Uncategorized';
    return categories.find(c => c.id === categoryId)?.name || 'Unknown';
  };

  const getCategoryColor = (categoryId: number | null) => {
    if (!categoryId) return '#84848A';
    return categories.find(c => c.id === categoryId)?.color || '#84848A';
  };

  // Apply filters
  const filteredTransactions = transactions.filter(transaction => {
    if (filterAccount !== 'all' && transaction.account_id !== parseInt(filterAccount)) return false;
    if (filterCategory !== 'all' && transaction.category_id !== parseInt(filterCategory)) return false;
    
    if (filterType === 'income' && Number(transaction.amount) < 0) return false;
    if (filterType === 'expense' && Number(transaction.amount) >= 0) return false;
    
    return true;
  });

  // Calculate totals
  const totalIncome = filteredTransactions
    .filter(t => Number(t.amount) > 0)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  
  const totalExpenses = filteredTransactions
    .filter(t => Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-xl text-primary">Loading...</div>
    </div>;
  }

  return (
    <>
      <Navigation />
      
      <div className="md:ml-64 min-h-screen bg-beige pb-20 md:pb-8">
        <div className="p-4 md:p-8">
          <h1 className="text-4xl font-bold text-primary mb-8">Transactions</h1>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Total Income</p>
              <p className="text-3xl font-bold text-lime">+${totalIncome.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Total Expenses</p>
              <p className="text-3xl font-bold text-accent">-${totalExpenses.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Net</p>
              <p className={`text-3xl font-bold ${(totalIncome - totalExpenses) >= 0 ? 'text-lime' : 'text-accent'}`}>
                ${(totalIncome - totalExpenses).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg p-6 shadow mb-6">
            <h2 className="text-lg font-bold text-navy mb-4">Filters</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-navy mb-2">Type</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All</option>
                  <option value="income">Income Only</option>
                  <option value="expense">Expenses Only</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-navy mb-2">Account</label>
                <select
                  value={filterAccount}
                  onChange={(e) => setFilterAccount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Accounts</option>
                  {accounts.map(account => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-navy mb-2">Category</label>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Categories</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Transactions List */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {filteredTransactions.length === 0 ? (
              <p className="p-8 text-center text-gray">No transactions found</p>
            ) : (
              <div className="divide-y">
                {filteredTransactions
                  .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime())
                  .map(transaction => (
                    <div key={transaction.id} className="p-4 hover:bg-beige transition">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: getCategoryColor(transaction.category_id) }}
                            />
                            <h3 className="font-semibold text-navy">
                              {transaction.description || 'No description'}
                            </h3>
                          </div>
                          <div className="flex flex-wrap gap-3 text-sm text-gray">
                            <span>📅 {transaction.transaction_date}</span>
                            <span>🏦 {getAccountName(transaction.account_id)}</span>
                            <span>🏷️ {getCategoryName(transaction.category_id)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <p className={`text-2xl font-bold ${Number(transaction.amount) >= 0 ? 'text-lime' : 'text-accent'}`}>
                            {Number(transaction.amount) >= 0 ? '+' : ''}${Number(transaction.amount).toFixed(2)}
                          </p>
                          <button
                            onClick={() => handleDelete(transaction.id)}
                            className="px-3 py-1 bg-accent text-white text-sm rounded hover:opacity-90"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <FloatingAddButton
        onAddAccount={() => {}}
        onAddTransaction={() => setShowAddTransaction(true)}
      />

      <AddTransactionModal
        isOpen={showAddTransaction}
        onClose={() => setShowAddTransaction(false)}
        onSuccess={loadData}
      />
    </>
  );
};

export default Transactions;