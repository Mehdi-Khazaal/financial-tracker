import React, { useEffect, useState } from 'react';
import { Asset } from '../types';
import { getAssets, deleteAsset } from '../utils/api';
import Navigation from '../components/Navigation';
import FloatingAddButton from '../components/FloatingAddButton';
import AddInvestmentModal from '../components/AddInvestmentModal';

const Assets: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddAsset, setShowAddAsset] = useState(false);

  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    try {
      const response = await getAssets();
      // Filter out investment types (stocks, crypto, etc) - show only physical assets
      const physicalAssets = response.data.filter(a => 
        !['stock', 'crypto', 'bond'].includes(a.type)
      );
      setAssets(physicalAssets);
    } catch (error) {
      console.error('Failed to load assets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;

    try {
      await deleteAsset(id);
      loadAssets();
    } catch (error) {
      console.error('Failed to delete asset:', error);
      alert('Failed to delete asset');
    }
  };

  const totalValue = assets.reduce((sum, asset) => sum + Number(asset.total_value), 0);

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-xl text-primary">Loading...</div>
    </div>;
  }

  return (
    <>
      <Navigation />
      
      <div className="md:ml-64 min-h-screen bg-beige pb-20 md:pb-8">
        <div className="p-4 md:p-8">
          <h1 className="text-4xl font-bold text-primary mb-8">Physical Assets</h1>

          {/* Total Value Card */}
          <div className="bg-primary text-white rounded-lg p-6 mb-8 shadow-lg">
            <h2 className="text-lg opacity-90 mb-2">Total Asset Value</h2>
            <p className="text-5xl font-bold">${totalValue.toFixed(2)}</p>
          </div>

          {/* Assets Grid */}
          {assets.length === 0 ? (
            <div className="bg-white rounded-lg p-12 text-center">
              <p className="text-xl text-gray mb-6">No physical assets tracked yet</p>
              <button
                onClick={() => setShowAddAsset(true)}
                className="bg-primary text-white px-8 py-3 rounded-lg hover:opacity-90"
              >
                Add Your First Asset
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {assets.map(asset => (
                <div key={asset.id} className="bg-white rounded-lg p-6 shadow hover:shadow-lg transition">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-navy mb-2">{asset.name}</h3>
                      <span className="text-xs bg-peach text-navy px-3 py-1 rounded-full capitalize">
                        {asset.type}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDelete(asset.id, asset.name)}
                      className="px-3 py-1 bg-accent text-white text-sm rounded hover:opacity-90"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="space-y-3 mb-4">
                    {asset.quantity && (
                      <div className="flex justify-between">
                        <span className="text-gray">Quantity:</span>
                        <span className="font-medium text-navy">{Number(asset.quantity).toFixed(2)}</span>
                      </div>
                    )}

                    {asset.value_per_unit && (
                      <div className="flex justify-between">
                        <span className="text-gray">Value per Unit:</span>
                        <span className="font-medium text-navy">${Number(asset.value_per_unit).toFixed(2)}</span>
                      </div>
                    )}

                    <div className="flex justify-between pt-3 border-t border-beige">
                      <span className="text-gray font-medium">Total Value:</span>
                      <span className="text-2xl font-bold text-primary">${Number(asset.total_value).toFixed(2)}</span>
                    </div>

                    <div className="text-sm text-gray">
                      {asset.currency}
                    </div>
                  </div>

                  {asset.purchase_date && (
                    <div className="text-xs text-gray pt-3 border-t border-beige">
                      Acquired: {asset.purchase_date}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <FloatingAddButton
        onAddAccount={() => {}}
        onAddTransaction={() => setShowAddAsset(true)}
      />

      <AddInvestmentModal
        isOpen={showAddAsset}
        onClose={() => setShowAddAsset(false)}
        onSuccess={loadAssets}
      />
    </>
  );
};

export default Assets;