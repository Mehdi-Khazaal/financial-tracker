import React, { useEffect, useState } from 'react';
import { Asset } from '../types';
import { getAssets, deleteAsset } from '../utils/api';
import Navigation from '../components/Navigation';
import FloatingAddButton from '../components/FloatingAddButton';
import AddInvestmentModal from '../components/AddInvestmentModal';
import { getStockPrice, getMockStockPrice } from '../utils/stockApi';

const Investments: React.FC = () => {
  const [investments, setInvestments] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [fetchingPrices, setFetchingPrices] = useState(false);

  useEffect(() => { loadInvestments(); }, []);

  const loadInvestments = async () => {
    setLoading(true);
    try {
      const res = await getAssets();
      const all = res.data as Asset[];
      setInvestments(all);
      fetchPricesBackground(all);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchPricesBackground = async (assets: Asset[]) => {
    const cached = localStorage.getItem('stock_prices_cache');
    const cacheTime = localStorage.getItem('stock_prices_cache_time');
    const now = Date.now();

    if (cached && cacheTime && now - parseInt(cacheTime) < 5 * 60 * 1000) {
      setStockPrices(JSON.parse(cached));
      return;
    }

    const stockAssets = assets.filter((a) => a.type === 'stock' || a.type === 'crypto');
    if (stockAssets.length === 0) return;

    setFetchingPrices(true);
    const prices: Record<string, number> = {};

    for (let i = 0; i < stockAssets.length; i++) {
      const asset = stockAssets[i];
      const match = asset.name.match(/\(([A-Z]+)\)/);
      if (match) {
        const symbol = match[1];
        const price = await getStockPrice(symbol);
        prices[symbol] = price ?? getMockStockPrice(symbol);
        setStockPrices((prev) => ({ ...prev, [symbol]: prices[symbol] }));
        if (i < stockAssets.length - 1) {
          await new Promise((r) => setTimeout(r, 13000));
        }
      }
    }

    localStorage.setItem('stock_prices_cache', JSON.stringify(prices));
    localStorage.setItem('stock_prices_cache_time', now.toString());
    setFetchingPrices(false);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await deleteAsset(id);
      loadInvestments();
    } catch {
      alert('Failed to delete investment');
    }
  };

  const getSymbol = (name: string) => name.match(/\(([A-Z]+)\)/)?.[1] ?? null;
  const getCurrentPrice = (a: Asset) => {
    const sym = getSymbol(a.name);
    return sym && stockPrices[sym] ? stockPrices[sym] : Number(a.value_per_unit ?? 0);
  };
  const getCurrentValue = (a: Asset) => getCurrentPrice(a) * Number(a.quantity ?? 1);
  const getGainLoss = (a: Asset) => getCurrentValue(a) - Number(a.total_value);
  const getGainLossPct = (a: Asset) => {
    const cost = Number(a.total_value);
    return cost > 0 ? ((getGainLoss(a) / cost) * 100) : 0;
  };

  const totalCost = investments.reduce((s, a) => s + Number(a.total_value), 0);
  const totalCurrent = investments.reduce((s, a) => s + getCurrentValue(a), 0);
  const totalGainLoss = totalCurrent - totalCost;

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
            <div>
              <h1 className="text-3xl font-bold text-navy">Investments</h1>
              {fetchingPrices && (
                <p className="text-xs text-gray mt-1 flex items-center gap-1">
                  <span className="w-2 h-2 bg-lime rounded-full animate-pulse inline-block" />
                  Fetching live prices...
                </p>
              )}
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="hidden md:flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition"
            >
              + Add Investment
            </button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-2xl p-5 border border-slate-100">
              <p className="text-xs text-gray mb-1">Current Value</p>
              <p className="text-2xl font-bold text-navy">${totalCurrent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-slate-100">
              <p className="text-xs text-gray mb-1">Total Invested</p>
              <p className="text-2xl font-bold text-navy">${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className={`rounded-2xl p-5 border ${totalGainLoss >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
              <p className="text-xs text-gray mb-1">Total Gain/Loss</p>
              <p className={`text-2xl font-bold ${totalGainLoss >= 0 ? 'text-primary' : 'text-accent'}`}>
                {totalGainLoss >= 0 ? '+' : '-'}${Math.abs(totalGainLoss).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {investments.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
              <p className="text-5xl mb-4">📈</p>
              <p className="text-xl font-bold text-navy mb-2">No investments yet</p>
              <p className="text-gray mb-6">Track your stocks, crypto, gold, and more</p>
              <button onClick={() => setShowAdd(true)} className="bg-primary text-white px-8 py-3 rounded-xl font-medium hover:opacity-90">
                Add First Investment
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {investments.map((inv) => {
                const gainLoss = getGainLoss(inv);
                const gainPct = getGainLossPct(inv);
                const currentPrice = getCurrentPrice(inv);
                const currentVal = getCurrentValue(inv);
                const sym = getSymbol(inv.name);
                const isGain = gainLoss >= 0;

                return (
                  <div key={inv.id} className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-md transition-shadow group">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-navy">{inv.name}</h3>
                        <span className="text-xs bg-slate-100 text-gray px-2 py-0.5 rounded-full capitalize">{inv.type}</span>
                      </div>
                      <button
                        onClick={() => handleDelete(inv.id, inv.name)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-accent hover:underline transition-opacity"
                      >
                        Delete
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray mb-0.5">Purchased at</p>
                        <p className="font-semibold text-navy">${Number(inv.value_per_unit ?? 0).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray mb-0.5">
                          Current price {sym && stockPrices[sym] ? '' : sym ? '(mock)' : ''}
                        </p>
                        <p className="font-semibold text-navy">${currentPrice.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray mb-0.5">Quantity</p>
                        <p className="font-semibold text-navy">{Number(inv.quantity ?? 0).toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray mb-0.5">Current value</p>
                        <p className="font-bold text-primary">${currentVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                    </div>

                    <div className={`mt-4 pt-4 border-t border-slate-50 flex justify-between items-center`}>
                      <p className="text-xs text-gray">Invested: ${Number(inv.total_value).toFixed(2)}</p>
                      <div className={`flex items-center gap-1 font-bold text-sm ${isGain ? 'text-primary' : 'text-accent'}`}>
                        <span>{isGain ? '▲' : '▼'}</span>
                        <span>{Math.abs(gainPct).toFixed(2)}%</span>
                        <span className="text-xs font-normal">({isGain ? '+' : '-'}${Math.abs(gainLoss).toFixed(2)})</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <FloatingAddButton
        actions={[{ label: 'Add Investment', icon: '📈', color: '#1F422C', onClick: () => setShowAdd(true) }]}
      />

      <AddInvestmentModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={loadInvestments}
        mode="investment"
      />
    </>
  );
};

export default Investments;
