import React, { useEffect, useState } from 'react';
import { Asset } from '../types';
import { getAssets, deleteAsset } from '../utils/api';
import Navigation from '../components/Navigation';
import FloatingAddButton from '../components/FloatingAddButton';
import AddInvestmentModal from '../components/AddInvestmentModal';

const INVESTMENT_TYPES = ['stock', 'crypto', 'gold', 'silver', 'bond', 'etf'];

const Assets: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { loadAssets(); }, []);

  const loadAssets = async () => {
    setLoading(true);
    try {
      const res = await getAssets();
      const physical = (res.data as Asset[]).filter((a) => !INVESTMENT_TYPES.includes(a.type));
      setAssets(physical);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await deleteAsset(id);
      loadAssets();
    } catch {
      alert('Failed to delete asset');
    }
  };

  const totalValue = assets.reduce((s, a) => s + Number(a.total_value), 0);

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
            <h1 className="text-3xl font-bold text-navy">Physical Assets</h1>
            <button
              onClick={() => setShowAdd(true)}
              className="hidden md:flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition"
            >
              + Add Asset
            </button>
          </div>

          {/* Total value card */}
          <div className="bg-primary text-white rounded-2xl p-6 mb-8">
            <p className="text-white text-opacity-70 text-sm mb-1">Total Asset Value</p>
            <p className="text-4xl font-bold">${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-white text-opacity-60 text-sm mt-2">{assets.length} asset{assets.length !== 1 ? 's' : ''}</p>
          </div>

          {assets.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
              <p className="text-5xl mb-4">🏠</p>
              <p className="text-xl font-bold text-navy mb-2">No physical assets yet</p>
              <p className="text-gray mb-6">Track real estate, vehicles, jewelry, and other valuables</p>
              <button onClick={() => setShowAdd(true)} className="bg-primary text-white px-8 py-3 rounded-xl font-medium hover:opacity-90">
                Add First Asset
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {assets.map((asset) => (
                <div key={asset.id} className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-md transition-shadow group">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-xs bg-beige text-navy px-3 py-1 rounded-full capitalize font-medium">
                      {asset.type.replace('_', ' ')}
                    </span>
                    <button
                      onClick={() => handleDelete(asset.id, asset.name)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-accent hover:underline transition-opacity"
                    >
                      Delete
                    </button>
                  </div>

                  <h3 className="font-bold text-navy text-lg mb-3">{asset.name}</h3>

                  <div className="space-y-2">
                    {asset.quantity && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray">Quantity</span>
                        <span className="font-medium text-navy">{Number(asset.quantity).toLocaleString()}</span>
                      </div>
                    )}
                    {asset.value_per_unit && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray">Value / unit</span>
                        <span className="font-medium text-navy">${Number(asset.value_per_unit).toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center">
                    <p className="text-xs text-gray">{asset.currency}</p>
                    <p className="text-xl font-bold text-primary">
                      ${Number(asset.total_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>

                  {asset.purchase_date && (
                    <p className="text-xs text-gray mt-2">Acquired: {asset.purchase_date}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <FloatingAddButton
        actions={[{ label: 'Add Asset', icon: '🏠', color: '#1F422C', onClick: () => setShowAdd(true) }]}
      />

      <AddInvestmentModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={loadAssets}
        mode="asset"
      />
    </>
  );
};

export default Assets;
