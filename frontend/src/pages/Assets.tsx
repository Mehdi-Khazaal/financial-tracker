import React, { useEffect, useState } from 'react';
import { Asset } from '../types';
import { getAssets, deleteAsset } from '../utils/api';
import Navigation from '../components/Navigation';
import AddAssetModal from '../components/modals/AddAssetModal';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_ICONS: Record<string, string> = {
  real_estate: '🏠', vehicle: '🚗', business: '💼', jewelry: '💎', art: '🖼️', other: '📦',
};

const TYPE_COLORS: Record<string, string> = {
  real_estate: '#5b8fff', vehicle: '#a78bfa', business: '#2ecc8a',
  jewelry: '#f5a623', art: '#ff5f6d', other: '#7880a0',
};

const Assets: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getAssets({ asset_class: 'physical' });
      setAssets(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try { await deleteAsset(id); load(); }
    catch { alert('Failed to delete'); }
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
              <h1 className="text-xl font-bold text-text">Assets</h1>
              <p className="text-xs text-muted mt-0.5">{assets.length} item{assets.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="hidden md:block text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: '#181c28', border: '1px solid #252a3a', color: '#7880a0' }}>
              + Asset
            </button>
          </div>

          {/* Hero */}
          <div className="rounded-3xl p-6 relative overflow-hidden"
            style={{ background: 'linear-gradient(145deg, #11141c, #181c28)', border: '1px solid #252a3a' }}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-15 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #a78bfa, transparent)' }} />
            <p className="label mb-1">Total Asset Value</p>
            <p className="font-mono font-bold text-text mb-3" style={{ fontSize: '2.5rem', letterSpacing: '-1px' }}>
              ${fmt(totalValue)}
            </p>
            {Object.keys(byType).length > 0 && (
              <div className="flex flex-wrap gap-3">
                {Object.entries(byType).map(([type, list]) => (
                  <div key={type}>
                    <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">{type.replace('_', ' ')}</p>
                    <p className="font-mono text-sm font-semibold text-text">
                      ${fmt(list.reduce((s, a) => s + Number(a.total_value), 0))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* List */}
          {assets.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-3xl mb-3">🏠</p>
              <p className="font-semibold text-text mb-1">No assets yet</p>
              <p className="text-sm text-muted mb-5">Track real estate, vehicles, jewelry, and other valuables</p>
              <button onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">Add Asset</button>
            </div>
          ) : (
            <div className="space-y-3">
              {assets.map(asset => {
                const color = TYPE_COLORS[asset.type] ?? '#7880a0';
                return (
                  <div key={asset.id} className="card card-hover p-4 group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl"
                          style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}>
                          {TYPE_ICONS[asset.type] ?? '📦'}
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-text">{asset.name}</p>
                          <span className="text-[10px] px-2 py-0.5 rounded-full capitalize"
                            style={{ backgroundColor: `${color}15`, color }}>
                            {asset.type.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-mono font-bold text-lg text-text">${fmt(Number(asset.total_value))}</p>
                        <button onClick={() => handleDelete(asset.id, asset.name)}
                          className="opacity-0 group-hover:opacity-100 text-[10px] transition-all"
                          style={{ color: '#3e4460' }}
                          onMouseEnter={e => (e.target as HTMLElement).style.color = '#ff5f6d'}
                          onMouseLeave={e => (e.target as HTMLElement).style.color = '#3e4460'}>
                          ✕
                        </button>
                      </div>
                    </div>

                    {(asset.quantity || asset.value_per_unit) && (
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        {asset.quantity && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">Quantity</p>
                            <p className="font-mono text-sm font-semibold text-text">{Number(asset.quantity).toLocaleString()}</p>
                          </div>
                        )}
                        {asset.value_per_unit && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-muted mb-0.5">Value / Unit</p>
                            <p className="font-mono text-sm font-semibold text-text">${Number(asset.value_per_unit).toFixed(2)}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {asset.purchase_date && (
                      <div className="pt-3" style={{ borderTop: '1px solid #252a3a' }}>
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
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #a78bfa, #5b8fff)', boxShadow: '0 8px 32px rgba(167,139,250,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAssetModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} mode="physical" />
    </>
  );
};

export default Assets;
