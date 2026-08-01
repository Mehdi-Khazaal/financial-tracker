/**
 * Analytics domain types.
 *
 * Everything here is plain data — no React, no side effects. The calculation
 * modules under `calculations/` turn raw API models into these shapes, and the
 * components under `components/` only ever render them. That split is what
 * makes the numbers testable without mounting a chart.
 */

import type {
  Account,
  Category,
  RecurringTransaction,
  SavingsGoal,
  Transaction,
} from '../../types';

// ── Period ────────────────────────────────────────────────────────────────────

export type PeriodId = 'this-month' | 'last-3' | 'last-6' | 'all-time' | 'custom';

export interface PeriodRange {
  /** Inclusive `YYYY-MM-DD`. */
  start: string;
  /** Inclusive `YYYY-MM-DD`. */
  end: string;
  /** Month keys (`YYYY-MM`) the range touches, ascending. */
  months: string[];
  label: string;
}

export interface ResolvedPeriod extends PeriodRange {
  id: PeriodId;
  /** True when the range is exactly one calendar month. */
  isSingleMonth: boolean;
  /** True when the range extends past today — the period is still running. */
  isIncomplete: boolean;
  /** How far through the range we are, 0..1. `1` for completed ranges. */
  elapsed: number;
  /** Days elapsed within the range (at least 1 when the range has started). */
  daysElapsed: number;
  /** Total days in the range. */
  daysTotal: number;
  shortLabel: string;
  /** The immediately preceding range of equal length, or null for all-time. */
  previous: PeriodRange | null;
}

// ── Transaction classification ────────────────────────────────────────────────

/**
 * How a single transaction is counted.
 *
 * - `income`      — money in from outside
 * - `expense`     — money out
 * - `refund`      — money back into an expense category; nets against that
 *                   category rather than inflating income
 * - `card-payment`— money into a credit-card account; excluded entirely, the
 *                   original purchase was already counted as an expense
 * - `excluded`    — zero-amount rows
 */
export type TransactionKind = 'income' | 'expense' | 'refund' | 'card-payment' | 'excluded';

export interface ClassificationContext {
  accountTypeById: Map<number, Account['type']>;
  categoryTypeById: Map<number, Category['type']>;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface PeriodMetrics {
  income: number;
  /** Gross spend minus refunds. Never below zero. */
  expenses: number;
  grossExpenses: number;
  refunds: number;
  cardPayments: number;
  /** `income - expenses`. This is the app's definition of money saved. */
  net: number;
  /** `net / income`, or null when there was no income to save out of. */
  savingsRate: number | null;
  transactionCount: number;
  uncategorizedCount: number;
  uncategorizedSpend: number;
  largestExpense: Transaction | null;
  largestIncome: Transaction | null;
}

export type Confidence = 'none' | 'low' | 'medium' | 'high';

export interface CategoryComparison {
  id: number;
  name: string;
  color: string;
  current: number;
  previous: number;
  /** Mean monthly spend across `baselineMonths` completed months. */
  average: number;
  baselineMonths: number;
  confidence: Confidence;
  deltaVsPrevious: number;
  deltaVsAverage: number;
  pctVsPrevious: number | null;
  pctVsAverage: number | null;
  /** Share of the period's total expenses, 0..1. */
  share: number;
  transactionCount: number;
  /** Largest single transaction in the period, used to spot one-off purchases. */
  largestTransaction: Transaction | null;
  /** True when one transaction drives most of an increase — treat as one-off. */
  drivenByOneTransaction: boolean;
}

export interface CategoryDetail extends CategoryComparison {
  transactions: Transaction[];
  averageTransaction: number;
  topMerchants: MerchantSummary[];
  monthlyTrend: { month: string; label: string; value: number }[];
}

export interface MerchantSummary {
  key: string;
  name: string;
  total: number;
  count: number;
  average: number;
  largest: number;
}

// ── Savings ───────────────────────────────────────────────────────────────────

export interface PrimaryGoal {
  id: number;
  name: string;
  target: number;
  current: number;
  /** 0..100, clamped. */
  progress: number;
  remaining: number;
  deadline: string | null;
  /** Month label, e.g. "October 2026". Null when it can't be estimated. */
  projectedCompletion: string | null;
  monthsToCompletion: number | null;
  /** Why this goal was chosen as primary. */
  basis: 'deadline' | 'progress';
}

export interface SavingsMetrics {
  saved: number;
  savingsRate: number | null;
  previousSaved: number | null;
  previousRate: number | null;
  savedDelta: number | null;
  rateDelta: number | null;
  /** Mean monthly `income - expenses` across completed baseline months. */
  averageMonthlySaved: number | null;
  averageMonths: number;
  /** Total currently allocated to savings goals — a labelling of balances. */
  allocatedTotal: number;
  goalCount: number;
  primaryGoal: PrimaryGoal | null;
}

// ── Net worth ─────────────────────────────────────────────────────────────────

export interface NetWorthPoint {
  month: string;
  label: string;
  value: number;
  /** Change from the previous point, or null for the first. */
  change: number | null;
  pctChange: number | null;
}

export interface NetWorthContributor {
  label: string;
  detail: string;
  value: number;
}

export interface NetWorthAnalysis {
  points: NetWorthPoint[];
  start: number;
  end: number;
  change: number;
  pctChange: number | null;
  high: NetWorthPoint | null;
  low: NetWorthPoint | null;
  bestMonth: NetWorthPoint | null;
  worstMonth: NetWorthPoint | null;
  /** Movements we can evidence from transactions — never asserted as causes. */
  contributors: NetWorthContributor[];
}

// ── Cash flow ─────────────────────────────────────────────────────────────────

export interface CashFlowStep {
  key: string;
  label: string;
  /** Signed: income positive, costs negative. */
  value: number;
  /** Bar base for the waterfall, in dollars. */
  base: number;
  kind: 'income' | 'cost' | 'result';
  color: string;
  hint: string;
}

export interface CashFlowSeriesPoint {
  month: string;
  label: string;
  Income: number;
  Expenses: number;
  net: number;
}

export interface CashFlowData {
  mode: 'waterfall' | 'series';
  steps: CashFlowStep[];
  series: CashFlowSeriesPoint[];
  income: number;
  fixed: number;
  variable: number;
  remaining: number;
  /** True when we could identify fixed costs from recurring declarations. */
  hasFixedBreakdown: boolean;
}

// ── Recurring & subscriptions ─────────────────────────────────────────────────

export interface UpcomingBill {
  id: number;
  name: string;
  /** Positive dollar amount expected to leave the account. */
  amount: number;
  dueDate: string;
  daysUntil: number;
  period: RecurringTransaction['period'];
  isVariable: boolean;
  categoryName: string | null;
  categoryColor: string;
  accountName: string | null;
}

export interface DetectedSubscription {
  key: string;
  name: string;
  monthlyAmount: number;
  occurrences: number;
  medianIntervalDays: number;
  lastSeen: string;
}

/**
 * How a declared recurring charge is grouped. Derived from fields the user
 * actually set, never from guessing at merchant names:
 *   • `bill`         — the amount varies each cycle (utilities, phone)
 *   • `subscription` — a fixed amount on a regular cycle
 *   • `other`        — anything that fits neither cleanly
 */
export type RecurringKind = 'bill' | 'subscription' | 'other';

export interface RecurringCharge {
  id: number;
  name: string;
  kind: RecurringKind;
  /** Positive dollar amount per cycle. */
  amount: number;
  /** Monthly-normalised equivalent. */
  monthlyAmount: number;
  period: RecurringTransaction['period'];
  isVariable: boolean;
  categoryName: string | null;
  categoryColor: string;
  nextDate: string;
}

export interface RecurringGroup {
  kind: RecurringKind;
  label: string;
  description: string;
  charges: RecurringCharge[];
  monthlyTotal: number;
}

export interface SubscriptionInsight {
  /** Monthly-normalised total of every declared recurring expense. */
  monthlyTotal: number;
  previousMonthlyTotal: number | null;
  annualized: number;
  count: number;
  groups: RecurringGroup[];
  increased: { name: string; from: number; to: number; delta: number }[];
  possibleDuplicates: { names: string[]; note: string }[];
  /** Repeating charges found in history that the user has not confirmed. */
  detected: DetectedSubscription[];
}

export interface RecurringOutlook {
  upcoming: UpcomingBill[];
  /** Total expected to be charged in the next 30 days. */
  next30DaysTotal: number;
  next30DaysCount: number;
  subscriptions: SubscriptionInsight;
}

// ── Insights & summary ────────────────────────────────────────────────────────

export type InsightTone = 'positive' | 'info' | 'warning' | 'action';

export interface Insight {
  id: string;
  title: string;
  body: string;
  tone: InsightTone;
  /** Higher sorts first. */
  score: number;
  action?: { label: string; to?: string; tab?: string; categoryId?: number };
}

export interface PeriodSummaryData {
  headline: string;
  sentences: string[];
  /** Null when there isn't enough history to characterise the period. */
  verdict: 'stronger' | 'weaker' | 'steady' | null;
  suggestion: string | null;
  hasComparison: boolean;
}

// ── Financial health (Phase 2) ────────────────────────────────────────────────

export interface HealthFactor {
  key: string;
  label: string;
  /** 0..100 after normalisation. */
  score: number;
  weight: number;
  /** Plain-language statement of the measured value. */
  detail: string;
  explanation: string;
}

export interface FinancialHealth {
  available: boolean;
  /** 0..100, or null when unavailable. */
  score: number | null;
  previousScore: number | null;
  label: 'Needs attention' | 'Fair' | 'Good' | 'Excellent' | null;
  factors: HealthFactor[];
  strengths: HealthFactor[];
  weaknesses: HealthFactor[];
  monthsOfHistory: number;
  requiredMonths: number;
}

// ── Forecast (Phase 2) ────────────────────────────────────────────────────────

export interface ForecastValue {
  projected: number;
  soFar: number;
  /** Portion of the projection that is already-scheduled recurring activity. */
  scheduled: number;
}

export interface Forecast {
  available: boolean;
  reason: string | null;
  confidence: Confidence;
  basis: string;
  monthLabel: string;
  daysElapsed: number;
  daysTotal: number;
  expenses: ForecastValue | null;
  income: ForecastValue | null;
  savings: number | null;
  savingsRate: number | null;
  /** Categories tracking meaningfully above their own average. */
  categoryRisks: { id: number; name: string; color: string; projected: number; average: number; pct: number }[];
}

// ── Assembled view model ──────────────────────────────────────────────────────

export interface AnalyticsInputs {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  snapshots: { month: string; net_worth?: number; accounts?: number; balance?: number }[];
  today: Date;
}
