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

// ── Idempotency-Key on writes ────────────────────────────────────────────────
// The server caches every (user, key) → response for 24h. If the same POST /
// PUT / PATCH / DELETE is retried — network flake, offline queue drain, double
// tap on Save — the response is replayed instead of executing the write again.
// Callers can override by setting `Idempotency-Key` in the config, which is
// how the offline queue keeps the same key across retries.
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

function newIdempotencyKey(): string {
  const g: Crypto | undefined = (typeof crypto !== 'undefined' ? crypto : undefined);
  if (g && typeof g.randomUUID === 'function') return g.randomUUID();
  // RFC 4122 v4 fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

api.interceptors.request.use(config => {
  const method = String(config.method || 'get').toLowerCase();
  if (WRITE_METHODS.has(method)) {
    config.headers = config.headers || {};
    if (!config.headers['Idempotency-Key']) {
      config.headers['Idempotency-Key'] = newIdempotencyKey();
    }
  }
  return config;
});

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

/**
 * Every transaction, not just the first page.
 *
 * `GET /transactions` defaults to 500 rows and caps at 1000, so any caller
 * that needs complete history — analytics totals, monthly averages, recurring
 * detection — has to page through. Without this, a user past 500 transactions
 * silently gets truncated arithmetic rather than an error.
 *
 * Pages are fetched sequentially and stop as soon as a short page comes back.
 * `maxPages` bounds the worst case at 20,000 rows.
 */
export const PAGE_SIZE = 1000;
/**
 * A safety rail, not a budget. 50 pages is 50,000 transactions — decades of
 * ordinary use — so hitting it means something is wrong rather than that
 * someone is unusually busy, and the caller says so instead of trimming.
 */
export const MAX_TRANSACTION_PAGES = 50;
/**
 * Every transaction the page is allowed to hold, and an honest note when that
 * was not every transaction.
 *
 * The page cap exists so a runaway loop cannot hammer the API. What it must
 * not do is decide silently: the previous version stopped at the cap and
 * returned a plain array, so a large enough history simply lost its oldest
 * entries with nothing to distinguish that from having reached the end. Every
 * total on the page would then be quietly wrong, which is the same class of
 * failure as `getTransactions()` truncating at 500 — the bug this function was
 * written to fix.
 *
 * `truncated` is what the caller shows the user. It is set only when the last
 * page came back full, meaning the server had more to give.
 */
export interface TransactionPage {
  transactions: any[];
  /** True when the cap stopped the fetch before the server ran out of rows. */
  truncated: boolean;
  /** How many were actually loaded, for wording like "the most recent N". */
  loaded: number;
}

export const fetchAllTransactions = async (
  params: Record<string, any> = {},
  maxPages = MAX_TRANSACTION_PAGES,
): Promise<TransactionPage> => {
  const all: any[] = [];
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const res = await api.get('/transactions', {
      params: { ...params, limit: PAGE_SIZE, skip: page * PAGE_SIZE },
    });
    const batch = Array.isArray(res.data) ? res.data : [];
    all.push(...batch);

    if (batch.length < PAGE_SIZE) {
      // Short page: the server has no more rows. This is the only way to
      // finish knowing the set is complete.
      return { transactions: all, truncated: false, loaded: all.length };
    }
    // A full last page means there is more behind it.
    truncated = page === maxPages - 1;
  }

  return { transactions: all, truncated, loaded: all.length };
};
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
export const getAccountHistories = (months = 6) => api.get(`/history/accounts?months=${months}`);

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
export interface AssistantSource { url: string; title: string; page_age?: string | null; }
/** Reasoning depth chosen for a turn: quick (Haiku), standard, or deep. */
export type AssistantTier = 'quick' | 'standard' | 'deep';
export interface AssistantUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_searches: number;
  /** Share of input served from cache. If this collapses, the prefix is being invalidated. */
  cache_hit_rate_pct: number;
  estimated_cost_usd: number;
}
export interface AssistantChatResponse {
  conversation_id: number;
  title: string;
  reply: string;
  pending_actions: AssistantPendingAction[];
  visual_blocks: AssistantVisualBlock[];
  /** Web pages the assistant consulted for live data (prices, rates, news). */
  sources?: AssistantSource[];
  tier?: AssistantTier;
  usage?: AssistantUsage;
}

/** The server runs in UTC, so it needs the browser's zone to date things correctly. */
const browserTimezone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

export const assistantListConversations = () => api.get<AssistantConversation[]>('/assistant/conversations');
export const assistantGetConversation   = (id: number) => api.get<{ id: number; title: string; messages: AssistantMessage[] }>(`/assistant/conversations/${id}`);
export const assistantDeleteConversation = (id: number) => api.delete(`/assistant/conversations/${id}`);
export const assistantGetBriefing = () => {
  const tz = browserTimezone();
  return api.get<{ as_of: string; blocks: AssistantVisualBlock[] }>(
    '/assistant/briefing',
    { params: tz ? { tz } : undefined },
  );
};
export const assistantChat = (message: string, conversation_id?: number | null, signal?: AbortSignal) =>
  api.post<AssistantChatResponse>(
    '/assistant/chat',
    { message, conversation_id: conversation_id ?? null, timezone: browserTimezone() },
    { signal },
  );
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

// ── Preferences ───────────────────────────────────────────────────────────────
// Per-user settings for behaviour the user may change. `*_effective` in the
// response is read-only: it folds in the deployment-level kill-switch, so the
// UI can explain a switch that is on but currently doing nothing.
export const getPreferences    = () => api.get('/preferences');
export const updatePreferences = (changes: Record<string, boolean>) =>
  api.patch('/preferences', changes);

// ── Plaid ─────────────────────────────────────────────────────────────────────
export const plaidCreateLinkToken  = () => api.post('/plaid/link-token');
// Link token in *update mode*, repairing the Item Fintrack already holds.
// `itemId` is Fintrack's own PlaidItem.id. Completing this flow reuses the
// existing Item and access token, so it must NOT be followed by an exchange —
// see `usePlaidConnections.onRepaired`.
export const plaidCreateUpdateLinkToken = (itemId: number) =>
  api.post(`/plaid/link-token/update/${itemId}`);
export const plaidExchangeToken    = (public_token: string, institution_name?: string) =>
  api.post('/plaid/exchange-token', { public_token, institution_name });
export const plaidGetItems         = () => api.get('/plaid/items');
export const plaidDeleteItem       = (id: number) => api.delete(`/plaid/items/${id}`);
// Last-resort escape hatch: forget the connection locally **without** asking
// Plaid to remove it, for an Item whose remote removal cannot be made to
// succeed. It makes no Plaid call, so it cannot and does not confirm the Item
// was removed there — the response says so and the UI must repeat it. Never
// use this as a fallback for an ordinary failed disconnect without asking.
export const plaidRemoveItemLocally = (id: number) =>
  api.post(`/plaid/items/${id}/remove-local`);
export const plaidSyncAll          = () => api.post('/plaid/sync');
export const plaidReset            = () => api.post('/plaid/reset');
// "Rebuild bank history". Clears every cursor so the next sync re-reads all
// available history; existing rows are matched on `plaid_tx_id` and skipped
// rather than duplicated or overwritten, so filings survive. Non-destructive
// but slow — it returns before the work runs, so completion is established by
// polling `/plaid/sync-status`, exactly as a manual sync is.
export const plaidRebuildHistory   = () => api.post('/plaid/replay');
// Read-only diagnostics. Makes one live Plaid `/item/get` per connected Item,
// serially, so it is fetched only when the Connections section is opened.
export const plaidSyncHealth       = () => api.get('/plaid/sync-health');
// Local columns only — no Plaid call — so it is safe to poll briefly while a
// manual sync runs. `plaidSyncHealth` is not, and must never be used for that.
export const plaidSyncStatus       = () => api.get('/plaid/sync-status');

export default api;
