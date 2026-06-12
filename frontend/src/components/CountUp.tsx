import React, { useEffect, useRef, useState } from 'react';

type Props = {
  value: number;
  /** formats the in-flight number; defaults to 2-decimal en-US */
  format?: (n: number) => string;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
};

const defaultFormat = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Animates from the previously shown value to the new one with a strong
    ease-out — first mount runs from 0, updates run from the last value. */
const CountUp: React.FC<Props> = ({ value, format = defaultFormat, duration = 1000, className, style }) => {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { fromRef.current = value; setShown(value); return; }

    const from = fromRef.current;
    const start = performance.now();
    const run = (t: number) => {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setShown(from + (value - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(run);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(run);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <span className={className} style={style}>{format(shown)}</span>;
};

export default CountUp;
