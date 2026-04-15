import React, { useEffect, useState } from 'react';
import { Asset } from '../types';
import { getAssets, deleteAsset } from '../utils/api';
import { getStockPrice, getMockStockPrice } from '../utils/stockApi';
import Navigation from '../components/Navigation';
import AddAssetModal from '../components/modals/AddAssetModal';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_ICONS: Record<string, string> = {
  stock: '📈', crypto: '₿', gold: '🥇', silver: '🥈', etf: '📊', bond: '📜',
};

const Investments: React.FC = () => {
  const [investments, setInvestments] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getAssets({ asset_class: 'investment' });
      setInvestments(res.data);
      fetchPricesBackground(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const fetchPricesBackground = async (assets: Asset[]) => {
    const cached    = localStorage.getItem('stock_prices_cache');
    const cacheTime = localStorage.getItem('stock_prices_cache_time');
    if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 5 * 60 * 1000) {
      setStockPrices(JSON.parse(cached));
      return;
    }
    const stockAssets = assets.filter(a => a.type === 'stock' || a.type === 'crypto');
    if (!stockAssets.length) return;
    setFetchingPrices(true);
    const prices: Record<string, number> = {};
    for (let i = 0; i < stockAssets.length; i++) {
      const sym = stockAssets[i].name.match(/\(([A-Z]+)\)/)?.[1];
      if (sym) {
        const price = await getStockPrice(sym);
        prices[sym] = price ?? getMockStockPrice(sym);
        setStockPrices(prev => ({ ...prev, [sym]: prices[sym] }));
        if (i < stockAssets.length - 1) await new Promise(r => setTimeout(r, 13000));
      }
    }
    localStorage.setItem('stock_prices_cache', JSON.stringify(prices));
    localStorage.setItem('stock_prices_cache_time', Date.now().toString());
    setFetchingPrices(false);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try { await deleteAsset(id); load(); }
    catch { alert('Failed to delete'); }
  };

  const getSymbol       = (name: string) => name.match(/\(([A-Z]+)\)/)?.[1] ?? null;
  const getCurrentPrice = (a: Asset) => { const sym = getSymbol(a.name); return sym && stockPrices[sym] ? stockPrices[sym] : Number(a.value_per_unit ?? 0); };
  const getCurrentValue = (a: Asset) => getCurrentPrice(a) * Number(a.quantity ?? 1);
  const getGainLoss     = (a: Asset) => getCurrentValue(a) - Number(a.total_value);
  const getGainLossPct  = (a: Asset) => { const cost = Number(a.total_value); return cost > 0 ? (getGainLoss(a) / cost) * 100 : 0; };

  const filtered     = filter === 'all' ? investments : investments.filter(a => a.type === filter);
  const totalCost    = investments.reduce((s, a) => s + Number(a.total_value), 0);
  const totalCurrent = investments.reduce((s, a) => s + getCurrentValue(a), 0);
  const totalGain    = totalCurrent - totalCost;

  const types = ['all', ...Array.from(new Set(investments.map(a => a.type)))];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#0b0d12' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: '#5b8fff', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#0b0d12' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-text">Investments</h1>
              {fetchingPrices && (
                <p className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full pulse-dot inline-block" style={{ backgroundColor: '#5b8fff' }} />
                  Fetching live prices…
                </p>
              )}
            </div>
            <button onClick={() => setShowAdd(true)}
              className="hidden md:block text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: '#181c28', border: '1px solid #252a3a', color: '#7880a0' }}>
              + Investment
            </button>
          </div>

          {/* Hero */}
          <div className="rounded-3xl p-6 relative overflow-hidden"
            style={{ background: 'linear-gradient(145deg, #11141c, #181c28)', border: '1px solid #252a3a' }}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-15 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #5b8fff, transparent)' }} />
            <p className="label mb-1">Portfolio Value</p>
            <p className="font-mono font-bold text-text mb-3" style={{ fontSize: '2.5rem', letterSpacing: '-1px' }}>
              ${fmt(totalCurrent)}
            </p>
            <div className="flex gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Invested</p>
                <p className="font-mono text-sm font-semibold text-text">${fmt(totalCost)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Gain / Loss</p>
                <p className="font-mono text-sm font-semibold" style={{ color: totalGain >= 0 ? '#2ecc8a' : '#ff5f6d' }}>
                  {totalGain >= 0 ? '+' : '-'}${fmt(Math.abs(totalGain))}
                </p>
              </div>
            </div>
          </div>

          {/* Type filter */}
          {investments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {types.map(t => (
                <button key={t} onClick={() => setFilter(t)}
                  className="pill shrink-0 transition-all capitalize"
                  style={filter === t
                    ? { backgroundColor: 'rgba(91,143,255,.15)', color: '#5b8fff', border: '1px solid rgba(91,143,255,.3)' }
                    : { backgroundColor: '#11141c', color: '#7880a0' }}>
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* List */}
          {investments.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-3xl mb-3">📈</p>
              <p className="font-semibold text-text mb-1">No investments yet</p>
              <p className="text-sm text-muted mb-5">Track stocks, crypto, gold, ETFs, and more</p>
              <button onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">Add Investment</button>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(inv => {
                const gainLoss = getGainLoss(inv);
                const gainPct  = getGainLossPct(inv);
                const curPrice = getCurrentPrice(inv);
                const curVal   = getCurrentValue(inv);
                const sym      = getSymbol(inv.name);
                const isGain   = gainLoss >= 0;

                return (
                  <div key={inv.id} className="card card-hover p-4 group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{TYPE_ICONS[inv.type] ?? '💰'}</span>
                        <div>
                          <p className="font-semibold text-sm text-text">{inv.name}</p>
                          <span className="text-[10px] px-2 py-0.5 rounded-full capitalize"
                            style={{ backgroundColor: '#252a3a', color: '#7880a0' }}>{inv.type}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold font-mono" style={{ color: isGain ? '#2ecc8a' : '#ff5f6d' }}>
                          {isGain ? '▲' : '▼'} {Math.abs(gainPct).toFixed(2)}%
                        </span>
                        <button onClick={() => handleDelete(inv.id, inv.name)}
                          className="opacity-0 group-hover:opacity-100 text-[10px] transition-all"
                          style={{ color: '#3e4460' }}
                          onMouseEnter={e => (e.target as HTMLElement).style.color = '#ff5f6d'}
                          onMouseLeave={e => (e.target as HTMLElement).style.color = '#3e4460'}>
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Buy Price',  value: `$${Number(inv.value_per_unit ?? 0).toFixed(2)}` },
                        { label: `Current${sym && !stockPrices[sym] ? ' (est.)' : ''}`, value: `$${curPrice.toFixed(2)}` },
                        { label: 'Quantity',   value: Number(inv.quantity ?? 0).toFixed(4) },
                        { label: 'Value',      value: `$${fmt(curVal)}`, highlight: isGain ? '#2ecc8a' : '#ff5f6d' },
                      ].map(stat => (
                        <div key={stat.label}>
                          <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">{stat.label}</p>
                          <p className="font-mono text-sm font-semibold" style={{ color: stat.highlight ?? '#e8eaf2' }}>{stat.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-between items-center mt-3 pt-3" style={{ borderTop: '1px solid #252a3a' }}>
                      <p className="text-xs text-muted">Invested: ${fmt(Number(inv.total_value))}</p>
                      <p className="font-mono text-xs font-bold" style={{ color: isGain ? '#2ecc8a' : '#ff5f6d' }}>
                        {isGain ? '+' : '-'}${fmt(Math.abs(gainLoss))}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* FAB */}
      <button onClick={() => setShowAdd(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #5b8fff, #a78bfa)', boxShadow: '0 8px 32px rgba(91,143,255,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAssetModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} mode="investment" />
    </>
  );
};

export default Investments;
