import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
          {/* Section titles are phrases ("What was left this month"), so "How … is calculated" read badly. */}
          {hint && <InfoHint label={`About "${title}"`} text={hint} />}
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

/** Gap between the tooltip and the viewport edge, and between it and the button. */
const HINT_EDGE = 12;
const HINT_GAP = 8;

/**
 * A real button, not a hover-only div: hover and keyboard focus preview the
 * explanation, and a click (or tap) pins it open until a second click, an
 * outside click or Escape.
 *
 * The click must pin rather than toggle. A mouse fires `mouseenter` before
 * `click`, and a touch screen emulates the same pair on tap, so a toggle saw
 * the hover open the tooltip and the click immediately close it — clicking a
 * "?" showed nothing.
 *
 * The tooltip is portalled to `<body>` with fixed coordinates clamped to the
 * viewport. Rendered in place it was clipped by cards with `overflow: hidden`,
 * ran off-screen when the "?" sat near an edge on a phone, and `.stagger-in`
 * transforms would have broken `position: fixed` inside the page.
 */
export const InfoHint: React.FC<InfoHintProps> = ({ label, text }) => {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const id = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const button = buttonRef.current;
      const tip = tipRef.current;
      if (!button || !tip) return;
      const anchor = button.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const maxLeft = window.innerWidth - width - HINT_EDGE;
      const left = Math.max(HINT_EDGE, Math.min(anchor.left + anchor.width / 2 - width / 2, maxLeft));
      const below = anchor.bottom + HINT_GAP;
      const above = anchor.top - HINT_GAP - height;
      // Prefer below; flip above only when below would run off the screen and above fits.
      const top = below + height > window.innerHeight - HINT_EDGE && above >= HINT_EDGE ? above : below;
      setPosition({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const tooltip = open ? (
    <span
      ref={tipRef}
      // Portalled, but React still bubbles its events through the tree; keep a
      // click on the explanation from reaching a surrounding link.
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      id={`hint-${id}`}
      role="tooltip"
      className="menu-surface fixed p-3 text-xs font-normal normal-case tracking-normal"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        // Measured before it is placed, so it never flashes at the corner.
        visibility: position ? 'visible' : 'hidden',
        width: 'min(260px, calc(100vw - 24px))',
        color: 'var(--muted)',
        lineHeight: 1.55,
        textAlign: 'left',
        whiteSpace: 'normal',
        zIndex: 'var(--z-toast)' as React.CSSProperties['zIndex'],
      }}
    >
      {text}
    </span>
  ) : null;

  return (
    <span ref={wrapRef} className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? `hint-${id}` : undefined}
        onClick={(e) => {
          // The hint often sits inside a tile that is a link (the dashboard
          // metrics) or a clickable heading. The click is for the hint: without
          // both calls, clicking "?" navigated to the tile's page instead.
          e.preventDefault();
          e.stopPropagation();
          if (pinned) close();
          else {
            setPinned(true);
            setOpen(true);
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => { if (!pinned) setOpen(false); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (!pinned) setOpen(false); }}
        // A 24 px target (WCAG 2.5.8) around the same 16 px circle.
        className="inline-flex items-center justify-center rounded-full -m-1"
        style={{ width: 24, height: 24 }}
      >
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center rounded-full transition-colors"
          style={{
            width: 16, height: 16,
            border: '1px solid var(--line-strong)',
            color: open ? 'var(--accent)' : 'var(--dim)',
            fontSize: 10, fontFamily: 'var(--font-mono)', lineHeight: 1,
          }}
        >
          ?
        </span>
      </button>
      {tooltip && createPortal(tooltip, document.body)}
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
  // Compare at the precision that is displayed. Unchanged income used to show
  // a red "+0%", reading as bad news when nothing moved.
  const shown = format === 'percent'
    ? Math.round(value * 100)
    : format === 'points'
      ? Math.round(value * 1000)
      : Math.round(value * 100);
  const flat = shown === 0;
  const good = polarity === 'neutral' || flat ? null : polarity === 'up-good' ? value > 0 : value < 0;
  const color = good === null ? 'var(--muted)' : good ? 'var(--pos)' : 'var(--neg)';
  const background = good === null
    ? 'var(--elev-sub)'
    : good ? 'var(--pos-dim)' : 'var(--neg-dim)';
  const text = flat
    ? format === 'percent' ? '0%' : format === 'points' ? '0.0 pp' : '$0.00'
    : format === 'percent'
      ? signedPercent(value)
      : format === 'points'
        ? percentagePoints(value)
        : signedDollars(value);
  // The arrow gives direction without relying on colour alone.
  const arrow = flat ? '' : value > 0 ? '↑ ' : '↓ ';

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
