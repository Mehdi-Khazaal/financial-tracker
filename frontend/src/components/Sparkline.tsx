import React, { useId, useMemo } from 'react';

type Props = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** draws the line in over ~900ms on mount */
  animate?: boolean;
  className?: string;
};

/** Lightweight SVG sparkline — smooth cubic path, gradient fill, glowing
    endpoint. Pure transform/opacity/stroke animation, no chart library. */
const Sparkline: React.FC<Props> = ({ data, width = 480, height = 72, color = '#F97316', animate = true, className }) => {
  const uid = useId().replace(/:/g, '');

  const { linePath, areaPath, lastX, lastY } = useMemo(() => {
    if (data.length < 2) return { linePath: '', areaPath: '', lastX: 0, lastY: 0 };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const padY = height * 0.14;
    const usable = height - padY * 2;
    const pts = data.map((v, i) => ({
      x: (i / (data.length - 1)) * width,
      y: padY + usable * (1 - (v - min) / span),
    }));

    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx.toFixed(2)} ${p0.y.toFixed(2)}, ${cx.toFixed(2)} ${p1.y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
    }
    const last = pts[pts.length - 1];
    const area = `${d} L ${width} ${height} L 0 ${height} Z`;
    return { linePath: d, areaPath: area, lastX: last.x, lastY: last.y };
  }, [data, width, height]);

  if (!linePath) return null;

  const reduce = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const drawIn = animate && !reduce;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }} aria-hidden="true">
      <defs>
        <linearGradient id={`sg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.16} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#sg-${uid})`}
        style={drawIn ? { animation: 'sparkFill 700ms ease 350ms both' } : undefined} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2}
        strokeLinecap="round" vectorEffect="non-scaling-stroke"
        className="spark-path"
        style={drawIn ? {
          strokeDasharray: 1600,
          ['--spark-len' as any]: 1600,
          animation: 'sparkDraw 900ms cubic-bezier(0.77, 0, 0.175, 1) both',
        } : undefined} />
      <circle cx={lastX} cy={lastY} r={3} fill={color}
        style={{
          filter: `drop-shadow(0 0 4px ${color})`,
          ...(drawIn ? { animation: 'sparkFill 300ms ease 800ms both' } : {}),
        }} />
    </svg>
  );
};

export default Sparkline;
