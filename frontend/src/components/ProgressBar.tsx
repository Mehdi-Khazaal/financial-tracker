import React from 'react';

interface Props {
  value: number;
  showLabel?: boolean;
  colorAuto?: boolean;
  color?: string;
  height?: number;
}

const ProgressBar: React.FC<Props> = ({
  value,
  showLabel = false,
  colorAuto = true,
  color,
  height = 6,
}) => {
  const pct = Math.min(100, Math.max(0, value));
  let barColor = color ?? 'var(--accent)';
  if (colorAuto && !color) {
    if (pct < 30)       barColor = 'var(--pos)';
    else if (pct < 70)  barColor = '#f59e0b';
    else                barColor = 'var(--neg)';
  }

  const isNearComplete = pct >= 80;

  return (
    <div>
      <div className="w-full rounded-full overflow-hidden" style={{ height, backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
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
