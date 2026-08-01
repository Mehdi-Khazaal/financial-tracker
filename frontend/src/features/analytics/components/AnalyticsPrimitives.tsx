import React, { useEffect, useId, useRef, useState } from 'react';
import { MINUS, percentagePoints, signedDollars, signedPercent } from '../format';

/**
 * Shared building blocks for the Analytics page.
 *
 * These exist so the page reads as one system: every section header, every
 * explanation tooltip, and every change badge is the same component rather
 * than a slightly different inline copy. All of them sit on the existing
 * Ledger design tokens — no new colours are introduced here.
 */

// ── Section header ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  hint?: string;
  right?: React.ReactNode;
  /** Heading level for the document outline. Defaults to h2. */
  as?: 'h2' | 'h3';
  id?: string;
  /**
   * Makes the whole section collapsible. The heading becomes the toggle, so
   * there is one obvious control rather than a separate chevron competing
   * with the title for attention.
   */
  toggle?: { open: boolean; onToggle: () => void; controls: string };
  /** Shown beside the title when collapsed — keeps the headline value visible. */
  collapsedSummary?: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  eyebrow, title, description, hint, right, as = 'h2', id, toggle, collapsedSummary,
}) => {
  const Heading = as;

  const heading = (
    <Heading id={id} className="text-base font-semibold" style={{ color: 'var(--fg)' }}>
      {title}
    </Heading>
  );

  return (
    <div className={`flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 ${toggle && !toggle.open ? '' : 'mb-4'}`}>
      <div className="min-w-0 flex-1">
        <p className="label mb-1">{eyebrow}</p>
        <div className="flex items-center gap-1.5 min-w-0">
          {toggle ? (
            <button
              type="button"
              onClick={toggle.onToggle}
              aria-expanded={toggle.open}
              aria-controls={toggle.controls}
              className="flex items-center gap-1.5 min-w-0 text-left pressable"
              style={{ minHeight: 32 }}
            >
              {heading}
              <svg
                viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                className="w-4 h-4 shrink-0"
                style={{
                  color: 'var(--muted)',
                  transform: toggle.open ? 'rotate(180deg)' : 'none',
                  transition: 'transform 180ms var(--ease-out)',
                }}
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          ) : heading}
          {hint && <InfoHint label={`How ${title} is calculated`} text={hint} />}
        </div>
        {description && (toggle ? toggle.open : true) && (
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--muted)' }}>{description}</p>
        )}
        {toggle && !toggle.open && collapsedSummary && (
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{collapsedSummary}</p>
        )}
      </div>
      {right && <div className="shrink-0 self-start">{right}</div>}
    </div>
  );
};

// ── Explanation tooltip ───────────────────────────────────────────────────────

interface InfoHintProps {
  label: string;
  text: string;
}

/**
 * A real button, not a hover-only div: it opens on click and on focus, so the
 * explanation is reachable by keyboard and on touch. Escape and outside clicks
 * dismiss it.
 */
export const InfoHint: React.FC<InfoHintProps> = ({ label, text }) => {
  const [open, setOpen] = useState(false);
  const id = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? `hint-${id}` : undefined}
        onClick={() => setOpen(v => !v)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center rounded-full transition-colors"
        style={{
          width: 16, height: 16,
          border: '1px solid var(--line-strong)',
          color: open ? 'var(--accent)' : 'var(--dim)',
          fontSize: 10, fontFamily: 'var(--font-mono)', lineHeight: 1,
        }}
      >
        ?
      </button>
      {open && (
        <span
          id={`hint-${id}`}
          role="tooltip"
          className="menu-surface absolute left-1/2 top-full mt-2 p-3 text-xs font-normal normal-case tracking-normal"
          style={{
            width: 'min(260px, calc(100vw - 3rem))',
            transform: 'translateX(-50%)',
            color: 'var(--muted)',
            lineHeight: 1.55,
            zIndex: 'var(--z-toast)' as React.CSSProperties['zIndex'],
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
};

// ── Change badge ──────────────────────────────────────────────────────────────

interface DeltaBadgeProps {
  value: number;
  /**
   * `dollars` renders ±$x, `percent` renders ±x%, `points` renders ±x pp.
   * Use `points` for the gap between two rates — a savings rate going from
   * 27.2% to 79.1% moved 51.9 points, and calling that "+191%" overstates it.
   */
  format?: 'dollars' | 'percent' | 'points';
  /**
   * Which direction is good. `down-good` is the default for spending, where
   * less is an improvement. Use `neutral` when neither direction is a verdict.
   */
  polarity?: 'up-good' | 'down-good' | 'neutral';
  /** Text appended after the number, e.g. "vs average". */
  suffix?: string;
  size?: 'sm' | 'md';
}

export const DeltaBadge: React.FC<DeltaBadgeProps> = ({
  value, format = 'dollars', polarity = 'down-good', suffix, size = 'sm',
}) => {
  const good = polarity === 'neutral' ? null : polarity === 'up-good' ? value > 0 : value < 0;
  const color = good === null ? 'var(--muted)' : good ? 'var(--pos)' : 'var(--neg)';
  const background = good === null
    ? 'var(--elev-sub)'
    : good ? 'var(--pos-dim)' : 'var(--neg-dim)';
  const text = format === 'percent'
    ? signedPercent(value)
    : format === 'points'
      ? percentagePoints(value)
      : signedDollars(value);
  // The arrow gives direction without relying on colour alone.
  const arrow = value === 0 ? '' : value > 0 ? '↑ ' : '↓ ';

  return (
    <span
      className="inline-flex items-center rounded-full font-mono tabular-nums font-semibold whitespace-nowrap"
      style={{
        color,
        backgroundColor: background,
        fontSize: size === 'md' ? 11 : 10,
        padding: size === 'md' ? '3px 9px' : '2px 7px',
      }}
    >
      {arrow}{text}{suffix ? ` ${suffix}` : ''}
    </span>
  );
};

// ── Confidence chip ───────────────────────────────────────────────────────────

export const ConfidenceChip: React.FC<{ months: number }> = ({ months }) => {
  if (months <= 0) return null;
  const weak = months <= 2;
  return (
    <span
      className="inline-flex items-center rounded-full font-mono whitespace-nowrap"
      style={{
        fontSize: 9,
        padding: '2px 6px',
        color: weak ? '#f59e0b' : 'var(--dim)',
        backgroundColor: weak ? 'rgba(245,158,11,0.12)' : 'var(--elev-sub)',
      }}
      title={weak
        ? `Average based on only ${months} month${months === 1 ? '' : 's'} — treat as a rough guide`
        : `Average based on ${months} completed months`}
    >
      {months}mo avg
    </span>
  );
};

// ── Collapsible section ───────────────────────────────────────────────────────

interface CollapsibleProps {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Accessible name for the toggle. */
  label: string;
}

export const Collapsible: React.FC<CollapsibleProps> = ({
  summary, children, defaultOpen = false, label,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId().replace(/:/g, '');
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={`collapse-${id}`}
        aria-label={label}
        className="w-full flex items-center justify-between gap-3 text-left rounded-lg transition-colors pressable"
        style={{ minHeight: 44, color: 'var(--muted)' }}
      >
        <span className="min-w-0">{summary}</span>
        <svg
          viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
          className="w-4 h-4 shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms var(--ease-out)' }}
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      <div id={`collapse-${id}`} hidden={!open}>
        {open && <div className="pt-3">{children}</div>}
      </div>
    </div>
  );
};

// ── Empty / partial states ────────────────────────────────────────────────────

export const PanelEmpty: React.FC<{ title: string; body?: string; action?: React.ReactNode }> = ({
  title, body, action,
}) => (
  <div className="flex flex-col items-center justify-center text-center py-8 px-4 gap-2">
    <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{title}</p>
    {body && <p className="text-xs max-w-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{body}</p>}
    {action}
  </div>
);

// ── Chart tooltip shell ───────────────────────────────────────────────────────

/** Shared Recharts tooltip chrome — matches `.menu-surface` without importing it. */
export const chartTooltipProps = {
  contentStyle: {
    backgroundColor: 'var(--elev-sub)',
    border: '1px solid var(--line-strong)',
    borderRadius: 12,
    fontSize: 12,
    color: 'var(--fg)',
    boxShadow: 'var(--shadow-modal)',
  },
  cursor: { fill: 'oklch(72% 0.17 55 / 0.06)' },
  wrapperStyle: { zIndex: 80, pointerEvents: 'none' as const, outline: 'none' },
  allowEscapeViewBox: { x: false, y: true },
};

/** Renders a number the same way everywhere, with the real minus sign. */
export const Amount: React.FC<{
  value: number;
  signed?: boolean;
  color?: string;
  className?: string;
  decimals?: number;
}> = ({ value, signed = false, color, className = '', decimals = 2 }) => {
  const body = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = signed ? (value < 0 ? MINUS : '+') : value < 0 ? MINUS : '';
  return (
    <span
      className={`font-mono tabular-nums ${className}`}
      style={{ color, fontVariantNumeric: 'tabular-nums' }}
    >
      {prefix}${body}
    </span>
  );
};
