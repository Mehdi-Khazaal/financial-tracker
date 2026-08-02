import React from 'react';

/**
 * `semantics` decides what a high percentage *means*, which is the whole
 * problem this component used to have. `colorAuto` was written for credit
 * utilisation — green under 30%, red over 70% — and then reused for savings
 * goals, so finishing a goal turned the bar red. Utilisation and progress run
 * in opposite directions and cannot share one scale.
 *
 * `utilization` keeps the original behaviour so the Accounts and Cards views
 * are untouched. `progress` treats more as better. Callers that already pass an
 * explicit `color` are unaffected either way.
 */
export type ProgressSemantics = 'utilization' | 'progress';

interface Props {
  value: number;
  showLabel?: boolean;
  colorAuto?: boolean;
  color?: string;
  height?: number;
  /** Defaults to `utilization`, preserving the historical `colorAuto` scale. */
  semantics?: ProgressSemantics;
  /**
   * Accessible name. Supplying one promotes the bar to a real `progressbar`
   * with its value announced; without one it stays presentational, which is
   * correct where the percentage already sits beside it as text.
   */
  label?: string;
}

const utilizationColor = (pct: number): string => {
  if (pct < 30) return 'var(--pos)';
  if (pct < 70) return '#f59e0b';
  return 'var(--neg)';
};

const progressColor = (pct: number): string => {
  if (pct >= 100) return 'var(--pos)';
  if (pct <= 0) return 'var(--dim)';
  return 'var(--accent)';
};

const ProgressBar: React.FC<Props> = ({
  value,
  showLabel = false,
  colorAuto = true,
  color,
  height = 6,
  semantics = 'utilization',
  label,
}) => {
  const pct = Math.min(100, Math.max(0, value));
  let barColor = color ?? 'var(--accent)';
  if (colorAuto && !color) {
    barColor = semantics === 'progress' ? progressColor(pct) : utilizationColor(pct);
  }

  // Glow reads as emphasis. On a goal that only makes sense once it is reached;
  // on utilisation it is the warning that the limit is close.
  const isNearComplete = semantics === 'progress' ? pct >= 100 : pct >= 80;

  return (
    <div>
      <div
        className="progress-track w-full rounded-full overflow-hidden"
        style={{ height, backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}
        {...(label
          ? {
            role: 'progressbar' as const,
            'aria-label': label,
            'aria-valuenow': Math.round(pct),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          }
          : {})}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            backgroundColor: barColor,
            boxShadow: isNearComplete ? `0 0 8px ${barColor}80, 0 0 2px ${barColor}` : 'none',
          }}
        />
      </div>
      {showLabel && (
        <p className="font-mono text-xs mt-1 text-right" style={{ color: 'var(--muted)', fontSize: '10px', letterSpacing: '0.05em' }}>{pct.toFixed(0)}%</p>
      )}
    </div>
  );
};

export default ProgressBar;
