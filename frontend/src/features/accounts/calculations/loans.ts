/**
 * Loan progress and status.
 *
 * A loan here is money *you* lent someone, so "outstanding" is what is still
 * owed to you and repayment is good news. The wording throughout stays neutral:
 * someone being slow to repay is a fact, not a character judgement, and the UI
 * has no business implying otherwise.
 *
 * Three arithmetic traps this module closes, all of which the inline version
 * could hit:
 *
 *   • **Overpayment.** `amount_repaid` can exceed `amount` — a repayment is
 *     recorded by the user, and nothing stops them entering more than is owed.
 *     Progress is reported honestly (it can exceed 100) while the bar is
 *     clamped, and outstanding floors at zero rather than going negative.
 *   • **A zero original amount.** Dividing by it yields `NaN`, which the old
 *     code guarded for progress but not for the label.
 *   • **Written-off loans.** Progress against an amount you have given up on
 *     is meaningless; the status carries the story instead.
 */

import type { Loan } from '../../../types';
import { localDateStr } from '../../../utils/date';

export type LoanState = 'active' | 'repaid' | 'written-off' | 'overpaid' | 'invalid';

export type LoanDueStatus = 'overdue' | 'due-soon' | 'scheduled' | 'none';

export interface LoanPresentation {
  state: LoanState;
  /** Status in words, so it never depends on colour alone. */
  statusLabel: string;
  /** Design token for the status chip. */
  statusColor: string;
  /** Original amount lent. */
  principal: number;
  /** Recorded as repaid, never above the principal for display purposes. */
  repaid: number;
  /** Still owed to you. Floors at zero. */
  outstanding: number;
  /** True repayment percentage, which can exceed 100 on an overpayment. */
  rawProgress: number;
  /** Clamped 0–100, for the bar. */
  progress: number;
  /** Amount recorded beyond the principal, or 0. */
  overpaidBy: number;
  dueStatus: LoanDueStatus;
  /** Days until the due date; negative when past. Null without a due date. */
  daysUntilDue: number | null;
  /** True when no further action makes sense. */
  isSettled: boolean;
}

const STATUS_LABELS: Record<LoanState, string> = {
  active: 'Outstanding',
  repaid: 'Repaid',
  'written-off': 'Written off',
  overpaid: 'Overpaid',
  invalid: 'No amount recorded',
};

const STATUS_COLORS: Record<LoanState, string> = {
  active: '#f59e0b',
  repaid: 'var(--pos)',
  // Not red: writing a loan off is a decision the user made, not a failure.
  'written-off': 'var(--muted)',
  overpaid: 'var(--accent)',
  invalid: 'var(--dim)',
};

/** Days from today to `date`, negative when it has passed. */
const daysUntil = (date: string, today: string): number =>
  Math.round(
    (new Date(`${date.slice(0, 10)}T00:00:00`).getTime()
      - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
  );

export function describeLoan(loan: Loan, today = localDateStr()): LoanPresentation {
  const principal = Number(loan.amount) || 0;
  const recorded = Number(loan.amount_repaid) || 0;

  const overpaidBy = principal > 0 ? Math.max(0, recorded - principal) : 0;
  const repaid = Math.max(0, recorded);
  const outstanding = Math.max(0, principal - recorded);

  const rawProgress = principal > 0 ? (recorded / principal) * 100 : 0;
  const progress = Math.min(100, Math.max(0, rawProgress));

  const state: LoanState = loan.status === 'written_off'
    ? 'written-off'
    : principal <= 0
      ? 'invalid'
      : loan.status === 'repaid'
        ? 'repaid'
        : overpaidBy > 0
          ? 'overpaid'
          // A loan repaid in full but not yet marked stays "repaid" in substance.
          : outstanding === 0
            ? 'repaid'
            : 'active';

  const isSettled = state === 'repaid' || state === 'written-off' || state === 'overpaid';

  const due = loan.due_date && state === 'active' ? daysUntil(loan.due_date, today) : null;
  const dueStatus: LoanDueStatus = due == null
    ? 'none'
    : due < 0
      ? 'overdue'
      : due <= 7
        ? 'due-soon'
        : 'scheduled';

  return {
    state,
    statusLabel: STATUS_LABELS[state],
    statusColor: STATUS_COLORS[state],
    principal,
    repaid,
    outstanding,
    rawProgress,
    progress,
    overpaidBy,
    dueStatus,
    daysUntilDue: due,
    isSettled,
  };
}

export interface LoanTotals {
  /** Still owed across loans that are still active. */
  outstanding: number;
  /** Everything ever lent, whatever its status. */
  lent: number;
  /** Everything recorded as repaid. */
  recovered: number;
  activeCount: number;
  settledCount: number;
}

export function calculateLoanTotals(loans: Loan[], today = localDateStr()): LoanTotals {
  return loans.reduce<LoanTotals>((totals, loan) => {
    const view = describeLoan(loan, today);
    return {
      outstanding: totals.outstanding + (view.state === 'active' ? view.outstanding : 0),
      lent: totals.lent + view.principal,
      recovered: totals.recovered + view.repaid,
      activeCount: totals.activeCount + (view.state === 'active' ? 1 : 0),
      settledCount: totals.settledCount + (view.isSettled ? 1 : 0),
    };
  }, { outstanding: 0, lent: 0, recovered: 0, activeCount: 0, settledCount: 0 });
}
