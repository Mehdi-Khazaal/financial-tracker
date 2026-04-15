import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000',
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login    = (identifier: string, password: string) =>
  api.post('/auth/login', { identifier, password });
export const signup   = (email: string, username: string, password: string) =>
  api.post('/auth/signup', { email, username, password });
export const getMe    = () => api.get('/auth/me');

// ── Accounts ──────────────────────────────────────────────────────────────────
export const getAccounts    = () => api.get('/accounts/');
export const createAccount  = (data: any) => api.post('/accounts/', data);
export const updateAccount  = (id: number, data: any) => api.put(`/accounts/${id}`, data);
export const deleteAccount  = (id: number) => api.delete(`/accounts/${id}`);

// ── Categories ────────────────────────────────────────────────────────────────
export const getCategories   = () => api.get('/categories/');
export const createCategory  = (data: any) => api.post('/categories/', data);
export const updateCategory  = (id: number, data: any) => api.put(`/categories/${id}`, data);
export const deleteCategory  = (id: number) => api.delete(`/categories/${id}`);

// ── Transactions ──────────────────────────────────────────────────────────────
export const getTransactions   = (params?: Record<string, any>) =>
  api.get('/transactions/', { params });
export const createTransaction = (data: any) => api.post('/transactions/', data);
export const updateTransaction = (id: number, data: any) => api.put(`/transactions/${id}`, data);
export const deleteTransaction = (id: number) => api.delete(`/transactions/${id}`);

// ── Transfers ─────────────────────────────────────────────────────────────────
export const getTransfers   = () => api.get('/transfers/');
export const createTransfer = (data: any) => api.post('/transfers/', data);
export const deleteTransfer = (id: number) => api.delete(`/transfers/${id}`);

// ── Assets ────────────────────────────────────────────────────────────────────
export const getAssets   = (params?: Record<string, any>) => api.get('/assets/', { params });
export const createAsset = (data: any) => api.post('/assets/', data);
export const updateAsset = (id: number, data: any) => api.put(`/assets/${id}`, data);
export const deleteAsset = (id: number) => api.delete(`/assets/${id}`);

// ── Savings Goals ─────────────────────────────────────────────────────────────
export const getSavingsGoals   = () => api.get('/savings-goals/');
export const createSavingsGoal = (data: any) => api.post('/savings-goals/', data);
export const updateSavingsGoal = (id: number, data: any) => api.put(`/savings-goals/${id}`, data);
export const deleteSavingsGoal = (id: number) => api.delete(`/savings-goals/${id}`);

// ── Recurring Transactions ────────────────────────────────────────────────────
export const getRecurring     = () => api.get('/recurring/');
export const createRecurring  = (data: any) => api.post('/recurring/', data);
export const updateRecurring  = (id: number, data: any) => api.patch(`/recurring/${id}`, data);
export const deleteRecurring  = (id: number) => api.delete(`/recurring/${id}`);
export const processDueRecurring = () => api.post('/recurring/process-due');

// ── Loans ─────────────────────────────────────────────────────────────────────
export const getLoans    = () => api.get('/loans/');
export const createLoan  = (data: any) => api.post('/loans/', data);
export const updateLoan  = (id: number, data: any) => api.patch(`/loans/${id}`, data);
export const deleteLoan  = (id: number) => api.delete(`/loans/${id}`);

// ── History ───────────────────────────────────────────────────────────────────
export const getNetWorthHistory     = (months = 12) => api.get(`/history/net-worth?months=${months}`);
export const getAccountHistory      = (id: number, months = 6) => api.get(`/history/account/${id}?months=${months}`);

export default api;
