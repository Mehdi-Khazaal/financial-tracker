const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000';

export const getStockPrice = async (symbol: string): Promise<number | null> => {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/stocks/${symbol}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.price ?? null;
  } catch {
    return null;
  }
};

export const getMockStockPrice = (symbol: string): number => {
  const mockPrices: Record<string, number> = {
    AAPL: 211.45, GOOGL: 165.82, MSFT: 415.20, TSLA: 248.35,
    AMZN: 196.40, NVDA: 950.15, META: 510.75, NFLX: 648.90,
    AMD: 178.30,  INTC: 38.45,
    BTC: 68000,   ETH: 3200,    BNB: 580,     SOL: 145,
  };
  return mockPrices[symbol.toUpperCase()] ?? 100.0;
};
