import React, { useEffect, useState, useCallback } from 'react';
import { useRouteTab } from '../context/TabContext';
import { Account, Asset, SavingsGoal } from '../types';
import { getAssets, deleteAsset, getAccounts, getSavingsGoals, deleteSavingsGoal } from '../utils/api';
import { getStockPrice } from '../utils/stockApi';
import { AppShell, PageLayout } from '../components/layout/AppShell';
import PullToRefresh from '../components/PullToRefresh';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import LoadErrorBanner from '../components/LoadErrorBanner';
import { Skeleton, AccountCardSkeleton } from '../components/Skeleton';
import { useToast } from '../context/ToastContext';
import { downloadCSV, printPDF } from '../utils/export';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import AddAssetModal from '../components/modals/AddAssetModal';
import AddSavingsGoalModal from '../components/modals/AddSavingsGoalModal';
import ManageAllocationsModal from '../components/modals/ManageAllocationsModal';
import SpendFromGoalModal from '../components/modals/SpendFromGoalModal';
import { describeGoal } from '../features/overview/calculations/goals';

type Tab = 'investments' | 'assets' | 'savings';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const INVESTMENT_META: Record<string, { icon: string; color: string }> = {
  stock:  { icon: 'M3 15.5l4.5-4.5 3 3L17 7.5M13 7.5h4v4', color: 'var(--pos)' },
  crypto: { icon: 'M10 3v14M7 3v14M6 6h5.5a2.5 2.5 0 010 5H6m0 0h6.25a2.5 2.5 0 010 5H6', color: '#f59e0b' },
  gold:   { icon: 'M6.5 14h7l-1.5-5h-4L6.5 14zM4 17h12l-1.5-3h-9L4 17z', color: '#f59e0b' },
  silver: { icon: 'M6.5 14h7l-1.5-5h-4L6.5 14zM4 17h12l-1.5-3h-9L4 17z', color: 'var(--muted)' },
  etf:    { icon: 'M4 16V9m4 7V5m4 11v-5m4 5V3', color: 'var(--accent)' },
  bond:   { icon: 'M5 4h10v12H5zM7.5 7h5M7.5 10h5M7.5 13h3', color: '#a855f7' },
  other:  { icon: 'M3 15l5-5 3 3 6-8M14 5h3v3', color: 'var(--muted)' },
};

const InvestmentTypeIcon: React.FC<{ type?: string; className?: string }> = ({ type = 'other', className = 'w-5 h-5' }) => {
  const meta = INVESTMENT_META[type] ?? INVESTMENT_META.other;
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      className={className} style={{ color: meta.color }} aria-hidden="true">
      <path d={meta.icon} />
    </svg>
  );
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
  const [tab, setTab] = useRouteTab('/portfolio');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [failedSources, setFailedSources] = useState<string[]>([]);

  // Investments
  const [investments, setInvestments] = useState<Asset[]>([]);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [invFilter, setInvFilter] = useState('all');
  const [showAddInv, setShowAddInv] = useState(false);
  const [showInvExport, setShowInvExport] = useState(false);

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
    setLoadError(false);
    setFailedSources([]);
    try {
      const results = await Promise.allSettled([
        getAssets({ asset_class: 'investment' }),
        getAssets({ asset_class: 'physical' }),
        getAccounts(),
        getSavingsGoals(),
      ]);
      const labels = ['investments', 'assets', 'accounts', 'savings goals'];
      const failed = labels.filter((_, index) => results[index].status === 'rejected');
      const investmentsResult = results[0];
      if (investmentsResult.status === 'fulfilled') {
        const invs: Asset[] = Array.isArray(investmentsResult.value.data) ? investmentsResult.value.data : [];
        setInvestments(invs);
        fetchPricesBackground(invs);
      }
      const assetsResult = results[1];
      if (assetsResult.status === 'fulfilled') {
        setAssets(Array.isArray(assetsResult.value.data) ? assetsResult.value.data : []);
      }
      const accountsResult = results[2];
      if (accountsResult.status === 'fulfilled') {
        setAccounts(Array.isArray(accountsResult.value.data) ? accountsResult.value.data : []);
      }
      const goalsResult = results[3];
      if (goalsResult.status === 'fulfilled') {
        setGoals(Array.isArray(goalsResult.value.data) ? goalsResult.value.data : []);
      }
      setFailedSources(failed);
      setLoadError(failed.length > 0);
    } catch {
      setFailedSources(['investments', 'assets', 'accounts', 'savings goals']);
      setLoadError(true);
    }
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

  const exportInvestments = (format: 'csv' | 'pdf') => {
    const headers = ['Name', 'Type', 'Quantity', 'Cost Basis', 'Current Value', 'Gain/Loss', 'Currency', 'Purchase Date'];
    const rows = investments.map(a => {
      const live = getLivePrice(a);
      const currVal = live != null ? getCurrentValue(a) : Number(a.total_value);
      const gl = live != null ? currVal - Number(a.total_value) : null;
      return [
        a.name,
        a.type,
        a.quantity != null ? String(a.quantity) : 'N/A',
        `$${fmt(Number(a.total_value))}`,
        `$${fmt(currVal)}`,
        gl != null ? `${gl >= 0 ? '+' : ''}$${fmt(gl)}` : 'N/A',
        a.currency,
        a.purchase_date ?? 'N/A',
      ];
    });
    if (format === 'csv') downloadCSV(`investments-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    else printPDF('Investments', headers, rows);
    setShowInvExport(false);
  };

  if (loading) {
    return (
      <AppShell>
        <PageLayout>
          <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5">
            <div
              className="rounded-xl p-5 space-y-3"
              style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
              aria-hidden="true"
            >
              <Skeleton h={9} w={110} />
              <Skeleton h={32} w="55%" />
              <div className="flex gap-6 pt-1">
                <div className="space-y-1.5"><Skeleton h={8} w={70} /><Skeleton h={12} w={80} /></div>
                <div className="space-y-1.5"><Skeleton h={8} w={70} /><Skeleton h={12} w={70} /></div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map(i => <AccountCardSkeleton key={i} />)}
            </div>
          </div>
        </PageLayout>
      </AppShell>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'investments', label: 'Investments' },
    { id: 'assets', label: 'Assets' },
    { id: 'savings', label: 'Savings' },
  ];

  return (
    <AppShell>
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <PageLayout>
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="product-page-header topbar-safe">
            <h1 className="product-page-title">Portfolio</h1>
            <div className="product-header-actions">
              {tab === 'investments' && (
                <>
                  {investments.length > 0 && (
                    <div className="relative">
                      <button onClick={() => setShowInvExport(v => !v)}
                        className="header-action"
                        aria-haspopup="menu" aria-expanded={showInvExport}>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        Export
                      </button>
                      {showInvExport && (
                        <>
                          <div className="menu-backdrop fixed inset-0" onClick={() => setShowInvExport(false)} />
                          <div className="menu-surface absolute right-0 top-12 min-w-[120px]" role="menu">
                            <button onClick={() => exportInvestments('csv')}
                              className="menu-item text-sm font-semibold" style={{ color: 'var(--pos)' }} role="menuitem">
                              CSV
                            </button>
                            <button onClick={() => exportInvestments('pdf')}
                              className="menu-item text-sm font-semibold border-t border-line" style={{ color: 'var(--neg)' }} role="menuitem">
                              PDF
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <button onClick={() => setShowAddInv(true)}
                    className="header-action header-action--primary">
                    + Investment
                  </button>
                </>
              )}
              {tab === 'assets' && (
                <button onClick={() => setShowAddAsset(true)}
                  className="header-action header-action--primary">
                  + Asset
                </button>
              )}
              {tab === 'savings' && (
                <button onClick={() => setShowAddGoal(true)}
                  className="header-action header-action--primary">
                  + Goal
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="hidden md:block sticky z-20 py-2 -mx-6 px-6" style={{ top: 0, backgroundColor: 'var(--bg)' }}>
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

          {loadError && <LoadErrorBanner message={`Some data could not be refreshed: ${failedSources.join(', ')}. Available tabs are still shown.`} onRetry={() => void load()} />}

          {/* Investments tab */}
          {tab === 'investments' && !failedSources.includes('investments') && (
            <>
              {/* Hero */}
              <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="label mb-1">Portfolio Value</p>
                    <p className="value-display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
                      {priceKnown.length > 0 ? `$${fmt(totalCurrent)}` : `$${fmt(totalCost)}`}
                    </p>
                  </div>
                  {fetchingPrices ? (
                    <span className="text-xs text-muted flex items-center gap-1.5 mt-1">
                      <span className="w-1.5 h-1.5 rounded-full pulse-dot inline-block" style={{ backgroundColor: 'var(--accent)' }} />
                      Live prices...
                    </span>
                  ) : (
                    <button onClick={() => { localStorage.removeItem('stock_prices_cache'); localStorage.removeItem('stock_prices_cache_time'); fetchPricesBackground(investments, true); }}
                      className="text-xs mt-1 transition-colors"
                      style={{ color: 'var(--dim)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
                      <span className="inline-flex items-center gap-1.5">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
                          <path d="M16 6V2m0 0h-4m4 0-3 3a6 6 0 10.7 8.5" />
                        </svg>
                        Refresh
                      </span>
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
                      <p className="font-semibold text-sm text-muted" style={{ fontFamily: 'var(--font-mono)' }}>--</p>
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
                  <div className="w-10 h-10 mx-auto mb-3 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--elev-sub)' }}>
                    <InvestmentTypeIcon type="stock" className="w-5 h-5" />
                  </div>
                  <p className="font-semibold text-text mb-1">No investments yet</p>
                  <p className="text-sm text-muted mb-5">Track stocks, crypto, gold, ETFs, and more</p>
                  <button onClick={() => setShowAddInv(true)} className="btn-gradient px-6 py-2.5 text-sm">Add Investment</button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
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
                            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--elev-sub)' }}>
                              <InvestmentTypeIcon type={inv.type} />
                            </span>
                            <div>
                              <p className="font-semibold text-sm text-text">{inv.name}</p>
                              <span className="text-[10px] px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: 'var(--line)', color: 'var(--muted)' }}>{inv.type}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasPx && gainPct != null ? (
                              <span className="text-xs font-bold" style={{ fontFamily: 'var(--font-mono)', color: isGain ? 'var(--pos)' : 'var(--neg)' }}>
                                {isGain ? '+' : '-'}{Math.abs(gainPct).toFixed(2)}%
                              </span>
                            ) : (
                              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: fetchingPrices ? '#f59e0b' : 'var(--muted)' }}>
                                {fetchingPrices ? 'Fetching...' : 'No live price'}
                              </span>
                            )}
                            <button onClick={() => handleDeleteInv(inv.id, inv.name)}
                              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all"
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
                            { label: hasPx ? 'Live Price' : 'Current', value: hasPx ? `$${(livePx!).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '--', highlight: hasPx ? 'var(--fg)' : 'var(--muted)' },
                            { label: 'Quantity',   value: Number(inv.quantity ?? 0).toFixed(4) },
                            { label: 'Value',      value: hasPx ? `$${fmt(curVal)}` : '--', highlight: hasPx ? (isGain ? 'var(--pos)' : 'var(--neg)') : 'var(--muted)' },
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

          {/* Assets tab */}
          {tab === 'assets' && !failedSources.includes('assets') && (
            <>
              <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                <p className="label mb-1">Total Asset Value</p>
                <p className="value-display mb-3" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
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
                <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
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
                              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all"
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

          {/* Savings tab */}
          {tab === 'savings' && !failedSources.some(source => source === 'accounts' || source === 'savings goals') && (
            <>
              <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                <p className="label mb-1">Total Balance</p>
                <p className="value-display mb-3" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
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
                      <div className="w-10 h-10 mx-auto mb-3 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--accent)' }}>
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-5 h-5" aria-hidden="true">
                          <circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /><path d="M10 1v3M19 10h-3" />
                        </svg>
                      </div>
                      <p className="font-semibold text-text mb-1">No savings goals</p>
                      <p className="text-sm text-muted mb-4">Set a target and allocate money from your accounts</p>
                      <button onClick={() => setShowAddGoal(true)} className="btn-gradient px-5 py-2 text-sm">Create First Goal</button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {goals.map(goal => {
                        const current = Number(goal.current_amount);
                        const target  = Number(goal.target_amount);
                        // Shared with the Overview goal list, so a completed
                        // goal reads the same green in both places.
                        const status = describeGoal(goal, new Date());
                        const progress = status.progress;
                        const remaining = Math.max(target - current, 0);
                        const isComplete = status.status === 'complete';
                        const daysLeft = getDaysLeft(goal.deadline ?? null);
                        return (
                          <div key={goal.id} className="card p-4 group">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-semibold text-sm text-text">{goal.name}</p>
                                  {isComplete && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)' }}>Complete</span>}
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
                                <button onClick={() => handleDeleteGoal(goal.id, goal.name)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all" style={{ color: 'var(--dim)' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--neg)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
                                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                </button>
                              </div>
                            </div>
                            <div className="mb-3">
                              <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(current)} of ${fmt(target)}</span>
                                <span className="font-mono font-semibold" style={{ color: status.color, fontVariantNumeric: 'tabular-nums' }}>{progress.toFixed(0)}%</span>
                              </div>
                              <ProgressBar value={progress} colorAuto semantics="progress" height={6} showLabel={false} />
                            </div>
                            <div className="flex justify-between items-center">
                              <p className="text-xs text-muted">{isComplete ? 'Goal reached' : `$${fmt(remaining)} remaining`}</p>
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
      </PageLayout>



      <AddAssetModal isOpen={showAddInv} onClose={() => setShowAddInv(false)} onSuccess={() => { localStorage.removeItem('stock_prices_cache'); localStorage.removeItem('stock_prices_cache_time'); load(); }} mode="investment" />
      <AddAssetModal isOpen={showAddAsset} onClose={() => setShowAddAsset(false)} onSuccess={load} mode="physical" />
      <AddSavingsGoalModal isOpen={showAddGoal} onClose={() => setShowAddGoal(false)} onSuccess={load} />
      <SpendFromGoalModal isOpen={!!spendGoal} onClose={() => setSpendGoal(null)} onSuccess={load} goal={spendGoal} />
      <ManageAllocationsModal isOpen={!!editGoal} onClose={() => setEditGoal(null)} onSuccess={load} goal={editGoal} allGoals={goals} accounts={accounts} />
    </AppShell>
  );
};

export default PortfolioPage;
