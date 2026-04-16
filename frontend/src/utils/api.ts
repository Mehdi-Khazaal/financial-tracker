import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000',
  withCredentials: true, // send httpOnly cookies automatically
});

// ── 401 → try refresh → retry once ───────────────────────────────────────────
let _refreshing: Promise<unknown> | null = null;

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retried && original.url !== '/auth/refresh') {
      original._retried = true;
      if (!_refreshing) {
        _refreshing = api.post('/auth/refresh').finally(() => { _refreshing = null; });
      }
      const PUBLIC = ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'];
      try {
        await _refreshing;
        return api(original);
      } catch {
        if (!PUBLIC.some(p => window.location.pathname.startsWith(p))) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login    = (identifier: string, password: string) =>
  api.post('/auth/login', { identifier, password });
export const signup   = (email: string, username: string, password: string) =>
  api.post('/auth/signup', { email, username, password });
export const getMe    = () => api.get('/auth/me');
export const logout   = () => api.post('/auth/logout');
export const forgotPassword = (email: string) =>
  api.post('/auth/forgot-password', { email });
export const resetPassword = (token: string, new_password: string) =>
  api.post('/auth/reset-password', { token, new_password });
export const verifyEmail = (token: string) =>
  api.get(`/auth/verify-email?token=${token}`);

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
export const getSavingsGoals      = () => api.get('/savings-goals/');
export const createSavingsGoal    = (data: any) => api.post('/savings-goals/', data);
export const updateSavingsGoal    = (id: number, data: any) => api.put(`/savings-goals/${id}`, data);
export const deleteSavingsGoal    = (id: number) => api.delete(`/savings-goals/${id}`);
export const setGoalAllocations   = (goalId: number, allocations: { account_id: number; amount: number }[]) =>
  api.put(`/savings-goals/${goalId}/allocations`, { allocations });

// ── Recurring Transactions ────────────────────────────────────────────────────
export const getRecurring     = () => api.get('/recurring/');
export const createRecurring  = (data: any) => api.post('/recurring/', data);
export const updateRecurring  = (id: number, data: any) => api.patch(`/recurring/${id}`, data);
export const deleteRecurring  = (id: number) => api.delete(`/recurring/${id}`);
export const processDueRecurring = () => api.post('/recurring/process-due');
export const logVariableRecurring = (id: number, amount: number, transaction_date?: string) =>
  api.post(`/recurring/${id}/log`, { amount, transaction_date });

// ── Loans ─────────────────────────────────────────────────────────────────────
export const getLoans    = () => api.get('/loans/');
export const createLoan  = (data: any) => api.post('/loans/', data);
export const updateLoan  = (id: number, data: any) => api.patch(`/loans/${id}`, data);
export const deleteLoan  = (id: number) => api.delete(`/loans/${id}`);

// ── History ───────────────────────────────────────────────────────────────────
export const getNetWorthHistory = (months = 12) => api.get(`/history/net-worth?months=${months}`);
export const getAccountHistory  = (id: number, months = 6) => api.get(`/history/account/${id}?months=${months}`);

export default api;
