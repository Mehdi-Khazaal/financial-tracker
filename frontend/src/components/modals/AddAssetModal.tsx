import React, { useState } from 'react';
import BottomSheet from '../BottomSheet';
import { createAsset } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  mode: 'investment' | 'physical';
}

const INVESTMENT_TYPES = [
  { value: 'stock',  label: 'Stock',  icon: '📈' },
  { value: 'crypto', label: 'Crypto', icon: '₿' },
  { value: 'gold',   label: 'Gold',   icon: '🥇' },
  { value: 'silver', label: 'Silver', icon: '🥈' },
  { value: 'etf',    label: 'ETF',    icon: '📊' },
  { value: 'bond',   label: 'Bond',   icon: '📜' },
];

const PHYSICAL_TYPES = [
  { value: 'real_estate', label: 'Real Estate', icon: '🏠' },
  { value: 'vehicle',     label: 'Vehicle',     icon: '🚗' },
  { value: 'business',    label: 'Business',    icon: '💼' },
  { value: 'jewelry',     label: 'Jewelry',     icon: '💎' },
  { value: 'art',         label: 'Art',         icon: '🖼️' },
  { value: 'other',       label: 'Other',       icon: '📦' },
];

const TICKER_TYPES = new Set(['stock', 'crypto', 'etf']);

const AddAssetModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, mode }) => {
  const toast = useToast();
  const types = mode === 'investment' ? INVESTMENT_TYPES : PHYSICAL_TYPES;
  const [assetType, setAssetType] = useState(types[0].value);
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');
  const [valuePerUnit, setValuePerUnit] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  const isInvestment = mode === 'investment';
  const hasTicker = isInvestment && TICKER_TYPES.has(assetType);

  // Auto-calc total
  const calcTotal = () => {
    if (quantity && valuePerUnit) {
      const t = parseFloat(quantity) * parseFloat(valuePerUnit);
      if (!isNaN(t)) setTotalValue(t.toFixed(2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Append ticker in (SYMBOL) format so live prices can be fetched
      const sym = ticker.trim().toUpperCase();
      const finalName = hasTicker && sym
        ? (name.trim() ? `${name.trim()} (${sym})` : sym)
        : name.trim();
      await createAsset({
        name: finalName,
        type: assetType,
        asset_class: isInvestment ? 'investment' : 'physical',
        quantity: quantity ? parseFloat(quantity) : null,
        value_per_unit: valuePerUnit ? parseFloat(valuePerUnit) : null,
        total_value: parseFloat(totalValue) || 0,
        purchase_date: purchaseDate || null,
        currency: 'USD',
      });
      onSuccess(); onClose();
      setName(''); setTicker(''); setQuantity(''); setValuePerUnit(''); setTotalValue('');
      setPurchaseDate(new Date().toISOString().split('T')[0]);
      setAssetType(types[0].value);
    } catch { toast.error('Failed to create asset'); }
    finally { setLoading(false); }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={isInvestment ? 'Add Investment' : 'Add Asset'}>
      <form onSubmit={handleSubmit} className="px-5 pb-6 space-y-4">
        {/* Type grid */}
        <div>
          <p className="label mb-2">Type</p>
          <div className="grid grid-cols-3 gap-2">
            {types.map(t => (
              <button key={t.value} type="button" onClick={() => { setAssetType(t.value); setTicker(''); }}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all"
                style={assetType === t.value
                  ? { borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.08)' }
                  : { borderColor: '#1a1f2e', backgroundColor: '#0d1018' }}>
                <span className="text-xl">{t.icon}</span>
                <span className="text-xs font-semibold" style={{ color: assetType === t.value ? '#6366f1' : '#666e90' }}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Ticker symbol (stocks/crypto/etf only) */}
        {hasTicker && (
          <div>
            <p className="label mb-2">Ticker Symbol <span className="text-muted font-normal">(required for live prices)</span></p>
            <input
              type="text"
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              className="input-dark font-mono tracking-widest"
              placeholder={assetType === 'crypto' ? 'BTC' : assetType === 'etf' ? 'SPY' : 'AAPL'}
              maxLength={10}
              required
            />
            <p className="text-[11px] text-muted mt-1">Enter the exchange ticker, e.g. AAPL, BTC, ETH, SPY</p>
          </div>
        )}

        {/* Name */}
        <div>
          <p className="label mb-2">Name <span className="text-muted font-normal">{hasTicker ? '(optional)' : ''}</span></p>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="input-dark"
            placeholder={isInvestment
              ? hasTicker ? 'e.g. Apple Inc.' : 'e.g. Gold Bar'
              : 'e.g. My Apartment'}
            required={!hasTicker} />
        </div>

        {/* Quantity & Price */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="label mb-2">{isInvestment ? 'Quantity' : 'Units'}</p>
            <input type="number" step="any" min="0" value={quantity}
              onChange={e => { setQuantity(e.target.value); }}
              onBlur={calcTotal}
              className="input-dark" placeholder="1" />
          </div>
          <div>
            <p className="label mb-2">{isInvestment ? 'Price / unit' : 'Value / unit'}</p>
            <input type="number" step="0.01" min="0" value={valuePerUnit}
              onChange={e => { setValuePerUnit(e.target.value); }}
              onBlur={calcTotal}
              className="input-dark" placeholder="0.00" />
          </div>
        </div>

        {/* Total value */}
        <div>
          <p className="label mb-2">Total Value</p>
          <input type="number" step="0.01" min="0" value={totalValue}
            onChange={e => setTotalValue(e.target.value)}
            className="input-dark" placeholder="0.00" required />
        </div>

        {/* Date */}
        <div>
          <p className="label mb-2">Purchase Date <span className="text-dim">(optional)</span></p>
          <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="input-dark" />
        </div>

        <button type="submit" disabled={loading || !name.trim() || !totalValue}
          className="btn-gradient w-full py-3.5 disabled:opacity-40">
          {loading ? 'Saving…' : `Add ${isInvestment ? 'Investment' : 'Asset'}`}
        </button>
      </form>
    </BottomSheet>
  );
};

export default AddAssetModal;
