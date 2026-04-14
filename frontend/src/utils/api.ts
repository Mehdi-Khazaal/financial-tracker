import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000';

const api = axios.create({
  baseURL: API_URL,
});

// Add token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth endpoints
export const signup = (data: { email: string; username: string; password: string }) =>
  api.post('/auth/signup', data);

export const login = (data: { email: string; password: string }) =>
  api.post('/auth/login', data);

export const getCurrentUser = () => api.get('/auth/me');

// Accounts
export const getAccounts = () => api.get('/accounts/');
export const createAccount = (data: any) => api.post('/accounts/', data);
export const deleteAccount = (id: number) => api.delete(`/accounts/${id}`);

// Transactions
export const getTransactions = () => api.get('/transactions/');
export const createTransaction = (data: any) => api.post('/transactions/', data);
export const deleteTransaction = (id: number) => api.delete(`/transactions/${id}`);

// Categories
export const getCategories = () => api.get('/categories/');

// Assets
export const getAssets = () => api.get('/assets/');
export const createAsset = (data: any) => api.post('/assets/', data);
export const deleteAsset = (id: number) => api.delete(`/assets/${id}`);

export default api;