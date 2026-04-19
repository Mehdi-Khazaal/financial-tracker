import React, { useEffect, useState, useCallback } from 'react';
import { Asset } from '../types';
import { getAssets, deleteAsset } from '../utils/api';
import Navigation from '../components/Navigation';
import AddAssetModal from '../components/modals/AddAssetModal';
import EmptyState from '../components/EmptyState';
import PullToRefresh from '../components/PullToRefresh';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_META: Record<string, { icon: string; color: string }> = {
  real_estate: { icon: 'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z', color: 'var(--accent)' },
  vehicle:     { icon: 'M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H11a1 1 0 001-1v-1h2v1a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H17a1 1 0 001-1V8a1 1 0 00-.293-.707l-3-3A1 1 0 0014 4H3z', color: '#a855f7' },
  business:    { icon: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z', color: 'var(--pos)' },
  jewelry:     { icon: 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z', color: '#f59e0b' },
  art:         { icon: 'M4 3a2 2 0 100 4h12a2 2 0 100-4H4zm-2 6a1 1 0 011-1h14a1 1 0 110 2v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3a1 1 0 010-2z', color: 'var(--neg)' },
  other:       { icon: 'M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z', color: 'var(--muted)' },
};

const Assets: React.FC = () => {
  const toast = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAssets({ asset_class: 'physical' });
      setAssets(Array.isArray(res.data) ? res.data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

  const handleDelete = async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete "${name}"?`, { danger: true });
    if (!ok) return;
    try { await deleteAsset(id); load(); toast.success('Asset deleted'); }
    catch { toast.error('Failed to delete asset'); }
  };

  const totalValue = assets.reduce((s, a) => s + Number(a.total_value), 0);

  // Group by type
  const byType: Record<string, Asset[]> = {};
  assets.forEach(a => {
    if (!byType[a.type]) byType[a.type] = [];
    byType[a.type].push(a);
  });

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
          <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-24 rounded-xl" />
            <div className="skeleton h-36 w-full rounded-3xl" />
            {[0,1,2].map(i => <div key={i} className="skeleton h-24 rounded-2xl" />)}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Assets</h1>
              <p className="text-xs text-muted mt-0.5">{assets.length} item{assets.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="hidden md:block text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
              + Asset
            </button>
          </div>

          {/* Hero */}
          <div className="rounded-3xl p-6 relative overflow-hidden"
            style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
            <p className="label mb-1">Total Asset Value</p>
            <p className="font-mono font-bold text-text mb-3" style={{ fontSize: '2.5rem', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
              ${fmt(totalValue)}
            </p>
            {Object.keys(byType).length > 0 && (
              <div className="flex flex-wrap gap-3">
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

          {/* List */}
          {assets.length === 0 ? (
            <EmptyState
              iconPath="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"
              iconColor="#a855f7"
              title="No assets yet"
              description="Track real estate, vehicles, jewelry, and other valuable items."
              action={{ label: 'Add Asset', onClick: () => setShowAdd(true) }}
            />
          ) : (
            <div className="space-y-3">
              {assets.map(asset => {
                const meta = TYPE_META[asset.type] ?? TYPE_META.other;
                return (
                  <div key={asset.id} className="card card-hover p-4 group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                          style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
                          <svg viewBox="0 0 20 20" fill={meta.color} className="w-5 h-5"><path d={meta.icon} /></svg>
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-text">{asset.name}</p>
                          <span className="text-[10px] px-2 py-0.5 rounded-full capitalize"
                            style={{ backgroundColor: 'var(--elev-sub)', color: meta.color }}>
                            {asset.type.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-mono font-bold text-lg text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(Number(asset.total_value))}</p>
                        <button onClick={() => handleDelete(asset.id, asset.name)}
                          className="opacity-0 group-hover:opacity-100 text-[10px] transition-all"
                          style={{ color: 'var(--dim)' }}
                          onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--neg)'}
                          onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--dim)'}>
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                        </button>
                      </div>
                    </div>

                    {(asset.quantity || asset.value_per_unit) && (
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        {asset.quantity && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">Quantity</p>
                            <p className="font-mono text-sm font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(asset.quantity).toLocaleString()}</p>
                          </div>
                        )}
                        {asset.value_per_unit && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">Value / Unit</p>
                            <p className="font-mono text-sm font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(asset.value_per_unit).toFixed(2)}</p>
                          </div>
                        )}
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
        </div>
      </main>

      {/* FAB */}
      <button onClick={() => setShowAdd(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', backgroundColor: 'var(--accent)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAssetModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} mode="physical" />
    </>
  );
};

export default Assets;
