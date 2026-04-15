import React, { useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  currency?: string;
  autoFocus?: boolean;
}

const AmountInput: React.FC<Props> = ({ value, onChange, currency = '$', autoFocus = true }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="flex items-center justify-center gap-1 bg-surface rounded-2xl p-5 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="font-mono font-bold text-3xl" style={{ color: '#3e4460' }}>{currency}</span>
      <input
        ref={inputRef}
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="font-mono font-bold bg-transparent outline-none text-center text-text placeholder-dim"
        style={{ fontSize: '2.5rem', width: '160px', letterSpacing: '-1px' }}
        placeholder="0.00"
        autoFocus={autoFocus}
      />
    </div>
  );
};

export default AmountInput;
