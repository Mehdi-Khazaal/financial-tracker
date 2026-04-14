import React, { useState } from 'react';
import { createAccount } from '../utils/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddAccountModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [balance, setBalance] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createAccount({ name, type, balance: parseFloat(balance) || 0, currency });
      onSuccess();
      onClose();
      setName('');
      setType('checking');
      setBalance('');
      setCurrency('USD');
    } catch {
      alert('Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const accountTypes = [
    { value: 'checking', label: 'Checking', icon: '💳' },
    { value: 'savings', label: 'Savings', icon: '🏦' },
    { value: 'credit_card', label: 'Credit Card', icon: '💰' },
    { value: 'investment', label: 'Investment', icon: '📈' },
    { value: 'cash', label: 'Cash', icon: '💵' },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-md">
        <div className="flex justify-between items-center p-6 pb-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-navy">Add Account</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-navy transition">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy mb-1.5">Account Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
              placeholder="e.g. Chase Checking"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-navy mb-2">Account Type</label>
            <div className="grid grid-cols-3 gap-2">
              {accountTypes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`flex flex-col items-center py-3 px-2 rounded-xl border-2 transition text-xs font-medium ${
                    type === t.value ? 'border-primary bg-primary bg-opacity-5 text-primary' : 'border-slate-200 text-gray hover:border-slate-300'
                  }`}
                >
                  <span className="text-xl mb-1">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-navy mb-1.5">Current Balance</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray font-medium">{currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£'}</span>
              <input
                type="number"
                step="0.01"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-navy mb-1.5">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy bg-white"
            >
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
              <option value="CAD">CAD — Canadian Dollar</option>
              <option value="MAD">MAD — Moroccan Dirham</option>
            </select>
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
              {loading ? 'Adding...' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddAccountModal;
