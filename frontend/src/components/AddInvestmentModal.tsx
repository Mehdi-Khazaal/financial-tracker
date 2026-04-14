import React, { useState } from 'react';
import { createAsset } from '../utils/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  mode?: 'investment' | 'asset';
}

const investmentTypes = [
  { value: 'stock', label: 'Stock', icon: '📈' },
  { value: 'crypto', label: 'Crypto', icon: '₿' },
  { value: 'gold', label: 'Gold', icon: '🥇' },
  { value: 'silver', label: 'Silver', icon: '🥈' },
  { value: 'bond', label: 'Bond', icon: '📄' },
  { value: 'etf', label: 'ETF', icon: '📊' },
];

const assetTypes = [
  { value: 'real_estate', label: 'Real Estate', icon: '🏠' },
  { value: 'vehicle', label: 'Vehicle', icon: '🚗' },
  { value: 'business', label: 'Business', icon: '🏢' },
  { value: 'jewelry', label: 'Jewelry', icon: '💎' },
  { value: 'art', label: 'Art', icon: '🎨' },
  { value: 'other', label: 'Other', icon: '📦' },
];

const AddInvestmentModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, mode = 'investment' }) => {
  const types = mode === 'investment' ? investmentTypes : assetTypes;

  const [name, setName] = useState('');
  const [type, setType] = useState(types[0].value);
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [valuePerUnit, setValuePerUnit] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);

  const isStock = type === 'stock';
  const isCrypto = type === 'crypto';
  const hasQuantity = isStock || isCrypto || type === 'gold' || type === 'silver' || type === 'etf';

  const computedTotal = quantity && valuePerUnit
    ? (parseFloat(quantity) * parseFloat(valuePerUnit)).toFixed(2)
    : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const qty = quantity ? parseFloat(quantity) : null;
      const vpu = valuePerUnit ? parseFloat(valuePerUnit) : null;
      const total = hasQuantity ? (qty! * vpu!) : parseFloat(totalValue);

      await createAsset({
        name: (isStock || isCrypto) && symbol ? `${name} (${symbol.toUpperCase()})` : name,
        type,
        quantity: qty,
        value_per_unit: vpu,
        total_value: total,
        currency,
        purchase_date: purchaseDate,
      });

      onSuccess();
      onClose();
      setName('');
      setSymbol('');
      setQuantity('');
      setValuePerUnit('');
      setTotalValue('');
      setType(types[0].value);
      setPurchaseDate(new Date().toISOString().split('T')[0]);
    } catch {
      alert(`Failed to add ${mode}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex justify-between items-center p-6 pb-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-navy">
            {mode === 'investment' ? 'Add Investment' : 'Add Asset'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-navy transition">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Type grid */}
          <div>
            <label className="block text-sm font-medium text-navy mb-2">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {types.map((t) => (
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

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-navy mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
              placeholder={isStock ? 'Apple Inc.' : isCrypto ? 'Bitcoin' : 'Asset name'}
              required
            />
          </div>

          {/* Ticker symbol */}
          {(isStock || isCrypto) && (
            <div>
              <label className="block text-sm font-medium text-navy mb-1.5">
                {isStock ? 'Ticker Symbol' : 'Symbol'}
              </label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy font-mono"
                placeholder={isStock ? 'AAPL' : 'BTC'}
              />
            </div>
          )}

          {hasQuantity ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-navy mb-1.5">Quantity</label>
                <input
                  type="number"
                  step="0.0001"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
                  placeholder="10"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy mb-1.5">Price per unit</label>
                <input
                  type="number"
                  step="0.01"
                  value={valuePerUnit}
                  onChange={(e) => setValuePerUnit(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
                  placeholder="150.00"
                  required
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-navy mb-1.5">Total Value</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray font-medium">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={totalValue}
                  onChange={(e) => setTotalValue(e.target.value)}
                  className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
          )}

          {computedTotal && (
            <div className="flex justify-between items-center p-4 bg-beige rounded-xl">
              <span className="text-sm text-gray">Total Value</span>
              <span className="text-xl font-bold text-primary">${computedTotal}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-navy mb-1.5">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy bg-white"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="MAD">MAD</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-navy mb-1.5">Purchase Date</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-navy"
              />
            </div>
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
              {loading ? 'Adding...' : mode === 'investment' ? 'Add Investment' : 'Add Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddInvestmentModal;
