import React, { useEffect, useState } from 'react';
import { Asset } from '../types';
import { getAssets, deleteAsset } from '../utils/api';
import { getStockPrice } from '../utils/stockApi';
import Navigation from '../components/Navigation';
import AddAssetModal from '../components/modals/AddAssetModal';
import { useToast } from '../context/ToastContext';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_ICONS: Record<string, string> = {
  stock: '📈', crypto: '₿', gold: '🥇', silver: '🥈', etf: '📊', bond: '📜',
};

const Investments: React.FC = () => {
  const toast = useToast();
  const [investments, setInvestments] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    try {
      const res = await getAssets({ asset_class: 'investment' });
      setInvestments(res.data);
      fetchPricesBackground(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const fetchPricesBackground = async (assets: Asset[], force = false) => {
    const tickerAssets = assets.filter(a => a.type === 'stock' || a.type === 'crypto' || a.type === 'etf');
    if (!tickerAssets.length) return;

    const symbols = tickerAssets
      .map(a => getSymbol(a.name))
      .filter((s): s is string => !!s);

    if (!symbols.length) return;

    // Use cache only if not forced AND all current symbols are already cached
    if (!force) {
      const cached    = localStorage.getItem('stock_prices_cache');
      const cacheTime = localStorage.getItem('stock_prices_cache_time');
      if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 5 * 60 * 1000) {
        const cachedPrices = JSON.parse(cached) as Record<string, number>;
        const allCached = symbols.every(s => cachedPrices[s] != null);
        if (allCached) {
          setStockPrices(cachedPrices);
          return;
        }
        // Some symbols missing from cache — fall through to fetch
      }
    }

    setFetchingPrices(true);
    const prices: Record<string, number> = {};
    await Promise.all(tickerAssets.map(async asset => {
      const sym = getSymbol(asset.name);
      if (!sym) return;
      const price = await getStockPrice(sym);
      if (price != null) {
        prices[sym] = price;
        setStockPrices(prev => ({ ...prev, [sym]: price }));
      }
    }));
    localStorage.setItem('stock_prices_cache', JSON.stringify(prices));
    localStorage.setItem('stock_prices_cache_time', Date.now().toString());
    setFetchingPrices(false);
  };

  const handleDelete = async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete "${name}"?`, { danger: true });
    if (!ok) return;
    try { await deleteAsset(id); load(); toast.success('Investment deleted'); }
    catch { toast.error('Failed to delete investment'); }
  };

  // Match "(AAPL)" format, or fall back to the name itself if it looks like a ticker
  const getSymbol = (name: string) =>
    name.match(/\(([A-Z0-9]+)\)/)?.[1] ??
    (/^[A-Z0-9]{1,10}$/.test(name.trim()) ? name.trim() : null);
  const getLivePrice    = (a: Asset): number | null => { const sym = getSymbol(a.name); return (sym && stockPrices[sym] != null) ? stockPrices[sym] : null; };
  const getCurrentPrice = (a: Asset) => getLivePrice(a) ?? Number(a.value_per_unit ?? 0);
  const hasLivePrice    = (a: Asset) => getLivePrice(a) != null;
  const getCurrentValue = (a: Asset) => getCurrentPrice(a) * Number(a.quantity ?? 1);
  const getGainLoss     = (a: Asset) => hasLivePrice(a) ? getCurrentValue(a) - Number(a.total_value) : null;
  const getGainLossPct  = (a: Asset) => { const cost = Number(a.total_value); const gl = getGainLoss(a); return (gl != null && cost > 0) ? (gl / cost) * 100 : null; };

  const filtered     = filter === 'all' ? investments : investments.filter(a => a.type === filter);
  const totalCost    = investments.reduce((s, a) => s + Number(a.total_value), 0);
  // Only sum current value for assets where we have a live price
  const priceKnownAssets = investments.filter(a => hasLivePrice(a));
  const totalCurrent = priceKnownAssets.reduce((s, a) => s + getCurrentValue(a), 0);
  const totalGain    = priceKnownAssets.length > 0 ? totalCurrent - priceKnownAssets.reduce((s, a) => s + Number(a.total_value), 0) : null;

  const types = ['all', ...Array.from(new Set(investments.map(a => a.type)))];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#070810' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: '#6366f1', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#070810' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-text">Investments</h1>
              {fetchingPrices ? (
                <p className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full pulse-dot inline-block" style={{ backgroundColor: '#6366f1' }} />
                  Fetching live prices…
                </p>
              ) : (
                <button
                  onClick={() => { localStorage.removeItem('stock_prices_cache'); localStorage.removeItem('stock_prices_cache_time'); fetchPricesBackground(investments, true); }}
                  className="text-xs text-muted mt-0.5 hover:text-accent transition-colors"
                  style={{ color: '#363d56' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#6366f1')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#363d56')}>
                  ↻ Refresh prices
                </button>
              )}
            </div>
            <button onClick={() => setShowAdd(true)}
              className="hidden md:block text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: '#121620', border: '1px solid #1a1f2e', color: '#666e90' }}>
              + Investment
            </button>
          </div>

          {/* Hero */}
          <div className="rounded-3xl p-6 relative overflow-hidden"
            style={{ background: 'linear-gradient(145deg, #0d1018, #121620)', border: '1px solid #1a1f2e' }}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-15 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
            <p className="label mb-1">Portfolio Value</p>
            <p className="font-mono font-bold text-text mb-3" style={{ fontSize: '2.5rem', letterSpacing: '-1px' }}>
              {priceKnownAssets.length > 0 ? `$${fmt(totalCurrent)}` : `$${fmt(totalCost)}`}
            </p>
            <div className="flex gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Invested</p>
                <p className="font-mono text-sm font-semibold text-text">${fmt(totalCost)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Gain / Loss</p>
                {totalGain != null ? (
                  <p className="font-mono text-sm font-semibold" style={{ color: totalGain >= 0 ? '#10b981' : '#f43f5e' }}>
                    {totalGain >= 0 ? '+' : '-'}${fmt(Math.abs(totalGain))}
                  </p>
                ) : (
                  <p className="font-mono text-sm font-semibold text-muted">—</p>
                )}
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
                    ? { backgroundColor: 'rgba(99,102,241,.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,.3)' }
                    : { backgroundColor: '#0d1018', color: '#666e90' }}>
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
                const gainLoss  = getGainLoss(inv);
                const gainPct   = getGainLossPct(inv);
                const livePx    = getLivePrice(inv);
                const curVal    = getCurrentValue(inv);
                const isGain    = (gainLoss ?? 0) >= 0;
                const hasPx     = hasLivePrice(inv);

                return (
                  <div key={inv.id} className="card card-hover p-4 group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{TYPE_ICONS[inv.type] ?? '💰'}</span>
                        <div>
                          <p className="font-semibold text-sm text-text">{inv.name}</p>
                          <span className="text-[10px] px-2 py-0.5 rounded-full capitalize"
                            style={{ backgroundColor: '#1a1f2e', color: '#666e90' }}>{inv.type}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {hasPx && gainPct != null ? (
                          <span className="text-xs font-bold font-mono" style={{ color: isGain ? '#10b981' : '#f43f5e' }}>
                            {isGain ? '▲' : '▼'} {Math.abs(gainPct).toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-xs font-mono flex items-center gap-1" style={{ color: '#f59e0b' }}>
                            <span className="w-1.5 h-1.5 rounded-full inline-block pulse-dot" style={{ backgroundColor: '#f59e0b' }} />
                            fetching…
                          </span>
                        )}
                        <button onClick={() => handleDelete(inv.id, inv.name)}
                          className="opacity-0 group-hover:opacity-100 text-[10px] transition-all"
                          style={{ color: '#363d56' }}
                          onMouseEnter={e => (e.target as HTMLElement).style.color = '#f43f5e'}
                          onMouseLeave={e => (e.target as HTMLElement).style.color = '#363d56'}>
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Buy Price',  value: `$${Number(inv.value_per_unit ?? 0).toFixed(2)}` },
                        { label: hasPx ? 'Live Price' : 'Current', value: hasPx ? `$${(livePx!).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—', highlight: hasPx ? '#eef0f8' : '#666e90' },
                        { label: 'Quantity',   value: Number(inv.quantity ?? 0).toFixed(4) },
                        { label: 'Value',      value: hasPx ? `$${fmt(curVal)}` : '—', highlight: hasPx ? (isGain ? '#10b981' : '#f43f5e') : '#666e90' },
                      ].map(stat => (
                        <div key={stat.label}>
                          <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">{stat.label}</p>
                          <p className="font-mono text-sm font-semibold" style={{ color: stat.highlight ?? '#eef0f8' }}>{stat.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-between items-center mt-3 pt-3" style={{ borderTop: '1px solid #1a1f2e' }}>
                      <p className="text-xs text-muted">Invested: ${fmt(Number(inv.total_value))}</p>
                      {hasPx && gainLoss != null ? (
                        <p className="font-mono text-xs font-bold" style={{ color: isGain ? '#10b981' : '#f43f5e' }}>
                          {isGain ? '+' : '-'}${fmt(Math.abs(gainLoss))}
                        </p>
                      ) : (
                        <p className="text-xs text-muted">No live price</p>
                      )}
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
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 32px rgba(99,102,241,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAssetModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={() => {
        localStorage.removeItem('stock_prices_cache');
        localStorage.removeItem('stock_prices_cache_time');
        load();
      }} mode="investment" />
    </>
  );
};

export default Investments;
