import React from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { NetWorthAnalysis } from '../types';
import { compactDollars, dollars, signedDollars, signedPercent } from '../format';
import { Amount, Collapsible, PanelEmpty, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  netWorth: NetWorthAnalysis;
  window: number;
  onWindowChange: (months: number) => void;
}

const WINDOWS = [6, 12, 24];

/**
 * Net worth over time, with the numbers people actually want off a trend line:
 * where it started, where it ended, the best and worst months, and what moved
 * most recently.
 *
 * The contributors list is phrased as "likely contributors" and every entry is
 * a figure we can point at — this month's cash flow, a specific transaction.
 * Nothing here claims to have established a cause.
 */
const NetWorthTrendCard: React.FC<Props> = ({ netWorth, window, onWindowChange }) => {
  const hasTrend = netWorth.points.length > 1;

  const summary = hasTrend
    ? `Net worth from ${netWorth.points[0].label} to ${netWorth.points[netWorth.points.length - 1].label}. `
      + `Started at ${dollars(netWorth.start)}, ended at ${dollars(netWorth.end)}, `
      + `a change of ${signedDollars(netWorth.change)}.`
    : 'Not enough net worth history to draw a trend.';

  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-networth-heading">
      <SectionHeader
        id="analytics-networth-heading"
        eyebrow="Net worth"
        title="How your position has moved"
        hint="Month-end totals across all accounts except investments, which Fintrack tracks separately in Portfolio. Snapshots are taken nightly."
        right={
          <div className="flex gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--elev-sub)' }} role="group" aria-label="Chart range">
            {WINDOWS.map(months => (
              <button
                key={months}
                type="button"
                onClick={() => onWindowChange(months)}
                aria-pressed={window === months}
                className="px-2.5 py-1.5 rounded-md text-[11px] font-mono font-semibold transition-colors"
                style={window === months
                  ? { backgroundColor: 'var(--elev-1)', color: 'var(--accent)' }
                  : { color: 'var(--muted)' }}
              >
                {months}M
              </button>
            ))}
          </div>
        }
      />

      {!hasTrend ? (
        <PanelEmpty
          title="Not enough history yet"
          body="Net worth is snapshotted at each month end. The trend appears once there are at least two months to compare."
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
            <div className="ledger-cell p-3">
              <dt className="label mb-1.5">Started</dt>
              <dd><Amount value={netWorth.start} className="text-sm font-semibold" color="var(--muted)" /></dd>
            </div>
            <div className="ledger-cell p-3">
              <dt className="label mb-1.5">Now</dt>
              <dd><Amount value={netWorth.end} className="text-sm font-semibold" color="var(--fg)" /></dd>
            </div>
            <div className="ledger-cell p-3">
              <dt className="label mb-1.5">Change</dt>
              <dd
                className="font-mono tabular-nums text-sm font-semibold"
                style={{ color: netWorth.change >= 0 ? 'var(--pos)' : 'var(--neg)' }}
              >
                {signedDollars(netWorth.change)}
              </dd>
            </div>
            <div className="ledger-cell p-3">
              <dt className="label mb-1.5">Percent</dt>
              <dd
                className="font-mono tabular-nums text-sm font-semibold"
                style={{ color: netWorth.change >= 0 ? 'var(--pos)' : 'var(--neg)' }}
              >
                {netWorth.pctChange != null ? signedPercent(netWorth.pctChange, 1) : '—'}
              </dd>
            </div>
          </dl>

          <p className="sr-only">{summary}</p>

          <div style={{ width: '100%', height: 220 }} role="img" aria-label={summary}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={netWorth.points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="analyticsNetWorthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F97316" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--dim)' }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => compactDollars(v)}
                />
                <Tooltip
                  wrapperStyle={{ zIndex: 80, pointerEvents: 'none', outline: 'none' }}
                  allowEscapeViewBox={{ x: false, y: true }}
                  cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const point = payload[0].payload as NetWorthAnalysis['points'][number];
                    return (
                      <div
                        className="p-3 rounded-xl"
                        style={{
                          backgroundColor: 'var(--elev-sub)',
                          border: '1px solid var(--line-strong)',
                          boxShadow: 'var(--shadow-modal)',
                        }}
                      >
                        <p className="label mb-1.5">{point.label}</p>
                        <p className="font-mono tabular-nums text-sm font-bold" style={{ color: 'var(--fg)' }}>
                          {dollars(point.value)}
                        </p>
                        {point.change != null && (
                          <p
                            className="font-mono tabular-nums text-[11px] mt-1"
                            style={{ color: point.change >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                          >
                            {signedDollars(point.change)} from previous month
                            {point.pctChange != null && ` (${signedPercent(point.pctChange, 1)})`}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#F97316"
                  strokeWidth={2}
                  fill="url(#analyticsNetWorthFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#F97316', stroke: 'var(--bg)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid sm:grid-cols-2 gap-2.5 mt-4">
            {[
              { label: 'Highest point', point: netWorth.high, tone: 'var(--pos)' },
              { label: 'Lowest point', point: netWorth.low, tone: 'var(--muted)' },
              { label: 'Best month', point: netWorth.bestMonth, tone: 'var(--pos)', useChange: true },
              { label: 'Weakest month', point: netWorth.worstMonth, tone: 'var(--neg)', useChange: true },
            ].filter(item => item.point).map(item => (
              <div key={item.label} className="ledger-cell p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="label mb-1">{item.label}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{item.point!.label}</p>
                </div>
                <p
                  className="font-mono tabular-nums text-sm font-semibold shrink-0"
                  style={{ color: item.tone }}
                >
                  {item.useChange
                    ? signedDollars(item.point!.change ?? 0)
                    : dollars(item.point!.value)}
                </p>
              </div>
            ))}
          </div>

          {netWorth.contributors.length > 0 && (
            <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
              <Collapsible
                label="Show likely contributors to the most recent movement"
                summary={
                  <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                    Likely contributors to the latest movement
                  </span>
                }
              >
                <ul className="space-y-2">
                  {netWorth.contributors.map(contributor => (
                    <li key={contributor.label} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>
                          {contributor.label}
                        </p>
                        <p className="text-[10px] truncate" style={{ color: 'var(--dim)' }}>
                          {contributor.detail}
                        </p>
                      </div>
                      <p
                        className="font-mono tabular-nums text-xs font-semibold shrink-0"
                        style={{ color: contributor.value >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                      >
                        {signedDollars(contributor.value)}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--dim)' }}>
                  These happened in the same month as the movement. They are not proof of what caused it —
                  account balances also move through transfers, investments, and asset revaluation.
                </p>
              </Collapsible>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default NetWorthTrendCard;
