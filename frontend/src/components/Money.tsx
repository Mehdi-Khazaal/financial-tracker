import React, { useEffect, useRef, useState } from 'react';

/**
 * <Money value={1234.56} />
 *
 * A single source of truth for rendering monetary values. Uses the display
 * serif (`--font-money`) with tabular numerals so the number is the hero.
 * When the value changes, each numeric column rolls independently to the new
 * digit — same trick as flight-board displays and old odometers. Non-digit
 * glyphs (currency, thousands separator, decimal, sign) render statically so
 * only what actually changed animates.
 *
 * Respects `prefers-reduced-motion`: snaps to the new value with no animation.
 *
 * Props are deliberately small. When you need a color, pass one. When you
 * need a sign to appear even for positive values (e.g. transaction lists),
 * set `sign="always"`. Otherwise: pass a number, get a beautifully rendered
 * amount.
 */

type MoneySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero';

interface MoneyProps {
  value: number;
  /** Currency symbol shown before the number. Default `$`. */
  currency?: string;
  /** Sign display policy. `auto` = only show `-` for negatives (default). */
  sign?: 'auto' | 'always' | 'never';
  /** Number of decimal places. Default `2`. Use `0` for whole-dollar hero cards. */
  decimals?: number;
  /** Preset font-size + line-height. Use `hero` for the top-of-dashboard net-worth number. */
  size?: MoneySize;
  /** Color override. Defaults to inherit. Pass `var(--pos)` / `var(--neg)` for gains/losses. */
  color?: string;
  /** Disable digit-roll animation even without reduced-motion. Use for lists that update frequently. */
  animate?: boolean;
  /** Font weight override. Default `400` (DM Serif Display has no other weight). */
  weight?: number | string;
  /** Extra className for layout. */
  className?: string;
  /** Style override merged last. */
  style?: React.CSSProperties;
}

const SIZE_STYLES: Record<MoneySize, { fontSize: string; lineHeight: number; letterSpacing: string }> = {
  xs:   { fontSize: '0.875rem', lineHeight: 1,    letterSpacing: '-0.01em' },
  sm:   { fontSize: '1rem',     lineHeight: 1,    letterSpacing: '-0.01em' },
  md:   { fontSize: '1.25rem',  lineHeight: 1,    letterSpacing: '-0.015em' },
  lg:   { fontSize: '1.75rem',  lineHeight: 1,    letterSpacing: '-0.02em' },
  xl:   { fontSize: '2.5rem',   lineHeight: 1,    letterSpacing: '-0.025em' },
  hero: { fontSize: '3.75rem',  lineHeight: 0.95, letterSpacing: '-0.03em' },
};

function formatValue(value: number, currency: string, sign: 'auto' | 'always' | 'never', decimals: number): string {
  const abs = Math.abs(value);
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  let prefix = '';
  if (sign === 'always') prefix = value < 0 ? '−' : '+';
  else if (sign === 'auto' && value < 0) prefix = '−';
  return `${prefix}${currency}${body}`;
}

// A single digit column: renders a vertical 0..9 strip and translates to expose
// the current digit. Uses transform for GPU-accelerated animation.
const DigitColumn: React.FC<{ digit: number; animate: boolean }> = React.memo(({ digit, animate }) => {
  const style: React.CSSProperties = {
    display: 'inline-block',
    height: '1em',
    lineHeight: 1,
    overflow: 'hidden',
    verticalAlign: 'top',
    // Small negative horizontal margin to tighten kerning between rolled digits
    // — tabular-nums on the parent already reserves width, so this only pulls
    // the visible glyph in without changing layout width.
  };
  const stackStyle: React.CSSProperties = {
    display: 'block',
    transform: `translateY(-${digit}em)`,
    transition: animate ? 'transform 420ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))' : 'none',
    willChange: 'transform',
  };
  return (
    <span style={style} aria-hidden="true">
      <span style={stackStyle}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
          <span key={n} style={{ display: 'block', height: '1em', lineHeight: 1 }}>{n}</span>
        ))}
      </span>
    </span>
  );
});
DigitColumn.displayName = 'DigitColumn';

const Money: React.FC<MoneyProps> = ({
  value,
  currency = '$',
  sign = 'auto',
  decimals = 2,
  size = 'md',
  color,
  animate = true,
  weight = 400,
  className,
  style,
}) => {
  const displayValue = Number.isFinite(value) ? value : 0;
  const [reduceMotion, setReduceMotion] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduceMotion(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => { firstRender.current = false; }, []);

  const shouldAnimate = animate && !reduceMotion && !firstRender.current;
  const formatted = formatValue(displayValue, currency, sign, decimals);
  const sz = SIZE_STYLES[size];

  const rootStyle: React.CSSProperties = {
    fontFamily: 'var(--font-money)',
    fontVariantNumeric: 'tabular-nums lining-nums',
    fontFeatureSettings: '"tnum" 1, "lnum" 1, "kern" 1',
    fontWeight: weight,
    fontSize: sz.fontSize,
    lineHeight: sz.lineHeight,
    letterSpacing: sz.letterSpacing,
    color: color ?? 'inherit',
    display: 'inline-flex',
    alignItems: 'baseline',
    whiteSpace: 'nowrap',
    ...style,
  };

  return (
    <span className={className} style={rootStyle} aria-label={formatted}>
      {formatted.split('').map((ch, i) => {
        if (ch >= '0' && ch <= '9') {
          return <DigitColumn key={i} digit={parseInt(ch, 10)} animate={shouldAnimate} />;
        }
        return <span key={i} aria-hidden="true">{ch}</span>;
      })}
    </span>
  );
};

export default Money;
