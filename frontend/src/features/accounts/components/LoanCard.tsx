import React from 'react';
import type { Loan } from '../../../types';
import ProgressBar from '../../../components/ProgressBar';
import { dollars, relativeDays } from '../../analytics/format';
import { describeLoan } from '../calculations/loans';

/**
 * One loan — money you lent someone.
 *
 * The three actions used to sit at equal visual weight, which made writing a
 * debt off exactly as easy as recording a repayment. They are now ranked:
 * recording a repayment is the thing that happens most and gets the filled
 * control; marking it fully repaid is a quieter confirm; writing it off is
 * plain text, because it is a decision you should have to mean.
 *
 * A settled loan drops its actions entirely rather than greying them — a
 * disabled button still invites a click, and there is nothing left to do.
 *
 * Copy stays neutral throughout. "Outstanding" and "Past due" are facts;
 * nothing here editorialises about the person who owes you money.
 */

interface Props {
  loan: Loan;
  repayInput: string;
  repaying: boolean;
  onRepayChange: (id: number, value: string) => void;
  onRepayment: (loan: Loan) => void;
  onMarkRepaid: (id: number) => void;
  onWriteOff: (id: number) => void;
  onDelete: (loan: Loan) => void;
}

const formatDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const LoanCard: React.FC<Props> = ({
  loan, repayInput, repaying, onRepayChange, onRepayment, onMarkRepaid, onWriteOff, onDelete,
}) => {
  const view = describeLoan(loan);
  const showActions = view.state === 'active';

  return (
    <div className="card overflow-hidden group" style={view.isSettled ? { opacity: 0.75 } : undefined}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-base shrink-0"
              style={{ backgroundColor: 'var(--elev-sub)', color: view.statusColor, border: '1px solid var(--line)' }}
              aria-hidden="true"
            >
              {loan.borrower_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }} title={loan.borrower_name}>
                {loan.borrower_name}
              </p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Lent {formatDate(loan.loan_date)}</p>
            </div>
          </div>

          <div className="flex items-start gap-2 shrink-0">
            <div className="text-right">
              <p className="font-mono tabular-nums font-bold text-base" style={{ color: view.statusColor }}>
                {view.state === 'active' ? dollars(view.outstanding) : dollars(view.principal)}
              </p>
              {/* Status in words, never colour alone. */}
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{view.statusLabel}</p>
            </div>
            <button
              onClick={() => onDelete(loan)}
              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all"
              aria-label={`Delete loan for ${loan.borrower_name}`}
              style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)', border: '1px solid var(--line)' }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {loan.note && <p className="text-xs mb-3 italic" style={{ color: 'var(--muted)' }}>&ldquo;{loan.note}&rdquo;</p>}

        {view.dueStatus !== 'none' && view.daysUntilDue != null && (
          <p
            className="text-[11px] mb-3"
            style={{ color: view.dueStatus === 'overdue' ? 'var(--neg)' : view.dueStatus === 'due-soon' ? '#f59e0b' : 'var(--muted)' }}
          >
            {view.dueStatus === 'overdue'
              ? `Past due — expected ${formatDate(loan.due_date as string)}`
              : `Due ${relativeDays(view.daysUntilDue)}`}
          </p>
        )}

        {/* Progress, honest about overpayment and about a zero principal. */}
        {view.state === 'invalid' ? (
          <p className="text-xs" style={{ color: 'var(--dim)' }}>
            No original amount recorded, so repayment progress cannot be shown.
          </p>
        ) : (
          <div>
            <div className="flex justify-between items-baseline text-[11px] mb-1.5 gap-2">
              <span className="tabular-nums" style={{ color: 'var(--muted)' }}>
                {dollars(view.repaid)} repaid of {dollars(view.principal)}
              </span>
              <span className="tabular-nums shrink-0" style={{ color: view.statusColor }}>
                {view.rawProgress.toFixed(0)}%
              </span>
            </div>
            <ProgressBar
              value={view.progress}
              colorAuto
              semantics="progress"
              height={5}
              label={`${loan.borrower_name}: ${view.statusLabel}, ${view.rawProgress.toFixed(0)} percent repaid`}
            />
            {view.overpaidBy > 0 && (
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--accent)' }}>
                {dollars(view.overpaidBy)} more than the original amount has been recorded.
              </p>
            )}
          </div>
        )}
      </div>

      {showActions && (
        <div className="px-4 pb-4 pt-0 space-y-2">
          {/* Primary: the thing that actually happens. */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <label className="sr-only" htmlFor={`repay-${loan.id}`}>
                Amount received from {loan.borrower_name}
              </label>
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs" style={{ color: 'var(--muted)' }} aria-hidden="true">$</span>
              <input
                id={`repay-${loan.id}`}
                type="number" step="0.01" min="0.01" inputMode="decimal"
                value={repayInput}
                onChange={e => onRepayChange(loan.id, e.target.value)}
                className="input-dark pl-6 text-sm py-2.5"
                placeholder={`Amount received (${dollars(view.outstanding)} left)`}
              />
            </div>
            <button
              onClick={() => onRepayment(loan)}
              disabled={repaying || !repayInput || parseFloat(repayInput) <= 0}
              className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-40 shrink-0"
              style={{ backgroundColor: 'var(--pos)', color: '#08130c' }}
            >
              {repaying ? '…' : 'Record'}
            </button>
          </div>

          {/* Secondary and danger, visibly unequal to each other and to above. */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              onClick={() => onMarkRepaid(loan.id)}
              className="text-xs font-semibold rounded-lg px-3"
              style={{ color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.25)', minHeight: 36 }}
            >
              Mark fully repaid
            </button>
            <button
              onClick={() => onWriteOff(loan.id)}
              className="text-xs px-2"
              style={{ color: 'var(--dim)', minHeight: 36 }}
            >
              Write off
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanCard;
