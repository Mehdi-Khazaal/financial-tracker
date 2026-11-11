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
  /** `transfer`: money moving between your own accounts — never income or spending. */
  type: 'income' | 'expense' | 'investment' | 'transfer';
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
  /** Plaid's cleaned merchant name, when the bank row was enriched. */
  plaid_merchant_name?: string | null;
  /**
   * How the amount is filed when it spans categories. Empty for most rows.
   * Lines add up to `amount` exactly and carry its sign; the parent's own
   * `category_id` is the largest line's, so split-unaware code still files
   * the whole amount somewhere sensible.
   */
  splits?: TransactionSplit[];
  /** How `category_id` was set: "user" | "merchant_history" | "plaid_pfc". */
  category_source?: string | null;
  /** The user's call: true a big one-off, false routine, null left to the rule. */
  one_off?: boolean | null;
  /** Collections (a trip, a holiday...) this transaction is part of. */
  collection_ids?: number[];
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
  /** With weight and purity set, the piece is valued by its metal at today's price. */
  metal?: 'gold' | 'silver' | null;
  /** Gross weight of one unit, in grams. */
  weight_grams?: number | string | null;
  /** Share of the weight that is the metal, 0–1. */
  purity?: number | string | null;
  created_at: string;
  updated_at: string;
}

// ── Paycheck plan ────────────────────────────────────────────────────────────
// Money arrives from the API as decimal strings.
export type Money = number | string;

export interface PaycheckSource {
  merchant_key: string;
  name: string;
}

export interface PaycheckLine {
  id: number;
  goal_id: number;
  goal_name: string;
  amount: Money;
  account_id: number | null;
  account_name: string | null;
}

export interface PaycheckSourceSuggestion extends PaycheckSource {
  count: number;
  typical_amount: Money;
  gap_days: number;
}

export interface PaydayLine extends PaycheckLine {
  done: boolean;
  set_aside: boolean;
}

export interface Payday {
  date: string;
  amount: Money;
  deposits: { name: string; amount: Money; account_id: number }[];
  next_payday: string;
  bills: { name: string; amount: Money; date: string; paid: boolean }[];
  bills_total: Money;
  lines: PaydayLine[];
  planned_total: Money;
  free: Money;
}

export interface PaycheckPlan {
  /** True once at least one paycheck source is chosen. */
  configured: boolean;
  notify: boolean;
  sources: PaycheckSource[];
  lines: PaycheckLine[];
  suggested_sources: PaycheckSourceSuggestion[];
  /** Usual days between paydays. */
  gap_days: number;
  paydays_per_month: Money;
  latest: Payday | null;
}

export interface PaycheckPlanInput {
  sources: PaycheckSource[];
  lines: { goal_id: number; amount: number; account_id: number | null }[];
  notify: boolean;
}

/** A row or pair the server thinks is a move between the user's own accounts. */
export interface TransferSuggestion {
  transaction_ids: number[];
  reason: 'pair' | 'card-payment' | 'bank-category';
  detail: string;
  amount: number | string;
  date: string;
  from_account_id: number | null;
  to_account_id: number | null;
  descriptions: string[];
}

/** A card payment or transfer a bank has that the ledger does not (see `GET /plaid/missing-transfers`). */
export interface MissingTransfer {
  plaid_transaction_id: string;
  account_id: number;
  account_name: string;
  date: string;
  amount: number | string;
  description: string;
}

export interface MissingTransfers {
  rows: MissingTransfer[];
  /** Banks that could not be asked; their rows are not in `rows`. */
  unavailable: string[];
}

/** One holding as `GET /assets/valuations` values it. Money arrives as decimal strings. */
export interface HoldingValue {
  asset_id: number;
  current_value: number | string;
  recorded_value: number | string;
  /** Null when unpriced: the change is unknown, not zero. */
  change_since_recorded: number | string | null;
  price_per_unit: number | string | null;
  source: 'market' | 'metal' | 'recorded';
  priced_at: string | null;
  /** The metal's price per troy ounce, for a piece priced by its metal. */
  spot_price?: number | string | null;
}

export interface MetalPrice {
  metal: 'gold' | 'silver';
  /** US dollars per troy ounce. */
  price: number | string;
  fetched_at: string;
}

/** A metal's price per troy ounce at a month's end (the latest, for this month). */
export interface MetalHistoryPoint {
  month: string;
  price: number | string;
}

export interface HoldingsValuation {
  total: number | string;
  recorded_total: number | string;
  priced_count: number;
  /** When the oldest price in use was fetched. */
  as_of: string | null;
  /** True when stored prices were served and a refresh is running behind them. */
  refreshing: boolean;
  holdings: HoldingValue[];
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
  /** Its money is emergency cover; every other goal's is promised elsewhere. */
  is_emergency_fund?: boolean;
  /** 1 is funded first. */
  priority?: number | null;
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
  /** Accounts plus holdings — the one net worth every screen shows. */
  net_worth?: number;
  accounts?: number;
  holdings?: number;
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
  two_factor_enabled?: boolean;
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

// ── Categorization rules ──────────────────────────────────────────────────────
export type RuleField = 'description' | 'merchant';
export type RuleMatchType = 'contains' | 'regex';

/** "When the description contains X, file it under Y." */
export interface CategorizationRule {
  id: number;
  category_id: number;
  field: RuleField;
  match_type: RuleMatchType;
  pattern: string;
  priority: number;
  is_active: boolean;
  applied_count: number;
}

export interface RuleDraft {
  category_id: number;
  field: RuleField;
  match_type: RuleMatchType;
  pattern: string;
  priority?: number;
  is_active?: boolean;
}

export interface RulePreviewRow {
  id: number;
  description: string | null;
  amount: string;
  transaction_date: string;
  category_id: number | null;
  category_source: string | null;
  would_change: boolean;
}

export interface RulePreview {
  matched: number;
  would_change: number;
  protected: number;
  sample: RulePreviewRow[];
}

// ── CSV import ────────────────────────────────────────────────────────────────
export interface ImportRequest {
  account_id: number;
  /** The file's text; sent inside JSON so the write goes through the usual queue. */
  text: string;
  mapping?: Partial<Record<'date' | 'amount' | 'debit' | 'credit' | 'description' | 'category', string | null>>;
  date_format: 'auto' | 'ymd' | 'mdy' | 'dmy';
  flip_sign: boolean;
  include_duplicates: boolean;
}

export interface ImportPreviewRow {
  row_number: number;
  date: string | null;
  amount: string | null;
  description: string;
  category_name: string;
  category_id: number | null;
  errors: string[];
  duplicate: boolean;
}

export interface ImportPreview {
  headers: string[];
  mapping: Record<'date' | 'amount' | 'debit' | 'credit' | 'description' | 'category', string | null>;
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  sample: ImportPreviewRow[];
}

export interface ImportResult {
  batch_id: string;
  created: number;
  skipped_duplicates: number;
  skipped_invalid: number;
}

// ── Split transactions ────────────────────────────────────────────────────────
export interface TransactionSplit {
  id: number;
  category_id: number | null;
  /** Signed decimal string, same direction as the parent. */
  amount: string;
  note: string | null;
}

/**
 * A named group of transactions: a trip, a holiday, a house move.
 *
 * It only groups. Every transaction in it still counts in its category and in
 * every total. `totals` come from the server and use the same money rules as
 * Analytics: `net` is what was spent minus what came back (refunds, paybacks).
 */
export interface Collection {
  id: number;
  name: string;
  emoji: string | null;
  color: string | null;
  note: string | null;
  start_date: string | null;
  end_date: string | null;
  /** Decimal string. */
  budget: string | null;
  is_archived: boolean;
  created_at: string | null;
  /** Has started, has not ended, not archived. */
  active: boolean;
  /** Transactions in its dates that look like they belong and are not in it yet. */
  suggestion_count: number;
  totals: {
    spent: string;
    returned: string;
    net: string;
    count: number;
    first_date: string | null;
    last_date: string | null;
  };
}

export interface CollectionDraft {
  name: string;
  emoji?: string | null;
  color?: string | null;
  note?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  budget?: string | null;
  is_archived?: boolean;
}

export interface CollectionSuggestion {
  transaction: Transaction;
  /** False for things that don't look like part of it (regular bills, pay...). */
  recommended: boolean;
  reason: string | null;
}

export interface CollectionAddResult {
  added: number;
  already: number;
  skipped_card_payments: number;
  collection: Collection;
}
