/**
 * One place for every number the Analytics page prints.
 *
 * Two rules the rest of the feature relies on:
 *   1. Negative values use the real minus sign (U+2212), never a hyphen — it
 *      aligns with digits in tabular figures, a hyphen doesn't.
 *   2. Magnitude and sign are formatted separately, so callers decide whether
 *      "less spending" reads as positive or negative in context.
 */

export const MINUS = '−';

/** `1234.5` → `"1,234.50"`. Always the absolute value; sign is a caller concern. */
export const money = (value: number, decimals = 2): string =>
  Math.abs(Number.isFinite(value) ? value : 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** `1234.5` → `"$1,234.50"`. */
export const dollars = (value: number, decimals = 2): string => `$${money(value, decimals)}`;

/** `-1234.5` → `"−$1,234.50"`, `1234.5` → `"+$1,234.50"`. */
export const signedDollars = (value: number, decimals = 2): string =>
  `${value < 0 ? MINUS : '+'}$${money(value, decimals)}`;

/** Sign only when negative: `-12` → `"−$12.00"`, `12` → `"$12.00"`. */
export const autoDollars = (value: number, decimals = 2): string =>
  `${value < 0 ? MINUS : ''}$${money(value, decimals)}`;

/** Short form for axis ticks: `1234` → `"$1.2k"`, `1250000` → `"$1.3M"`. */
export const compactDollars = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};

/** `0.687` → `"68.7%"`. Input is a ratio unless `alreadyPercent`. */
export const percent = (value: number, decimals = 1, alreadyPercent = false): string =>
  `${(alreadyPercent ? value : value * 100).toFixed(decimals)}%`;

/** `-0.33` → `"−33%"`, `0.12` → `"+12%"`. Input is a ratio unless `alreadyPercent`. */
export const signedPercent = (value: number, decimals = 0, alreadyPercent = false): string => {
  const n = alreadyPercent ? value : value * 100;
  return `${n < 0 ? MINUS : '+'}${Math.abs(n).toFixed(decimals)}%`;
};

/** `"2026-07"` → `"July 2026"`. */
export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

/** `"2026-07"` → `"Jul 2026"`. */
export const shortMonthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

/** `"2026-07"` → `"Jul"`. */
export const monthTick = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
};

/** `"2026-07-18"` → `"Jul 18"`. */
export const dayLabel = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** `"2026-07-18"` → `"Saturday, July 18"`. Used in tooltips and aria labels. */
export const longDayLabel = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};

/** "in 3 days" / "tomorrow" / "today" / "5 days ago". */
export const relativeDays = (days: number): string => {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
};

/** Pluralise without a dependency: `plural(1, 'category')` → `"1 category"`. */
export const plural = (count: number, singular: string, pluralForm?: string): string =>
  `${count} ${count === 1 ? singular : pluralForm ?? `${singular}s`}`;
