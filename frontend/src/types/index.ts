export interface Account {
  id: number;
  user_id: number;
  name: string;
  type: 'checking' | 'savings' | 'credit_card' | 'cash' | 'investment';
  balance: number;
  credit_limit: number | null;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  user_id: number | null;
  name: string;
  type: 'income' | 'expense' | 'investment';
  color: string;
  is_system: boolean;
  created_at: string;
}

export interface Transaction {
  id: number;
  user_id: number;
  account_id: number;
  category_id: number | null;
  amount: number;
  description: string | null;
  transaction_date: string;
  created_at: string;
  /**
   * Merchant identity resolved by the backend. Null on rows written before
   * the Phase 5A migration and on any row the backfill has not reached, which
   * is why `merchantIdentity` still falls back to local normalization.
   */
  merchant_key?: string | null;
  /** Plaid's stable merchant id. Takes precedence over `merchant_key`. */
  plaid_merchant_entity_id?: string | null;
  /** How `category_id` was set: "user" | "merchant_history" | "plaid_pfc". */
  category_source?: string | null;
}

export interface Transfer {
  id: number;
  user_id: number;
  from_account_id: number;
  to_account_id: number;
  amount: number;
  note: string | null;
  transfer_date: string;
  created_at: string;
}

export interface Asset {
  id: number;
  user_id: number;
  name: string;
  type: string;
  asset_class: 'investment' | 'physical';
  quantity: number | null;
  value_per_unit: number | null;
  total_value: number;
  currency: string;
  purchase_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalAllocation {
  id: number;
  account_id: number;
  account_name: string;
  amount: number;
}

export interface SavingsGoal {
  id: number;
  user_id: number;
  name: string;
  target_amount: number;
  deadline: string | null;
  created_at: string;
  allocations: GoalAllocation[];
  current_amount: number;
}

export type RecurringPeriod = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringTransaction {
  id: number;
  user_id: number;
  account_id: number;
  category_id: number | null;
  amount: number;
  description: string | null;
  period: RecurringPeriod;
  next_date: string;
  is_active: boolean;
  is_variable: boolean;
  created_at: string;
  /** One of `RECURRING_GROUPS`; null only on rows the server has not grouped yet. */
  group_key?: RecurringGroupKey | null;
  source?: 'manual' | 'detected' | null;
  last_paid_date?: string | null;
  last_paid_amount?: number | null;
  /** The price before the most recent change on a fixed bill. */
  previous_amount?: number | null;
  amount_changed_on?: string | null;
}

export type RecurringGroupKey =
  | 'housing' | 'utilities' | 'phone_internet' | 'insurance' | 'subscriptions'
  | 'loans_cards' | 'transport' | 'healthcare' | 'other' | 'income';

export type RecurringBillStatus = 'paid' | 'due_soon' | 'upcoming' | 'overdue' | 'waiting' | 'missed' | 'paused';

/** A tracked bill as the Recurring page shows it. Money fields arrive as strings. */
export interface RecurringBill extends Omit<RecurringTransaction, 'amount' | 'last_paid_amount' | 'previous_amount'> {
  amount: string;
  last_paid_amount?: string | null;
  previous_amount?: string | null;
  group_key: RecurringGroupKey;
  group_label: string;
  account_name: string | null;
  category_name: string | null;
  /** Bank-linked: marked paid from imported charges, never posted by the app. */
  linked: boolean;
  status: RecurringBillStatus;
  status_label: string;
  days_until: number;
  monthly_amount: string;
  paid_this_month: string;
  remaining_this_month: string;
}

export interface RecurringGroupSummary {
  key: RecurringGroupKey;
  label: string;
  monthly_total: string;
  paid_this_month: string;
  remaining_this_month: string;
  bills: RecurringBill[];
}

export interface RecurringSuggestion {
  identity: string;
  name: string;
  amount: string;
  period: RecurringPeriod;
  next_date: string;
  last_date: string;
  is_variable: boolean;
  is_income: boolean;
  group_key: RecurringGroupKey;
  group_label: string;
  account_id: number;
  account_name: string | null;
  category_id: number | null;
  occurrences: number;
  confidence: 'high' | 'medium';
  reasons: string[];
  min_amount: string;
  max_amount: string;
  monthly_amount: string;
}

export interface RecurringUpcoming {
  id: number;
  name: string;
  amount: string;
  due_date: string;
  days_until: number;
  group_key: RecurringGroupKey;
  is_variable: boolean;
  linked: boolean;
  account_name: string | null;
}

export interface RecurringOverview {
  month: string;
  today: string;
  expected_this_month: string;
  paid_this_month: string;
  remaining_this_month: string;
  typical_monthly: string;
  income_expected_this_month: string;
  income_typical_monthly: string;
  bill_count: number;
  groups: RecurringGroupSummary[];
  income: RecurringBill[];
  paused: RecurringBill[];
  upcoming: RecurringUpcoming[];
  suggestions: RecurringSuggestion[];
  group_options: { key: RecurringGroupKey; label: string }[];
}

export interface MonthSnapshot {
  month: string;
  net_worth?: number;
  accounts?: number;
  balance?: number;
}

export interface Loan {
  id: number;
  user_id: number;
  borrower_name: string;
  amount: number;
  amount_repaid: number;
  note: string | null;
  loan_date: string;
  due_date: string | null;
  status: 'active' | 'repaid' | 'written_off';
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  email: string;
  username: string;
  is_verified: boolean;
  is_admin: boolean;
  created_at: string;
}

// ── Budgets ───────────────────────────────────────────────────────────────────
/** A monthly allowance for one expense category. Money arrives as strings. */
export interface Budget {
  id: number;
  category_id: number;
  amount: string;
  rollover: boolean;
  starts_on: string;
  is_active: boolean;
}

/** One budget's figures for a month, computed by the server from the ledger. */
export interface BudgetProgress {
  id: number;
  category_id: number;
  category_name: string;
  category_color: string;
  month: string;
  amount: string;
  carried: string;
  available: string;
  spent: string;
  remaining: string;
  percent: string;
  over: boolean;
  rollover: boolean;
}

export interface BudgetProgressSummary {
  month: string;
  budgeted: string;
  spent: string;
  remaining: string;
  over_count: number;
  budgets: BudgetProgress[];
}
