import React, { useEffect, useState, useCallback } from 'react';
import { Account, Asset, SavingsGoal } from '../types';
import { getAssets, deleteAsset, getAccounts, getSavingsGoals, deleteSavingsGoal } from '../utils/api';
import { getStockPrice } from '../utils/stockApi';
import Navigation from '../components/Navigation';
import PullToRefresh from '../components/PullToRefresh';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import AddAssetModal from '../components/modals/AddAssetModal';
import AddSavingsGoalModal from '../components/modals/AddSavingsGoalModal';
import ManageAllocationsModal from '../components/modals/ManageAllocationsModal';
import SpendFromGoalModal from '../components/modals/SpendFromGoalModal';

type Tab = 'investments' | 'assets' | 'savings';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_ICONS: Record<string, string> = {
  stock: '📈', crypto: '₿', gold: '🥇', silver: '🥈', etf: '📊', bond: '📜',
};

const ASSET_META: Record<string, { icon: string; color: string }> = {
  real_estate: { icon: 'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z', color: 'var(--accent)' },
  vehicle:     { icon: 'M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H11a1 1 0 001-1v-1h2v1a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H17a1 1 0 001-1V8a1 1 0 00-.293-.707l-3-3A1 1 0 0014 4H3z', color: '#a855f7' },
  business:    { icon: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9z', color: 'var(--pos)' },
  jewelry:     { icon: 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z', color: '#f59e0b' },
  art:         { icon: 'M4 3a2 2 0 100 4h12a2 2 0 100-4H4zm-2 6a1 1 0 011-1h14a1 1 0 110 2v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3a1 1 0 010-2z', color: 'var(--neg)' },
  other:       { icon: 'M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z', color: 'var(--muted)' },
};

const TYPE_COLORS: Record<string, string> = {
  checking: 'var(--accent)', savings: 'var(--pos)', cash: '#f59e0b', investment: '#a855f7', credit_card: 'var(--neg)',
};

const PortfolioPage: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('investments');
  const [loading, setLoading] = useState(true);

  // Investments
  const [investments, setInvestments] = useState<Asset[]>([]);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [invFilter, setInvFilter] = useState('all');
  const [showAddInv, setShowAddInv] = useState(false);

  // Assets
  const [assets, setAssets] = useState<Asset[]>([]);
  const [showAddAsset, setShowAddAsset] = useState(false);

  // Savings
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [editGoal, setEditGoal] = useState<SavingsGoal | null>(null);
  const [spendGoal, setSpendGoal] = useState<SavingsGoal | null>(null);

  const getSymbol = (name: string) =>
    name.match(/\(([A-Z0-9]+)\)/)?.[1] ??
    (/^[A-Z0-9]{1,10}$/.test(name.trim()) ? name.trim() : null);

  const fetchPricesBackground = useCallback(async (invs: Asset[], force = false) => {
    const tickerAssets = invs.filter(a => a.type === 'stock' || a.type === 'crypto' || a.type === 'etf');
    if (!tickerAssets.length) return;
    const symbols = tickerAssets.map(a => getSymbol(a.name)).filter((s): s is string => !!s);
    if (!symbols.length) return;
    if (!force) {
      const cached = localStorage.getItem('stock_prices_cache');
      const cacheTime = localStorage.getItem('stock_prices_cache_time');
      if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 5 * 60 * 1000) {
        const cachedPrices = JSON.parse(cached) as Record<string, number>;
        if (symbols.every(s => cachedPrices[s] != null)) { setStockPrices(cachedPrices); return; }
      }
    }
    setFetchingPrices(true);
    const prices: Record<string, number> = {};
    await Promise.all(tickerAssets.map(async asset => {
      const sym = getSymbol(asset.name);
      if (!sym) return;
      const price = await getStockPrice(sym);
      if (price != null) { prices[sym] = price; setStockPrices(prev => ({ ...prev, [sym]: price })); }
    }));
    localStorage.setItem('stock_prices_cache', JSON.stringify(prices));
    localStorage.setItem('stock_prices_cache_time', Date.now().toString());
    setFetchingPrices(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, assetRes, accRes, goalRes] = await Promise.all([
        getAssets({ asset_class: 'investment' }),
        getAssets({ asset_class: 'physical' }),
        getAccounts(),
        getSavingsGoals(),
      ]);
      const invs = Array.isArray(invRes.data) ? invRes.data : [];
      setInvestments(invs);
      setAssets(Array.isArray(assetRes.data) ? assetRes.data : []);
      setAccounts(Array.isArray(accRes.data) ? accRes.data : []);
      setGoals(Array.isArray(goalRes.data) ? goalRes.data : []);
      fetchPricesBackground(invs);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [fetchPricesBackground]);

  useEffect(() => { load(); }, [load]);
  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

  const handleDeleteInv = async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete "${name}"?`, { danger: true });
    if (!ok) return;
    try { await deleteAsset(id); load(); toast.success('Investment deleted'); }
    catch { toast.error('Failed to delete'); }
  };

  const handleDeleteAsset = async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete "${name}"?`, { danger: true });
    if (!ok) return;
    try { await deleteAsset(id); load(); toast.success('Asset deleted'); }
    catch { toast.error('Failed to delete asset'); }
  };

  const handleDeleteGoal = async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete goal "${name}"?`, { danger: true });
    if (!ok) return;
    try { await deleteSavingsGoal(id); load(); toast.success('Goal deleted'); }
    catch { toast.error('Failed to delete goal'); }
  };

  // Investment derived
  const getLivePrice    = (a: Asset) => { const sym = getSymbol(a.name); return (sym && stockPrices[sym] != null) ? stockPrices[sym] : null; };
  const getCurrentPrice = (a: Asset) => getLivePrice(a) ?? Number(a.value_per_unit ?? 0);
  const hasLivePrice    = (a: Asset) => getLivePrice(a) != null;
  const getCurrentValue = (a: Asset) => getCurrentPrice(a) * Number(a.quantity ?? 1);
  const getGainLoss     = (a: Asset) => hasLivePrice(a) ? getCurrentValue(a) - Number(a.total_value) : null;
  const getGainLossPct  = (a: Asset) => { const cost = Number(a.total_value); const gl = getGainLoss(a); return (gl != null && cost > 0) ? (gl / cost) * 100 : null; };

  const types = ['all', ...Array.from(new Set(investments.map(a => a.type)))];
  const filteredInv = invFilter === 'all' ? investments : investments.filter(a => a.type === invFilter);
  const totalCost = investments.reduce((s, a) => s + Number(a.total_value), 0);
  const priceKnown = investments.filter(a => hasLivePrice(a));
  const totalCurrent = priceKnown.reduce((s, a) => s + getCurrentValue(a), 0);
  const totalGain = priceKnown.length > 0 ? totalCurrent - priceKnown.reduce((s, a) => s + Number(a.total_value), 0) : null;

  // Asset derived
  const totalAssetValue = assets.reduce((s, a) => s + Number(a.total_value), 0);
  const byType: Record<string, Asset[]> = {};
  assets.forEach(a => { if (!byType[a.type]) byType[a.type] = []; byType[a.type].push(a); });

  // Savings derived
  const allocatedPerAccount: Record<number, number> = {};
  goals.forEach(g => { g.allocations.forEach(a => { allocatedPerAccount[a.account_id] = (allocatedPerAccount[a.account_id] ?? 0) + Number(a.amount); }); });
  const totalBalance = accounts.filter(a => a.type !== 'credit_card').reduce((s, a) => s + Number(a.balance), 0);
  const totalAllocated = Object.values(allocatedPerAccount).reduce((s, v) => s + v, 0);
  const totalUnallocated = Math.max(0, totalBalance - totalAllocated);
  const getDaysLeft = (deadline: string | null) => {
    if (!deadline) return null;
    return Math.ceil((new Date(deadline + 'T00:00:00').getTime() - Date.now()) / 86400000);
  };

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
          <div className="max-w-5xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-28 rounded-xl" />
            <div className="skeleton h-10 w-full rounded-xl" />
            <div className="skeleton h-36 w-full rounded-3xl" />
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[0,1,2,3].map(i => <div key={i} className="skeleton h-36 rounded-2xl" />)}
            </div>
          </div>
        </div>
      </>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'investments', label: 'Investments' },
    { id: 'assets', label: 'Assets' },
    { id: 'savings', label: 'Savings' },
  ];

  return (
    <>
      <Navigation />
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between pr-12 md:pr-0">
            <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Portfolio</h1>
            <div className="flex gap-2">
              {tab === 'investments' && (
                <button onClick={() => setShowAddInv(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                  + Investment
                </button>
              )}
              {tab === 'assets' && (
                <button onClick={() => setShowAddAsset(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                  + Asset
                </button>
              )}
              {tab === 'savings' && (
                <button onClick={() => setShowAddGoal(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                  + Goal
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="sticky top-0 z-20 py-2 -mx-4 px-4 md:-mx-6 md:px-6" style={{ backgroundColor: 'var(--bg)' }}>
            <div className="flex p-1 rounded-xl gap-0.5" style={{ backgroundColor: 'var(--elev-1)' }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-all"
                  style={tab === t.id
                    ? { backgroundColor: 'var(--bg)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                    : { color: 'var(--muted)' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── INVESTMENTS TAB ── */}
          {tab === 'investments' && (
            <>
              {/* Hero */}
              <div className="rounded-3xl p-6" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="label mb-1">Portfolio Value</p>
                    <p className="font-bold text-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '2.5rem', letterSpacing: '-1px' }}>
                      {priceKnown.length > 0 ? `$${fmt(totalCurrent)}` : `$${fmt(totalCost)}`}
                    </p>
                  </div>
                  {fetchingPrices ? (
                    <span className="text-xs text-muted flex items-center gap-1.5 mt-1">
                      <span className="w-1.5 h-1.5 rounded-full pulse-dot inline-block" style={{ backgroundColor: 'var(--accent)' }} />
                      Live prices…
                    </span>
                  ) : (
                    <button onClick={() => { localStorage.removeItem('stock_prices_cache'); localStorage.removeItem('stock_prices_cache_time'); fetchPricesBackground(investments, true); }}
                      className="text-xs mt-1 transition-colors"
                      style={{ color: 'var(--dim)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
                      ↻ Refresh
                    </button>
                  )}
                </div>
                <div className="flex gap-6 mt-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Invested</p>
                    <p className="font-semibold text-sm text-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>${fmt(totalCost)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Gain / Loss</p>
                    {totalGain != null ? (
                      <p className="font-semibold text-sm" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: totalGain >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {totalGain >= 0 ? '+' : '-'}${fmt(Math.abs(totalGain))}
                      </p>
                    ) : (
                      <p className="font-semibold text-sm text-muted" style={{ fontFamily: 'var(--font-mono)' }}>—</p>
                    )}
                  </div>
                </div>
              </div>

              {investments.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {types.map(t => (
                    <button key={t} onClick={() => setInvFilter(t)}
                      className="pill shrink-0 transition-all capitalize"
                      style={invFilter === t
                        ? { backgroundColor: 'oklch(72% 0.17 55 / 0.15)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.3)' }
                        : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                      {t}
                    </button>
                  ))}
                </div>
              )}

              {investments.length === 0 ? (
                <div className="card py-12 text-center">
                  <p className="text-3xl mb-3">📈</p>
                  <p className="font-semibold text-text mb-1">No investments yet</p>
                  <p className="text-sm text-muted mb-5">Track stocks, crypto, gold, ETFs, and more</p>
                  <button onClick={() => setShowAddInv(true)} className="btn-gradient px-6 py-2.5 text-sm">Add Investment</button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredInv.map(inv => {
                    const gainLoss = getGainLoss(inv);
                    const gainPct  = getGainLossPct(inv);
                    const livePx   = getLivePrice(inv);
                    const curVal   = getCurrentValue(inv);
                    const isGain   = (gainLoss ?? 0) >= 0;
                    const hasPx    = hasLivePrice(inv);
                    return (
                      <div key={inv.id} className="card card-hover p-4 group">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{TYPE_ICONS[inv.type] ?? '💰'}</span>
                            <div>
                              <p className="font-semibold text-sm text-text">{inv.name}</p>
                              <span className="text-[10px] px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: 'var(--line)', color: 'var(--muted)' }}>{inv.type}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasPx && gainPct != null ? (
                              <span className="text-xs font-bold" style={{ fontFamily: 'var(--font-mono)', color: isGain ? 'var(--pos)' : 'var(--neg)' }}>
                                {isGain ? '▲' : '▼'} {Math.abs(gainPct).toFixed(2)}%
                              </span>
                            ) : (
                              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: '#f59e0b' }}>fetching…</span>
                            )}
                            <button onClick={() => handleDeleteInv(inv.id, inv.name)}
                              className="opacity-0 group-hover:opacity-100 transition-all"
                              style={{ color: 'var(--dim)' }}
                              onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--neg)'}
                              onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--dim)'}>
                              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: 'Buy Price',  value: `$${Number(inv.value_per_unit ?? 0).toFixed(2)}` },
                            { label: hasPx ? 'Live Price' : 'Current', value: hasPx ? `$${(livePx!).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—', highlight: hasPx ? 'var(--fg)' : 'var(--muted)' },
                            { label: 'Quantity',   value: Number(inv.quantity ?? 0).toFixed(4) },
                            { label: 'Value',      value: hasPx ? `$${fmt(curVal)}` : '—', highlight: hasPx ? (isGain ? 'var(--pos)' : 'var(--neg)') : 'var(--muted)' },
                          ].map(stat => (
                            <div key={stat.label}>
                              <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">{stat.label}</p>
                              <p className="font-semibold text-sm" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: stat.highlight ?? 'var(--fg)' }}>{stat.value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between items-center mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                          <p className="text-xs text-muted">Cost: ${fmt(Number(inv.total_value))}</p>
                          {hasPx && gainLoss != null ? (
                            <p className="font-bold text-xs" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: isGain ? 'var(--pos)' : 'var(--neg)' }}>
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
            </>
          )}

          {/* ── ASSETS TAB ── */}
          {tab === 'assets' && (
            <>
              <div className="rounded-3xl p-6" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                <p className="label mb-1">Total Asset Value</p>
                <p className="font-mono font-bold text-text mb-3" style={{ fontSize: '2.5rem', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
                  ${fmt(totalAssetValue)}
                </p>
                {Object.keys(byType).length > 0 && (
                  <div className="flex flex-wrap gap-4">
                    {Object.entries(byType).map(([type, list]) => (
                      <div key={type}>
                        <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">{type.replace('_', ' ')}</p>
                        <p className="font-mono text-sm font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          ${fmt(list.reduce((s, a) => s + Number(a.total_value), 0))}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {assets.length === 0 ? (
                <EmptyState
                  iconPath="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"
                  iconColor="#a855f7"
                  title="No assets yet"
                  description="Track real estate, vehicles, jewelry, and other valuable items."
                  action={{ label: 'Add Asset', onClick: () => setShowAddAsset(true) }}
                />
              ) : (
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {assets.map(asset => {
                    const meta = ASSET_META[asset.type] ?? ASSET_META.other;
                    return (
                      <div key={asset.id} className="card card-hover p-4 group">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
                              <svg viewBox="0 0 20 20" fill={meta.color} className="w-5 h-5"><path d={meta.icon} /></svg>
                            </div>
                            <div>
                              <p className="font-semibold text-sm text-text">{asset.name}</p>
                              <span className="text-[10px] px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: 'var(--elev-sub)', color: meta.color }}>
                                {asset.type.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="font-mono font-bold text-lg text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(Number(asset.total_value))}</p>
                            <button onClick={() => handleDeleteAsset(asset.id, asset.name)}
                              className="opacity-0 group-hover:opacity-100 transition-all"
                              style={{ color: 'var(--dim)' }}
                              onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--neg)'}
                              onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--dim)'}>
                              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                            </button>
                          </div>
                        </div>
                        {(asset.quantity || asset.value_per_unit) && (
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            {asset.quantity && <div><p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">Quantity</p><p className="font-mono text-sm font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(asset.quantity).toLocaleString()}</p></div>}
                            {asset.value_per_unit && <div><p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">Value / Unit</p><p className="font-mono text-sm font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(asset.value_per_unit).toFixed(2)}</p></div>}
                          </div>
                        )}
                        {asset.purchase_date && (
                          <div className="pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                            <p className="text-xs text-muted">Acquired {asset.purchase_date}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── SAVINGS TAB ── */}
          {tab === 'savings' && (
            <>
              <div className="rounded-3xl p-6" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                <p className="label mb-1">Total Balance</p>
                <p className="font-mono font-bold text-text mb-3" style={{ fontSize: '2.5rem', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
                  ${fmt(totalBalance)}
                </p>
                <div className="flex gap-6 flex-wrap">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Allocated</p>
                    <p className="font-mono text-sm font-semibold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>${fmt(totalAllocated)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Unallocated</p>
                    <p className="font-mono text-sm font-semibold" style={{ color: 'var(--pos)', fontVariantNumeric: 'tabular-nums' }}>${fmt(totalUnallocated)}</p>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Account overview */}
                {accounts.filter(a => a.type !== 'credit_card').length > 0 && (
                  <div>
                    <p className="label mb-3">Accounts</p>
                    <div className="space-y-2">
                      {accounts.filter(a => a.type !== 'credit_card').map(account => {
                        const allocated = allocatedPerAccount[account.id] ?? 0;
                        const available = Math.max(0, Number(account.balance) - allocated);
                        const allocPct = Number(account.balance) > 0 ? (allocated / Number(account.balance)) * 100 : 0;
                        const color = TYPE_COLORS[account.type] ?? 'var(--accent)';
                        return (
                          <div key={account.id} className="card p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                <p className="font-semibold text-sm text-text">{account.name}</p>
                              </div>
                              <p className="font-mono font-bold text-sm text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(Number(account.balance))}</p>
                            </div>
                            {allocated > 0 && (
                              <>
                                <div className="w-full h-1.5 rounded-full overflow-hidden mb-1" style={{ backgroundColor: 'var(--line)' }}>
                                  <div className="h-full rounded-full" style={{ width: `${Math.min(allocPct, 100)}%`, backgroundColor: color }} />
                                </div>
                                <div className="flex justify-between text-xs text-muted">
                                  <span>${fmt(allocated)} allocated</span>
                                  <span style={{ color: available > 0 ? 'var(--pos)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>${fmt(available)} free</span>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Goals */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="label">Goals</p>
                    <button onClick={() => setShowAddGoal(true)} className="text-xs font-semibold transition-colors" style={{ color: 'var(--accent)' }}>+ New Goal</button>
                  </div>
                  {goals.length === 0 ? (
                    <div className="card py-10 text-center">
                      <p className="text-3xl mb-3">🎯</p>
                      <p className="font-semibold text-text mb-1">No savings goals</p>
                      <p className="text-sm text-muted mb-4">Set a target and allocate money from your accounts</p>
                      <button onClick={() => setShowAddGoal(true)} className="btn-gradient px-5 py-2 text-sm">Create First Goal</button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {goals.map(goal => {
                        const current = Number(goal.current_amount);
                        const target  = Number(goal.target_amount);
                        const progress = Math.min((current / target) * 100, 100);
                        const remaining = Math.max(target - current, 0);
                        const isComplete = progress >= 100;
                        const daysLeft = getDaysLeft(goal.deadline ?? null);
                        return (
                          <div key={goal.id} className="card p-4 group">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-semibold text-sm text-text">{goal.name}</p>
                                  {isComplete && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)' }}>Complete ✓</span>}
                                </div>
                                {daysLeft !== null && (
                                  <p className="text-xs mt-0.5" style={{ color: daysLeft < 30 ? 'var(--neg)' : 'var(--muted)' }}>
                                    {daysLeft > 0 ? `${daysLeft} days left` : daysLeft === 0 ? 'Due today' : 'Overdue'}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {goal.allocations.length > 0 && (
                                  <button onClick={() => setSpendGoal(goal)} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}>Spend</button>
                                )}
                                <button onClick={() => setEditGoal(goal)} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)' }}>Allocate</button>
                                <button onClick={() => handleDeleteGoal(goal.id, goal.name)} className="opacity-0 group-hover:opacity-100 transition-all" style={{ color: 'var(--dim)' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--neg)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
                                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                </button>
                              </div>
                            </div>
                            <div className="mb-3">
                              <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(current)} of ${fmt(target)}</span>
                                <span className="font-mono font-semibold" style={{ color: isComplete ? 'var(--pos)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{progress.toFixed(0)}%</span>
                              </div>
                              <ProgressBar value={progress} colorAuto height={6} showLabel={false} />
                            </div>
                            <div className="flex justify-between items-center">
                              <p className="text-xs text-muted">{isComplete ? '🎉 Goal reached!' : `$${fmt(remaining)} remaining`}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="h-4 md:hidden" />
        </div>
      </main>

      {/* FAB */}
      <button
        onClick={() => {
          if (tab === 'investments') setShowAddInv(true);
          else if (tab === 'assets') setShowAddAsset(true);
          else setShowAddGoal(true);
        }}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', backgroundColor: 'var(--accent)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAssetModal isOpen={showAddInv} onClose={() => setShowAddInv(false)} onSuccess={() => { localStorage.removeItem('stock_prices_cache'); localStorage.removeItem('stock_prices_cache_time'); load(); }} mode="investment" />
      <AddAssetModal isOpen={showAddAsset} onClose={() => setShowAddAsset(false)} onSuccess={load} mode="physical" />
      <AddSavingsGoalModal isOpen={showAddGoal} onClose={() => setShowAddGoal(false)} onSuccess={load} />
      <SpendFromGoalModal isOpen={!!spendGoal} onClose={() => setSpendGoal(null)} onSuccess={load} goal={spendGoal} />
      <ManageAllocationsModal isOpen={!!editGoal} onClose={() => setEditGoal(null)} onSuccess={load} goal={editGoal} allGoals={goals} accounts={accounts} />
    </>
  );
};

export default PortfolioPage;
