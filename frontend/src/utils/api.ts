import axios from 'axios';
import { Account, Category, Transaction, Asset } from '../types';

const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Accounts
export const getAccounts = () => api.get<Account[]>('/accounts/');
export const createAccount = (data: Omit<Account, 'id' | 'created_at' | 'updated_at'>) => 
  api.post<Account>('/accounts/', data);
export const updateAccount = (id: number, data: Partial<Account>) => 
  api.put<Account>(`/accounts/${id}`, data);
export const deleteAccount = (id: number) => api.delete(`/accounts/${id}`);

// Categories
export const getCategories = () => api.get<Category[]>('/categories/');

// Transactions
export const getTransactions = () => api.get<Transaction[]>('/transactions/');
export const createTransaction = (data: Omit<Transaction, 'id' | 'created_at'>) => 
  api.post<Transaction>('/transactions/', data);
export const updateTransaction = (id: number, data: Partial<Transaction>) => 
api.put<Transaction>(`/transactions/${id}`, data);
export const deleteTransaction = (id: number) => api.delete(`/transactions/${id}`);

// Assets
export const getAssets = () => api.get<Asset[]>('/assets/');
export const createAsset = (data: Omit<Asset, 'id' | 'created_at' | 'updated_at'>) => 
  api.post<Asset>('/assets/', data);
export const deleteAsset = (id: number) => api.delete(`/assets/${id}`);

export default api;