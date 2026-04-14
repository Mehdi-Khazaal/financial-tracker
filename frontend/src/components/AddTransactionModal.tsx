import React, { useState, useEffect } from 'react';
import { createTransaction, getAccounts, getCategories } from '../utils/api';
import { Account, Category } from '../types';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddTransactionModal: React.FC<AddTransactionModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    try {
      const [accountsRes, categoriesRes] = await Promise.all([
        getAccounts(),
        getCategories(),
      ]);
      setAccounts(accountsRes.data);
      setCategories(categoriesRes.data);
      
      if (accountsRes.data.length > 0) {
        setAccountId(accountsRes.data[0].id.toString());
      }
      if (categoriesRes.data.length > 0) {
        setCategoryId(categoriesRes.data[0].id.toString());
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await createTransaction({
        account_id: parseInt(accountId),
        category_id: parseInt(categoryId),
        amount: parseFloat(amount),
        description,
        transaction_date: transactionDate,
      });
      onSuccess();
      onClose();
      // Reset form
      setAmount('');
      setDescription('');
      setTransactionDate(new Date().toISOString().split('T')[0]);
    } catch (error) {
      console.error('Failed to create transaction:', error);
      alert('Failed to create transaction');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-primary">Add Transaction</h2>
          <button onClick={onClose} className="text-gray hover:text-navy text-2xl">&times;</button>
        </div>

        {accounts.length === 0 ? (
          <p className="text-accent">Please create an account first!</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-navy font-medium mb-2">Account</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                {accounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.name} (${account.balance})
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-navy font-medium mb-2">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name} ({category.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-navy font-medium mb-2">Amount</label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Negative for expenses"
                required
              />
              <p className="text-sm text-gray mt-1">Use negative for expenses (e.g., -50.00)</p>
            </div>

            <div className="mb-4">
              <label className="block text-navy font-medium mb-2">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Grocery shopping"
              />
            </div>

            <div className="mb-6">
              <label className="block text-navy font-medium mb-2">Date</label>
              <input
                type="date"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray rounded-lg hover:bg-beige transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 transition disabled:opacity-50"
              >
                {loading ? 'Adding...' : 'Add Transaction'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default AddTransactionModal;