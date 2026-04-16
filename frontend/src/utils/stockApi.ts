import api from './api';

export const getStockPrice = async (symbol: string): Promise<number | null> => {
  try {
    const res = await api.get(`/stocks/${symbol}`);
    return res.data.price ?? null;
  } catch {
    return null;
  }
};
