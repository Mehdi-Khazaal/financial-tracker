const ALPHA_VANTAGE_KEY = 'UY3UPYYD0SCWMRJQ'; // Replace with your actual key

// Better: Use QUOTE endpoint for real-time quotes
export const getStockPrice = async (symbol: string): Promise<number | null> => {
  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`
    );
    const data = await response.json();
    
    console.log(`API Response for ${symbol}:`, data);
    
    // Check if we hit the rate limit
    if (data.Note?.includes('API call frequency')) {
      console.warn('⚠️ API Rate limit hit. Free tier allows 25 requests/day, 5/minute.');
      return getMockStockPrice(symbol);
    }
    
    // Check for valid response
    if (data['Global Quote']?.['05. price']) {
      const price = parseFloat(data['Global Quote']['05. price']);
      console.log(`✅ Real price for ${symbol}: $${price}`);
      return price;
    }
    
    // Invalid symbol or other error
    if (data['Error Message']) {
      console.error(`❌ Invalid symbol: ${symbol}`);
      return getMockStockPrice(symbol);
    }
    
    console.warn(`⚠️ No data for ${symbol}, using mock`);
    return getMockStockPrice(symbol);
  } catch (error) {
    console.error(`❌ Fetch error for ${symbol}:`, error);
    return getMockStockPrice(symbol);
  }
};

// Alternative: Use TIME_SERIES_INTRADAY for more frequent updates (but burns API calls faster)
export const getStockPriceIntraday = async (symbol: string): Promise<number | null> => {
  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=5min&apikey=${ALPHA_VANTAGE_KEY}`
    );
    const data = await response.json();
    
    if (data['Time Series (5min)']) {
      const latestTime = Object.keys(data['Time Series (5min)'])[0];
      const price = parseFloat(data['Time Series (5min)'][latestTime]['4. close']);
      console.log(`✅ Intraday price for ${symbol}: $${price}`);
      return price;
    }
    
    return getMockStockPrice(symbol);
  } catch (error) {
    console.error('Intraday fetch error:', error);
    return getMockStockPrice(symbol);
  }
};

// Mock prices with recent real values (updated manually or fallback)
export const getMockStockPrice = (symbol: string): number => {
  const mockPrices: Record<string, number> = {
    'AAPL': 175.43,
    'GOOGL': 140.28,
    'MSFT': 384.37,
    'TSLA': 163.57,
    'AMZN': 178.25,
    'NVDA': 875.28,
    'META': 485.20,
    'NFLX': 615.30,
    'AMD': 162.15,
    'INTC': 43.20,
  };
  
  const price = mockPrices[symbol.toUpperCase()];
  console.log(`📊 Using mock price for ${symbol}: $${price || 100.00}`);
  return price || 100.00;
};