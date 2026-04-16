import React from 'react';

interface Props {
  value: number;     // 0–100
  showLabel?: boolean;
  colorAuto?: boolean;   // auto-pick green/orange/red based on value
  color?: string;        // custom color override
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
  let barColor = color ?? '#6366f1';
  if (colorAuto && !color) {
    if (pct < 30) barColor = '#10b981';
    else if (pct < 70) barColor = '#f59e0b';
    else barColor = '#f43f5e';
  }

  return (
    <div>
      <div className="w-full rounded-full overflow-hidden" style={{ height, backgroundColor: '#1a1f2e' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      {showLabel && (
        <p className="text-xs font-mono text-muted mt-1 text-right">{pct.toFixed(0)}%</p>
      )}
    </div>
  );
};

export default ProgressBar;
