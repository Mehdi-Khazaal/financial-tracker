import React, { useEffect, useState } from 'react';
import BottomSheet from '../../../components/BottomSheet';
import type { RecurringBill, RecurringGroupKey, RecurringPeriod } from '../../../types';
import { GroupIcon } from './GroupIcon';
import { PERIOD_LABEL, num } from '../calculations';

type GroupOption = { key: RecurringGroupKey; label: string };

/** Pick a group. Used both to move a tracked bill and to file a suggestion before tracking it. */
export const GroupPickerSheet: React.FC<{
  isOpen: boolean;
  title: string;
  options: GroupOption[];
  current: RecurringGroupKey | null;
  includeIncome?: boolean;
  onPick: (key: RecurringGroupKey) => void;
  onClose: () => void;
}> = ({ isOpen, title, options, current, includeIncome = false, onPick, onClose }) => (
  <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
    <div className="px-5 pb-6" role="radiogroup" aria-label={title}>
      {options.filter(o => includeIncome || o.key !== 'income').map(option => {
        const selected = option.key === current;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(option.key)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg pressable text-left"
            style={{
              minHeight: 48,
              backgroundColor: selected ? 'var(--accent-dim)' : 'transparent',
              color: selected ? 'var(--accent)' : 'var(--fg)',
            }}
          >
            <GroupIcon group={option.key} />
            <span className="flex-1 text-sm font-medium">{option.label}</span>
            {selected && (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10.5l3.2 3.2L15 6.8" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  </BottomSheet>
);

const PERIODS = Object.entries(PERIOD_LABEL) as [RecurringPeriod, string][];

export interface BillEdits {
  description: string;
  amount: number;
  period: RecurringPeriod;
  next_date: string;
  is_variable: boolean;
}

/** Edit what a bill is: name, amount, cadence, next date, fixed or variable. */
export const EditBillSheet: React.FC<{
  bill: RecurringBill | null;
  onSave: (bill: RecurringBill, edits: BillEdits) => Promise<void>;
  onClose: () => void;
}> = ({ bill, onSave, onClose }) => {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<RecurringPeriod>('monthly');
  const [nextDate, setNextDate] = useState('');
  const [isVariable, setIsVariable] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bill) return;
    setDescription(bill.description ?? '');
    setAmount(Math.abs(num(bill.amount)).toFixed(2));
    setPeriod(bill.period);
    setNextDate(bill.next_date.slice(0, 10));
    setIsVariable(bill.is_variable);
  }, [bill]);

  if (!bill) return null;
  const isIncome = num(bill.amount) > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Math.abs(parseFloat(amount));
    if (!Number.isFinite(value) || value <= 0 || !nextDate) return;
    setSaving(true);
    try {
      await onSave(bill, {
        description: description.trim(),
        amount: isIncome ? value : -value,
        period,
        next_date: nextDate,
        is_variable: isVariable,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet isOpen={!!bill} onClose={onClose} title="Edit recurring charge">
      <form onSubmit={submit} className="px-5 pb-6 space-y-4">
        <div>
          <label className="label mb-2 block" htmlFor="edit-bill-name">Name</label>
          <input id="edit-bill-name" className="input-dark" value={description} onChange={e => setDescription(e.target.value)} maxLength={120} />
        </div>
        <div>
          <label className="label mb-2 block" htmlFor="edit-bill-amount">{isVariable ? 'Usual amount' : 'Amount'}</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-muted" aria-hidden="true">$</span>
            <input id="edit-bill-amount" className="input-dark pl-8 font-mono tabular-nums" type="number" inputMode="decimal" step="0.01" min="0.01"
              value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg cursor-pointer" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
          <span>
            <span className="block text-sm font-medium">Amount changes each time</span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>For utilities and usage-based bills</span>
          </span>
          <input type="checkbox" checked={isVariable} onChange={e => setIsVariable(e.target.checked)} className="w-5 h-5" style={{ accentColor: 'var(--accent)' }} />
        </label>
        <div>
          <p className="label mb-2">How often</p>
          <div className="flex flex-wrap gap-2">
            {PERIODS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setPeriod(value)} aria-pressed={period === value}
                className="pill pressable"
                style={period === value
                  ? { backgroundColor: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid rgba(249,115,22,0.35)' }
                  : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label mb-2 block" htmlFor="edit-bill-date">Next due</label>
          <input id="edit-bill-date" className="input-dark" type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} required />
        </div>
        <button type="submit" disabled={saving} className="btn-gradient w-full py-3 text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </BottomSheet>
  );
};

/** Record this cycle's real amount for a variable bill on a manual account. */
export const LogAmountSheet: React.FC<{
  bill: RecurringBill | null;
  onLog: (bill: RecurringBill, amount: number) => Promise<void>;
  onClose: () => void;
}> = ({ bill, onLog, onClose }) => {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bill) setAmount(Math.abs(num(bill.amount)).toFixed(2));
  }, [bill]);

  if (!bill) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Math.abs(parseFloat(amount));
    if (!Number.isFinite(value) || value <= 0) return;
    setSaving(true);
    try {
      await onLog(bill, num(bill.amount) > 0 ? value : -value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet isOpen={!!bill} onClose={onClose} title={`Log ${bill.description ?? 'bill'}`}>
      <form onSubmit={submit} className="px-5 pb-6 space-y-4">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Enter this cycle's amount. It is recorded as a transaction on {bill.account_name ?? 'the account'} and used as the estimate next time.
        </p>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-muted" aria-hidden="true">$</span>
          <input aria-label="Amount" className="input-dark pl-8 text-lg font-mono tabular-nums" type="number" inputMode="decimal" step="0.01" min="0.01"
            value={amount} onChange={e => setAmount(e.target.value)} autoFocus required />
        </div>
        <button type="submit" disabled={saving} className="btn-gradient w-full py-3 text-sm disabled:opacity-50">
          {saving ? 'Logging…' : 'Log amount'}
        </button>
      </form>
    </BottomSheet>
  );
};
