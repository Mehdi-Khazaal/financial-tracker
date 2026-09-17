import React from 'react';
import type { RecurringBill, RecurringGroupKey } from '../../../types';
import RowMenu, { type RowMenuItem } from '../../settings/components/RowMenu';
import { dollars } from '../../analytics/format';
import { GroupIcon } from './GroupIcon';
import { PERIOD_LABEL, STATUS_TONE, TONE_COLOR, billAmount, dueLine, num, priceRise } from '../calculations';

export interface BillActions {
  onEdit: (bill: RecurringBill) => void;
  onMove: (bill: RecurringBill) => void;
  onTogglePause: (bill: RecurringBill) => void;
  onDelete: (bill: RecurringBill) => void;
  onLog: (bill: RecurringBill) => void;
}

/** Manual variable bills are the only ones a person has to record by hand. */
export const needsManualLog = (bill: RecurringBill): boolean =>
  !bill.linked && bill.is_variable && bill.is_active && bill.days_until <= 3;

export const BillRow: React.FC<{ bill: RecurringBill; actions: BillActions }> = ({ bill, actions }) => {
  const tone = STATUS_TONE[bill.status];
  const rise = priceRise(bill);
  const name = bill.description || bill.category_name || 'Recurring charge';
  const isIncome = num(bill.amount) > 0;

  const items: RowMenuItem[] = [
    { label: 'Edit', onSelect: () => actions.onEdit(bill) },
    ...(isIncome ? [] : [{ label: 'Move to group…', onSelect: () => actions.onMove(bill) }]),
    { label: bill.is_active ? 'Pause' : 'Resume', onSelect: () => actions.onTogglePause(bill) },
    { label: 'Delete', onSelect: () => actions.onDelete(bill), danger: true },
  ];

  return (
    <li className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--line)', minHeight: 64 }}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{name}</p>
          {bill.linked && (
            <span className="label shrink-0" style={{ fontSize: 9 }} title="Matched automatically from your bank">Bank</span>
          )}
        </div>
        <p className="text-xs mt-0.5 truncate" style={{ color: TONE_COLOR[tone] }}>
          {dueLine(bill)}
        </p>
        {/* Under the due line rather than beside the amount: on a phone a
            button in the row squeezed the bill's name down to a few letters. */}
        {needsManualLog(bill) && (
          <button type="button" onClick={() => actions.onLog(bill)}
            className="text-xs font-semibold mt-1 pressable" style={{ color: 'var(--accent)', minHeight: 28 }}>
            Log this month's amount →
          </button>
        )}
      </div>

      <div className="text-right shrink-0">
        <p className="font-mono tabular-nums text-sm font-medium" style={{ color: isIncome ? 'var(--pos)' : 'var(--fg)' }}>
          {billAmount(bill.amount, bill.is_variable, dollars)}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--dim)' }}>
          {rise != null
            ? <span className="tabular-nums" style={{ color: 'var(--neg)' }}>↑ {dollars(rise)} · {PERIOD_LABEL[bill.period]}</span>
            : PERIOD_LABEL[bill.period]}
        </p>
      </div>

      <RowMenu label={`${name} actions`} items={items} />
    </li>
  );
};

/**
 * One group of bills: what it costs a month, how much of this month is paid,
 * and every bill inside it.
 */
const BillGroupCard: React.FC<{
  groupKey: RecurringGroupKey;
  label: string;
  monthlyTotal: string;
  paid: string;
  remaining: string;
  bills: RecurringBill[];
  actions: BillActions;
}> = ({ groupKey, label, monthlyTotal, paid, remaining, bills, actions }) => {
  const headingId = `recurring-group-${groupKey}`;
  const remainingValue = num(remaining);
  return (
    <section className="card overflow-hidden" aria-labelledby={headingId}>
      <header className="flex items-center gap-3 px-4 py-3.5">
        <span style={{ color: 'var(--accent)' }}><GroupIcon group={groupKey} /></span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{label}</h2>
          <p className="text-xs mt-0.5 tabular-nums" style={{ color: 'var(--muted)' }}>
            {num(paid) > 0 ? `${dollars(num(paid))} paid` : `${bills.length} ${bills.length === 1 ? 'charge' : 'charges'}`}
            {remainingValue > 0 ? ` · ${dollars(remainingValue)} to come` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono tabular-nums text-sm font-semibold" style={{ color: 'var(--fg)' }}>{dollars(num(monthlyTotal))}</p>
          <p className="label mt-0.5" style={{ fontSize: 9 }}>a month</p>
        </div>
      </header>
      <ul className="stagger-in">
        {bills.map(bill => <BillRow key={bill.id} bill={bill} actions={actions} />)}
      </ul>
    </section>
  );
};

export default BillGroupCard;
