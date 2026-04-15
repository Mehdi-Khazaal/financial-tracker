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
