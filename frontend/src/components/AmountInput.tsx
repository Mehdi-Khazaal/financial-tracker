import React, { useId, useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  currency?: string;
  autoFocus?: boolean;
  id?: string;
  label?: string;
}

const AmountInput: React.FC<Props> = ({ value, onChange, currency = '$', autoFocus = true, id, label = 'Amount' }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div>
      <label className="form-label" htmlFor={inputId}>{label}</label>
      <div
        className="flex min-h-[76px] items-center justify-center gap-1 rounded-lg bg-surface px-4 py-3 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <span className="font-mono font-bold text-2xl text-dim" aria-hidden="true">{currency}</span>
        <input
          id={inputId}
          ref={inputRef}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="min-w-0 flex-1 font-mono font-bold bg-transparent outline-none text-center text-3xl text-text placeholder-dim"
          placeholder="0.00"
          autoFocus={autoFocus}
        />
      </div>
    </div>
  );
};

export default AmountInput;
