import React, { useState } from 'react';
import { createAccount } from '../utils/api';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [balance, setBalance] = useState('0');
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await createAccount({
        name,
        type,
        balance: parseFloat(balance),
        currency,
      });
      onSuccess();
      onClose();
      // Reset form
      setName('');
      setType('checking');
      setBalance('0');
      setCurrency('USD');
    } catch (error) {
      console.error('Failed to create account:', error);
      alert('Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-primary">Add Account</h2>
          <button onClick={onClose} className="text-gray hover:text-navy text-2xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-navy font-medium mb-2">Account Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Chase Checking"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-navy font-medium mb-2">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="credit_card">Credit Card</option>
              <option value="investment">Investment</option>
              <option value="cash">Cash</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-navy font-medium mb-2">Initial Balance</label>
            <input
              type="number"
              step="0.01"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-navy font-medium mb-2">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
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
              {loading ? 'Adding...' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddAccountModal;