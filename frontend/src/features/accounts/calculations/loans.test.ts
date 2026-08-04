import type { Loan } from '../../../types';
import { calculateLoanTotals, describeLoan } from './loans';

/**
 * Loan arithmetic.
 *
 * Three states the inline version could not express safely: an overpayment
 * (progress above 100, outstanding wanting to go negative), a zero principal
 * (a division that yields `NaN`), and a written-off loan (progress against an
 * amount you have given up on). Each gets a test that fails against a naive
 * `repaid / amount` implementation.
 */

const TODAY = '2026-08-03';

let nextId = 1;
const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: nextId++,
  user_id: 1,
  borrower_name: 'Sam',
  amount: 1000,
  amount_repaid: 0,
  note: null,
  loan_date: '2026-01-15',
  due_date: null,
  status: 'active',
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('repayment progress', () => {
  it('reports partial repayment honestly', () => {
    const view = describeLoan(loan({ amount_repaid: 250 }), TODAY);

    expect(view.state).toBe('active');
    expect(view.outstanding).toBe(750);
    expect(view.progress).toBe(25);
    expect(view.statusLabel).toBe('Outstanding');
  });

  it('treats a fully repaid loan as repaid even before it is marked', () => {
    const view = describeLoan(loan({ amount_repaid: 1000 }), TODAY);

    expect(view.state).toBe('repaid');
    expect(view.outstanding).toBe(0);
    expect(view.progress).toBe(100);
    expect(view.isSettled).toBe(true);
  });

  it('respects an explicit repaid status', () => {
    const view = describeLoan(loan({ status: 'repaid', amount_repaid: 1000 }), TODAY);

    expect(view.state).toBe('repaid');
    expect(view.isSettled).toBe(true);
  });
});

describe('overpayment', () => {
  const overpaid = loan({ amount: 1000, amount_repaid: 1200 });

  it('never lets outstanding go negative', () => {
    expect(describeLoan(overpaid, TODAY).outstanding).toBe(0);
  });

  it('reports the true percentage but clamps the bar', () => {
    const view = describeLoan(overpaid, TODAY);

    expect(view.rawProgress).toBe(120);
    expect(view.progress).toBe(100);
  });

  it('names the overpaid amount rather than hiding it', () => {
    const view = describeLoan(overpaid, TODAY);

    expect(view.overpaidBy).toBe(200);
    expect(view.state).toBe('overpaid');
    expect(view.statusLabel).toBe('Overpaid');
  });

  it('is settled — there is nothing further to record', () => {
    expect(describeLoan(overpaid, TODAY).isSettled).toBe(true);
  });
});

describe('zero or missing original amount', () => {
  it('does not divide by zero', () => {
    const view = describeLoan(loan({ amount: 0, amount_repaid: 0 }), TODAY);

    expect(Number.isFinite(view.progress)).toBe(true);
    expect(view.progress).toBe(0);
    expect(view.state).toBe('invalid');
    expect(view.statusLabel).toBe('No amount recorded');
  });

  it('does not report an overpayment against nothing', () => {
    const view = describeLoan(loan({ amount: 0, amount_repaid: 50 }), TODAY);

    expect(view.overpaidBy).toBe(0);
    expect(view.state).toBe('invalid');
  });

  it('survives a malformed amount', () => {
    const view = describeLoan(loan({ amount: Number.NaN, amount_repaid: Number.NaN }), TODAY);

    expect(Number.isFinite(view.principal)).toBe(true);
    expect(Number.isFinite(view.outstanding)).toBe(true);
  });
});

describe('written off', () => {
  const written = loan({ status: 'written_off', amount: 1000, amount_repaid: 200 });

  it('is settled and labelled without judgement', () => {
    const view = describeLoan(written, TODAY);

    expect(view.state).toBe('written-off');
    expect(view.statusLabel).toBe('Written off');
    expect(view.isSettled).toBe(true);
  });

  it('is not coloured as an error — it was a decision, not a failure', () => {
    expect(describeLoan(written, TODAY).statusColor).toBe('var(--muted)');
  });

  it('takes precedence over the repayment arithmetic', () => {
    const fully = loan({ status: 'written_off', amount: 1000, amount_repaid: 1000 });

    expect(describeLoan(fully, TODAY).state).toBe('written-off');
  });
});

describe('due dates', () => {
  it('flags a past-due active loan', () => {
    const view = describeLoan(loan({ due_date: '2026-07-01' }), TODAY);

    expect(view.dueStatus).toBe('overdue');
    expect(view.daysUntilDue).toBeLessThan(0);
  });

  it('flags one due within a week', () => {
    expect(describeLoan(loan({ due_date: '2026-08-06' }), TODAY).dueStatus).toBe('due-soon');
  });

  it('leaves a distant date as merely scheduled', () => {
    expect(describeLoan(loan({ due_date: '2026-12-01' }), TODAY).dueStatus).toBe('scheduled');
  });

  it('says nothing when there is no due date', () => {
    const view = describeLoan(loan(), TODAY);

    expect(view.dueStatus).toBe('none');
    expect(view.daysUntilDue).toBeNull();
  });

  it('does not chase a settled loan about its due date', () => {
    const view = describeLoan(loan({ status: 'repaid', due_date: '2026-07-01' }), TODAY);

    expect(view.dueStatus).toBe('none');
  });
});

describe('totals', () => {
  const loans = [
    loan({ amount: 1000, amount_repaid: 250 }),
    loan({ amount: 500, amount_repaid: 500, status: 'repaid' }),
    loan({ amount: 300, amount_repaid: 0, status: 'written_off' }),
  ];

  it('counts outstanding across active loans only', () => {
    // Only the first is still active: 1,000 − 250.
    expect(calculateLoanTotals(loans, TODAY).outstanding).toBe(750);
  });

  it('counts everything ever lent, whatever its status', () => {
    expect(calculateLoanTotals(loans, TODAY).lent).toBe(1800);
  });

  it('counts everything recovered', () => {
    expect(calculateLoanTotals(loans, TODAY).recovered).toBe(750);
  });

  it('separates active from settled', () => {
    const totals = calculateLoanTotals(loans, TODAY);

    expect(totals.activeCount).toBe(1);
    expect(totals.settledCount).toBe(2);
  });

  it('handles no loans at all', () => {
    const totals = calculateLoanTotals([], TODAY);

    expect(totals).toEqual({ outstanding: 0, lent: 0, recovered: 0, activeCount: 0, settledCount: 0 });
  });

  it('does not let an overpaid loan inflate outstanding', () => {
    const totals = calculateLoanTotals([loan({ amount: 100, amount_repaid: 400 })], TODAY);

    expect(totals.outstanding).toBe(0);
  });
});
