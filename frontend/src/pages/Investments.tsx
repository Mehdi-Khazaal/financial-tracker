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
  const [showAddInvestment, setShowAddInvestment] = useState(false);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    loadInvestments();
  }, []);

const loadInvestments = async () => {
  try {
    const response = await getAssets();
    const assets = response.data;
    setInvestments(assets);

    // Check if we have cached prices (within last 5 minutes)
    const cachedPrices = localStorage.getItem('stock_prices_cache');
    const cacheTime = localStorage.getItem('stock_prices_cache_time');
    const now = Date.now();
    
    if (cachedPrices && cacheTime && (now - parseInt(cacheTime)) < 5 * 60 * 1000) {
      console.log('📦 Using cached stock prices');
      setStockPrices(JSON.parse(cachedPrices));
      return;
    }

    // Fetch new prices (be careful with rate limits!)
    const prices: Record<string, number> = {};
    const stockAssets = assets.filter(a => a.type === 'stock');
    
    console.log(`🔄 Fetching prices for ${stockAssets.length} stocks...`);
    
    for (const asset of stockAssets) {
      const match = asset.name.match(/\(([A-Z]+)\)/);
      if (match) {
        const symbol = match[1];
        const price = await getStockPrice(symbol);
        prices[symbol] = price || getMockStockPrice(symbol);
        
        // Rate limit: Wait 13 seconds between calls (5 calls/min = 12s + buffer)
        if (stockAssets.indexOf(asset) < stockAssets.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 13000));
        }
      }
    }
    
    setStockPrices(prices);
    
    // Cache for 5 minutes
    localStorage.setItem('stock_prices_cache', JSON.stringify(prices));
    localStorage.setItem('stock_prices_cache_time', now.toString());
    
  } catch (error) {
    console.error('Failed to load investments:', error);
  } finally {
    setLoading(false);
  }
};

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;

    try {
      await deleteAsset(id);
      loadInvestments();
    } catch (error) {
      console.error('Failed to delete investment:', error);
      alert('Failed to delete investment');
    }
  };

  const getSymbolFromName = (name: string): string | null => {
    const match = name.match(/\(([A-Z]+)\)/);
    return match ? match[1] : null;
  };

  const getCurrentPrice = (asset: Asset): number => {
    const symbol = getSymbolFromName(asset.name);
    return symbol && stockPrices[symbol] ? stockPrices[symbol] : Number(asset.value_per_unit);
  };

  const getCurrentValue = (asset: Asset): number => {
    return getCurrentPrice(asset) * Number(asset.quantity);
  };

  const getGainLoss = (asset: Asset): number => {
    const currentValue = getCurrentValue(asset);
    const purchaseValue = Number(asset.total_value);
    return currentValue - purchaseValue;
  };

  const getGainLossPercent = (asset: Asset): number => {
    const gainLoss = getGainLoss(asset);
    const purchaseValue = Number(asset.total_value);
    return (gainLoss / purchaseValue) * 100;
  };

  const totalInvestmentValue = investments.reduce((sum, inv) => sum + getCurrentValue(inv), 0);
  const totalGainLoss = investments.reduce((sum, inv) => sum + getGainLoss(inv), 0);
  const totalPurchaseValue = investments.reduce((sum, inv) => sum + Number(inv.total_value), 0);

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
          <h1 className="text-4xl font-bold text-primary mb-8">Investments</h1>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Total Value</p>
              <p className="text-3xl font-bold text-primary">${totalInvestmentValue.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Total Invested</p>
              <p className="text-3xl font-bold text-navy">${totalPurchaseValue.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Total Gain/Loss</p>
              <p className={`text-3xl font-bold ${totalGainLoss >= 0 ? 'text-lime' : 'text-accent'}`}>
                {totalGainLoss >= 0 ? '+' : ''}${totalGainLoss.toFixed(2)}
              </p>
              <p className={`text-sm ${totalGainLoss >= 0 ? 'text-lime' : 'text-accent'}`}>
                {totalGainLoss >= 0 ? '+' : ''}{totalPurchaseValue > 0 ? ((totalGainLoss / totalPurchaseValue) * 100).toFixed(2) : 0}%
              </p>
            </div>
          </div>

          {/* Investments List */}
          {investments.length === 0 ? (
            <div className="bg-white rounded-lg p-12 text-center">
              <p className="text-xl text-gray mb-6">No investments yet</p>
              <button
                onClick={() => setShowAddInvestment(true)}
                className="bg-primary text-white px-8 py-3 rounded-lg hover:opacity-90"
              >
                Add Your First Investment
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {investments.map(investment => {
                const currentPrice = getCurrentPrice(investment);
                const gainLoss = getGainLoss(investment);
                const gainLossPercent = getGainLossPercent(investment);

                return (
                  <div key={investment.id} className="bg-white rounded-lg p-6 shadow hover:shadow-lg transition">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-navy mb-1">{investment.name}</h3>
                        <span className="text-xs bg-peach text-navy px-2 py-1 rounded capitalize">
                          {investment.type}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDelete(investment.id, investment.name)}
                        className="px-3 py-1 bg-accent text-white text-sm rounded hover:opacity-90"
                      >
                        Delete
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray">Quantity:</span>
                        <span className="font-medium text-navy">{Number(investment.quantity).toFixed(4)}</span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-gray">Purchase Price:</span>
                        <span className="font-medium text-navy">${Number(investment.value_per_unit).toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-gray">Current Price:</span>
                        <span className="font-medium text-primary">${currentPrice.toFixed(2)}</span>
                      </div>

                      <div className="border-t border-beige pt-3">
                        <div className="flex justify-between mb-2">
                          <span className="text-gray">Total Invested:</span>
                          <span className="font-medium text-navy">${Number(investment.total_value).toFixed(2)}</span>
                        </div>

                        <div className="flex justify-between mb-2">
                          <span className="text-gray">Current Value:</span>
                          <span className="font-bold text-primary">${getCurrentValue(investment).toFixed(2)}</span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-gray">Gain/Loss:</span>
                          <div className="text-right">
                            <p className={`font-bold ${gainLoss >= 0 ? 'text-lime' : 'text-accent'}`}>
                              {gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)}
                            </p>
                            <p className={`text-sm ${gainLoss >= 0 ? 'text-lime' : 'text-accent'}`}>
                              {gainLoss >= 0 ? '+' : ''}{gainLossPercent.toFixed(2)}%
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="text-xs text-gray pt-2 border-t border-beige">
                        Purchased: {investment.purchase_date || 'N/A'}
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
        onAddAccount={() => {}}
        onAddTransaction={() => setShowAddInvestment(true)}
      />

      <AddInvestmentModal
        isOpen={showAddInvestment}
        onClose={() => setShowAddInvestment(false)}
        onSuccess={loadInvestments}
      />
    </>
  );
};

export default Investments;