import React, { useState } from 'react';
import { createAsset } from '../utils/api';

interface AddInvestmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddInvestmentModal: React.FC<AddInvestmentModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('stock');
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [valuePerUnit, setValuePerUnit] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const qty = parseFloat(quantity);
      const price = parseFloat(valuePerUnit);
      
      await createAsset({
        name: symbol ? `${name} (${symbol.toUpperCase()})` : name,
        type,
        quantity: qty,
        value_per_unit: price,
        total_value: qty * price,
        currency: 'USD',
        purchase_date: purchaseDate,
      });
      
      onSuccess();
      onClose();
      
      // Reset form
      setName('');
      setSymbol('');
      setQuantity('');
      setValuePerUnit('');
      setPurchaseDate(new Date().toISOString().split('T')[0]);
    } catch (error) {
      console.error('Failed to create investment:', error);
      alert('Failed to create investment');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-primary">Add Investment</h2>
          <button onClick={onClose} className="text-gray hover:text-navy text-2xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-navy font-medium mb-2">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="stock">Stock</option>
              <option value="crypto">Cryptocurrency</option>
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
              <option value="bond">Bond</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-navy font-medium mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Apple Inc."
              required
            />
          </div>

          {type === 'stock' && (
            <div className="mb-4">
              <label className="block text-navy font-medium mb-2">Ticker Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="AAPL"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-navy font-medium mb-2">Quantity</label>
            <input
              type="number"
              step="0.0001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="10"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-navy font-medium mb-2">Purchase Price per Unit</label>
            <input
              type="number"
              step="0.01"
              value={valuePerUnit}
              onChange={(e) => setValuePerUnit(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="150.00"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-navy font-medium mb-2">Purchase Date</label>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {quantity && valuePerUnit && (
            <div className="mb-6 p-4 bg-beige rounded-lg">
              <p className="text-sm text-gray mb-1">Total Investment</p>
              <p className="text-2xl font-bold text-primary">
                ${(parseFloat(quantity) * parseFloat(valuePerUnit)).toFixed(2)}
              </p>
            </div>
          )}

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
              {loading ? 'Adding...' : 'Add Investment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddInvestmentModal;