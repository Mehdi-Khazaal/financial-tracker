const ALPHA_VANTAGE_KEY = process.env.REACT_APP_ALPHA_VANTAGE_KEY || 'demo';

export const getStockPrice = async (symbol: string): Promise<number | null> => {
  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`
    );
    const data = await response.json();

    if (data.Note?.includes('API call frequency') || data.Information?.includes('API')) {
      console.warn(`Rate limit hit for ${symbol}, using mock price`);
      return getMockStockPrice(symbol);
    }

    if (data['Global Quote']?.['05. price']) {
      return parseFloat(data['Global Quote']['05. price']);
    }

    return getMockStockPrice(symbol);
  } catch {
    return getMockStockPrice(symbol);
  }
};

export const getMockStockPrice = (symbol: string): number => {
  const mockPrices: Record<string, number> = {
    AAPL: 211.45,
    GOOGL: 165.82,
    MSFT: 415.20,
    TSLA: 248.35,
    AMZN: 196.40,
    NVDA: 950.15,
    META: 510.75,
    NFLX: 648.90,
    AMD: 178.30,
    INTC: 38.45,
    BTC: 68000,
    ETH: 3200,
  };
  return mockPrices[symbol.toUpperCase()] ?? 100.0;
};
