import axios from 'axios';

const api = axios.create({
  // Keep browser authentication same-origin. Production API traffic is
  // forwarded by Vercel, while setupProxy handles the same path locally.
  baseURL: '/api',
  withCredentials: true,
});

// Remove bearer tokens left by pre-cookie releases. Authentication now stays
// in HttpOnly cookies so page scripts cannot read or exfiltrate the session.
localStorage.removeItem('access_token');

// ── 401 → try refresh → retry once ───────────────────────────────────────────
let _refreshing: Promise<unknown> | null = null;

api.interceptors.response.use(
  res => {
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    if (contentType.includes('text/html')) {
      throw new Error(`API route returned HTML instead of data: ${res.config.url || 'unknown route'}`);
    }
    return res;
  },
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && original && !original._retried && original.url !== '/auth/refresh') {
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
export const login = (identifier: string, password: string) =>
  api.post('/auth/login', { identifier, password });
export const signup = (email: string, username: string, password: string) =>
  api.post('/auth/signup', { email, username, password });
export const getMe    = () => api.get('/auth/me');
export const logout   = () => api.post('/auth/logout');
export const changePassword = (current_password: string, new_password: string) =>
  api.post('/auth/change-password', { current_password, new_password });

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminGetUsers = () => api.get('/admin/users');
export const adminResetPassword = (userId: number) => api.post(`/admin/users/${userId}/reset-password`);

export const forgotPassword = (email: string) =>
  api.post('/auth/forgot-password', { email });
export const resetPassword = (token: string, new_password: string) =>
  api.post('/auth/reset-password', { token, new_password });
export const verifyEmail = (token: string) =>
  api.get(`/auth/verify-email?token=${token}`);

// ── Accounts ──────────────────────────────────────────────────────────────────
export const getAccounts    = () => api.get('/accounts');
export const createAccount  = (data: any) => api.post('/accounts', data);
export const updateAccount  = (id: number, data: any) => api.put(`/accounts/${id}`, data);
export const deleteAccount  = (id: number) => api.delete(`/accounts/${id}`);

// ── Categories ────────────────────────────────────────────────────────────────
export const getCategories   = () => api.get('/categories');
export const createCategory  = (data: any) => api.post('/categories', data);
export const updateCategory  = (id: number, data: any) => api.put(`/categories/${id}`, data);
export const deleteCategory  = (id: number) => api.delete(`/categories/${id}`);

// ── Transactions ──────────────────────────────────────────────────────────────
export const getTransactions   = (params?: Record<string, any>) =>
  api.get('/transactions', { params });
export const createTransaction = (data: any) => api.post('/transactions', data);
export const updateTransaction = (id: number, data: any) => api.put(`/transactions/${id}`, data);
export const deleteTransaction = (id: number) => api.delete(`/transactions/${id}`);

// ── Transfers ─────────────────────────────────────────────────────────────────
export const getTransfers   = () => api.get('/transfers');
export const createTransfer = (data: any) => api.post('/transfers', data);
export const deleteTransfer = (id: number) => api.delete(`/transfers/${id}`);

// ── Assets ────────────────────────────────────────────────────────────────────
export const getAssets   = (params?: Record<string, any>) => api.get('/assets', { params });
export const createAsset = (data: any) => api.post('/assets', data);
export const updateAsset = (id: number, data: any) => api.put(`/assets/${id}`, data);
export const deleteAsset = (id: number) => api.delete(`/assets/${id}`);

// ── Savings Goals ─────────────────────────────────────────────────────────────
export const getSavingsGoals      = () => api.get('/savings-goals');
export const createSavingsGoal    = (data: any) => api.post('/savings-goals', data);
export const updateSavingsGoal    = (id: number, data: any) => api.put(`/savings-goals/${id}`, data);
export const deleteSavingsGoal    = (id: number) => api.delete(`/savings-goals/${id}`);
export const setGoalAllocations   = (goalId: number, allocations: { account_id: number; amount: number }[]) =>
  api.put(`/savings-goals/${goalId}/allocations`, { allocations });
export const spendFromGoal = (goalId: number, data: { account_id: number; amount: number; description?: string; transaction_date: string }) =>
  api.post(`/savings-goals/${goalId}/spend`, data);

// ── Recurring Transactions ────────────────────────────────────────────────────
export const getRecurring     = () => api.get('/recurring');
export const createRecurring  = (data: any) => api.post('/recurring', data);
export const updateRecurring  = (id: number, data: any) => api.patch(`/recurring/${id}`, data);
export const deleteRecurring  = (id: number) => api.delete(`/recurring/${id}`);
export const processDueRecurring = () => api.post('/recurring/process-due');
export const logVariableRecurring = (id: number, amount: number, transaction_date?: string) =>
  api.post(`/recurring/${id}/log`, { amount, transaction_date });

// ── Loans ─────────────────────────────────────────────────────────────────────
export const getLoans    = () => api.get('/loans');
export const createLoan  = (data: any) => api.post('/loans', data);
export const updateLoan  = (id: number, data: any) => api.patch(`/loans/${id}`, data);
export const deleteLoan  = (id: number) => api.delete(`/loans/${id}`);

// ── History ───────────────────────────────────────────────────────────────────
export const getNetWorthHistory = (months = 12) => api.get(`/history/net-worth?months=${months}`);
export const getAccountHistory  = (id: number, months = 6) => api.get(`/history/account/${id}?months=${months}`);

// ── AI Assistant ──────────────────────────────────────────────────────────────
export type AssistantRole = 'user' | 'assistant';
export interface AssistantMessage { role: AssistantRole; content: string; created_at?: string; }
export interface AssistantConversation { id: number; title: string; updated_at: string; }
export interface AssistantPendingAction {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  action_token: string;
}
export interface AssistantMetric { label: string; value: number; format: 'currency' | 'number'; }
export interface AssistantVisualRow {
  id?: number;
  label: string;
  detail?: string;
  date?: string | null;
  value: number;
  share?: number;
  target?: number;
  currency?: string;
  income?: number;
  spending?: number;
}
export interface AssistantVisualBlock {
  type: 'metric_grid' | 'category_breakdown' | 'transaction_list' | 'progress_list' | 'account_list' | 'cashflow_trend';
  title: string;
  scope: string;
  source: string;
  total?: number;
  metrics?: AssistantMetric[];
  rows?: AssistantVisualRow[];
}
export interface AssistantChatResponse {
  conversation_id: number;
  title: string;
  reply: string;
  pending_actions: AssistantPendingAction[];
  visual_blocks: AssistantVisualBlock[];
}

export const assistantListConversations = () => api.get<AssistantConversation[]>('/assistant/conversations');
export const assistantGetConversation   = (id: number) => api.get<{ id: number; title: string; messages: AssistantMessage[] }>(`/assistant/conversations/${id}`);
export const assistantDeleteConversation = (id: number) => api.delete(`/assistant/conversations/${id}`);
export const assistantGetBriefing = () => api.get<{ as_of: string; blocks: AssistantVisualBlock[] }>('/assistant/briefing');
export const assistantChat = (message: string, conversation_id?: number | null, signal?: AbortSignal) =>
  api.post<AssistantChatResponse>('/assistant/chat', { message, conversation_id: conversation_id ?? null }, { signal });
export const assistantExecute = (action: AssistantPendingAction, conversation_id?: number | null) =>
  api.post<{ success: boolean; message: string }>('/assistant/execute', {
    tool: action.tool,
    input: action.input,
    action_token: action.action_token,
    conversation_id: conversation_id ?? null,
  });
export const assistantListMemories  = () => api.get('/assistant/memories');
export const assistantDeleteMemory  = (id: number) => api.delete(`/assistant/memories/${id}`);

// ── Plaid helpers ─────────────────────────────────────────────────────────────
export const cleanDescription = (desc: string | null | undefined): string => {
  if (!desc) return 'No note';
  return desc.replace(/^\[plaid:[^\]]+\]\s*/, '');
};

// ── Plaid ─────────────────────────────────────────────────────────────────────
export const plaidCreateLinkToken  = () => api.post('/plaid/link-token');
export const plaidExchangeToken    = (public_token: string, institution_name?: string) =>
  api.post('/plaid/exchange-token', { public_token, institution_name });
export const plaidGetItems         = () => api.get('/plaid/items');
export const plaidDeleteItem       = (id: number) => api.delete(`/plaid/items/${id}`);
export const plaidSyncAll          = () => api.post('/plaid/sync');
export const plaidReset            = () => api.post('/plaid/reset');

export default api;
