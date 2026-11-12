import React, { useId, useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  currency?: string;
  autoFocus?: boolean;
  id?: string;
  label?: string;
}

/**
 * The big amount field at the top of a money form. The whole box is the
 * control: it carries the border and the focus ring, and a click anywhere in
 * it focuses the input.
 */
const AmountInput: React.FC<Props> = ({ value, onChange, currency = '$', autoFocus = true, id, label = 'Amount' }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div>
      <label className="form-label" htmlFor={inputId}>{label}</label>
      <div
        className="amount-field flex min-h-[72px] items-center justify-center gap-1 px-4 py-3 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <span className="font-semibold text-2xl" style={{ color: 'var(--dim)' }} aria-hidden="true">{currency}</span>
        <input
          id={inputId}
          ref={inputRef}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          // Sized to what is typed, so the currency sign sits right beside the number.
          className="min-w-0 max-w-full font-semibold bg-transparent text-3xl tabular-nums"
          style={{ color: 'var(--fg)', width: `${Math.max((value || '0.00').length, 1) + 0.6}ch` }}
          placeholder="0.00"
          autoFocus={autoFocus}
        />
      </div>
    </div>
  );
};

export default AmountInput;
