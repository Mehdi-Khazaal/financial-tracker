import React, { useEffect, useState } from 'react';
import type { MetalHistoryPoint } from '../../../types';
import { getMetalHistory } from '../../../utils/api';
import { MINUS, dollars, monthLabel, shortMonthLabel } from '../../analytics/format';
import { TROY_OUNCE_GRAMS, type MetalSummary } from '../calculations/metal';

/**
 * All of one metal in one place: how much pure metal the pieces hold, what
 * they cost, what they are worth, and the price over the last year against
 * what was paid per ounce.
 */

interface Props {
  summary: MetalSummary;
}

const NAMES = { gold: 'Gold', silver: 'Silver' } as const;
const WIDTH = 600;
const HEIGHT = 140;
const PAD = 6;

const signedDollars = (value: number) => `${value < 0 ? MINUS : '+'}${dollars(Math.abs(value))}`;

const PriceChart: React.FC<{ points: { month: string; price: number }[]; averageCost: number | null; name: string }> = ({ points, averageCost, name }) => {
  const prices = points.map(p => p.price);
  const lows = averageCost != null ? [...prices, averageCost] : prices;
  const min = Math.min(...lows);
  const max = Math.max(...lows);
  const range = max - min || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (WIDTH - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / range) * (HEIGHT - PAD * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const high = points.reduce((h, p) => (p.price > h.price ? p : h), first);

  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="w-full h-32" aria-hidden="true">
        {averageCost != null && (
          <line
            x1={PAD} x2={WIDTH - PAD} y1={y(averageCost)} y2={y(averageCost)}
            stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline points={line} fill="none" stroke="var(--fg)" strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[11px] mt-1" style={{ color: 'var(--dim)' }} aria-hidden="true">
        <span>{shortMonthLabel(first.month)}</span>
        {averageCost != null && <span>Dashed: what you paid per ounce</span>}
        <span>{shortMonthLabel(last.month)}</span>
      </div>
      <figcaption className="sr-only">
        {`${name} per ounce: ${dollars(first.price, 0)} in ${monthLabel(first.month)}, ${dollars(last.price, 0)} in ${monthLabel(last.month)}, highest ${dollars(high.price, 0)} in ${monthLabel(high.month)}.`}
        {averageCost != null ? ` You paid ${dollars(averageCost, 0)} an ounce on average.` : ''}
      </figcaption>
    </figure>
  );
};

const MetalSummaryCard: React.FC<Props> = ({ summary }) => {
  const [history, setHistory] = useState<{ month: string; price: number }[]>([]);
  const name = NAMES[summary.metal];

  useEffect(() => {
    let alive = true;
    getMetalHistory(summary.metal, 12)
      .then(res => {
        if (!alive || !Array.isArray(res.data)) return;
        setHistory((res.data as MetalHistoryPoint[]).map(p => ({ month: p.month, price: Number(p.price) })).filter(p => p.price > 0));
      })
      .catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [summary.metal]);

  const grams = summary.fineOunces * TROY_OUNCE_GRAMS;
  const gainColor = summary.gain >= 0 ? 'var(--pos)' : 'var(--neg)';

  return (
    <section className="py-6" style={{ borderBottom: '1px solid var(--line)' }} aria-labelledby={`metal-${summary.metal}-heading`}>
      <h2 className="section-title" id={`metal-${summary.metal}-heading`}>{name}</h2>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
        <span className="font-semibold tabular-nums" style={{ color: 'var(--fg)' }}>{summary.fineOunces.toFixed(2)} oz</span>
        {` of pure ${summary.metal} (${grams.toFixed(1)} g) across ${summary.holdings} ${summary.holdings === 1 ? 'holding' : 'holdings'}.`}
      </p>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
        <div>
          <dt className="label">Worth today</dt>
          <dd className="font-mono tabular-nums font-semibold" style={{ color: 'var(--fg)' }}>{dollars(summary.value)}</dd>
        </div>
        <div>
          <dt className="label">Paid</dt>
          <dd className="font-mono tabular-nums" style={{ color: 'var(--fg)' }}>{dollars(summary.paid)}</dd>
        </div>
        <div>
          <dt className="label">Change</dt>
          <dd className="font-mono tabular-nums" style={{ color: gainColor }}>
            {signedDollars(summary.gain)}
            {summary.gainPct != null && ` (${summary.gainPct >= 0 ? '+' : MINUS}${(Math.abs(summary.gainPct) * 100).toFixed(1)}%)`}
          </dd>
        </div>
        {summary.averageCostPerOunce != null && (
          <div>
            <dt className="label">Paid per ounce</dt>
            <dd className="font-mono tabular-nums" style={{ color: 'var(--fg)' }}>
              {dollars(summary.averageCostPerOunce, 0)}
              {summary.spotPrice != null && (
                <span className="block text-xs font-sans" style={{ color: 'var(--muted)' }}>{dollars(summary.spotPrice, 0)} today</span>
              )}
            </dd>
          </div>
        )}
      </dl>
      {history.length >= 2 && <PriceChart points={history} averageCost={summary.averageCostPerOunce} name={name} />}
    </section>
  );
};

export default MetalSummaryCard;
