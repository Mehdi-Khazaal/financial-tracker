/**
 * Types for the Overview tab.
 *
 * Overview answers "where am I right now, and what needs my attention?" —
 * a current-status screen, not a second Analytics page. Everything here
 * describes *state*, and every string a component prints is decided in the
 * calculations layer so the wording can be unit-tested.
 *
 * Money definitions are never redefined here. Income, expenses, refunds and
 * card payments all come from `features/analytics/calculations`, which both
 * dashboard tabs share.
 */

// ── Month activity ────────────────────────────────────────────────────────────

export type MonthActivityState =
  /** A source failed to load — we cannot claim the month is empty. */
  | 'unavailable'
  /** No transactions have ever been recorded. */
  | 'no-data'
  /** Prior history exists, but nothing has posted in the current month. */
  | 'no-activity'
  /** Spending has posted, income has not. */
  | 'no-income'
  /** Income has posted, spending has not. */
  | 'no-expenses'
  /** Both sides have posted. */
  | 'active';

export interface MonthActivity {
  /** `YYYY-MM` of the month being described. */
  month: string;
  /** `August` — the month on its own, for sentences. */
  monthName: string;
  state: MonthActivityState;
  /** Transactions dated inside the month. */
  postedCount: number;
  /** Most recent transaction date not in the future, `YYYY-MM-DD`. */
  lastPostedDate: string | null;
  /** `Jul 31`, or null when there is no history. */
  lastPostedLabel: string | null;
  /** True when the last posted transaction predates the current month. */
  lastPostedIsEarlier: boolean;
  daysElapsed: number;
  daysInMonth: number;
  /** Headline for the context strip. Null when the month is behaving normally. */
  headline: string | null;
  /** Supporting sentence. Null when the headline says enough. */
  detail: string | null;
}

// ── Spending comparison ───────────────────────────────────────────────────────

export type SpendingComparisonKind =
  /** Current month against the same stretch of last month. */
  | 'difference'
  /** Last month's total, quoted on its own. */
  | 'prior-total'
  /** This month's total, with nothing to compare it against. */
  | 'current-total'
  /** Nothing meaningful to say. */
  | 'none';

export interface SpendingComparison {
  kind: SpendingComparisonKind;
  /** Metric name for the label slot, e.g. `Spending vs July`. */
  label: string;
  /** The magnitude being shown. Always positive; wording carries direction. */
  value: number;
  /** The full statement, e.g. `$412.10 less than July so far`. */
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
  /** Tooltip explaining exactly what was compared. */
  hint: string;
}

// ── Account presentation ──────────────────────────────────────────────────────

export interface BalancePresentation {
  /** What to print, e.g. `$213.37 owed`, `Paid off`, `$4,200.00`. */
  text: string;
  /** Spoken form for assistive tech, never relying on colour or a symbol. */
  srText: string;
  tone: 'positive' | 'negative' | 'neutral';
  /** One concise supporting fact, or null when none is available. */
  detail: string | null;
}

// ── Savings goals ─────────────────────────────────────────────────────────────

export type GoalStatus =
  | 'complete'
  | 'in-progress'
  | 'not-started'
  | 'overdue'
  /** Target is missing or non-positive — progress cannot be computed. */
  | 'invalid';

export interface GoalPresentation {
  /** Progress clamped to 0–100, for the bar width. */
  progress: number;
  /** True progress, which can exceed 100 on an overfunded goal. */
  rawProgress: number;
  status: GoalStatus;
  /** Text label, so status never depends on colour alone. */
  statusLabel: string;
  /** Design token for the bar and percentage. */
  color: string;
}
