import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auth
export const signup = (data: { email: string; username: string; password: string }) =>
  api.post('/auth/signup', data);
export const login = (data: { email: string; password: string }) =>
  api.post('/auth/login', data);
export const getCurrentUser = () => api.get('/auth/me');

// Accounts
export const getAccounts = () => api.get('/accounts/');
export const createAccount = (data: object) => api.post('/accounts/', data);
export const updateAccount = (id: number, data: object) => api.put(`/accounts/${id}`, data);
export const deleteAccount = (id: number) => api.delete(`/accounts/${id}`);
export const getTotalBalance = () => api.get('/accounts/summary/total-balance');

// Transactions
export const getTransactions = () => api.get('/transactions/');
export const createTransaction = (data: object) => api.post('/transactions/', data);
export const updateTransaction = (id: number, data: object) => api.put(`/transactions/${id}`, data);
export const deleteTransaction = (id: number) => api.delete(`/transactions/${id}`);

// Categories
export const getCategories = () => api.get('/categories/');
export const createCategory = (data: { name: string; type: string; color: string }) =>
  api.post('/categories/', data);
export const deleteCategory = (id: number) => api.delete(`/categories/${id}`);

// Assets (investments + physical)
export const getAssets = () => api.get('/assets/');
export const createAsset = (data: object) => api.post('/assets/', data);
export const updateAsset = (id: number, data: object) => api.put(`/assets/${id}`, data);
export const deleteAsset = (id: number) => api.delete(`/assets/${id}`);

export default api;
