import React, { useState } from 'react';
import type { MonthSnapshot } from '../../../types';
import Sparkline from '../../../components/Sparkline';
import { InfoHint } from '../../analytics/components/AnalyticsPrimitives';
import { dollars, signedPercent } from '../../analytics/format';
import {
  availableRanges,
  buildNetWorthRange,
  type RangeMonths,
} from '../calculations/netWorthRange';

/**
 * Net worth over time — Portfolio's headline.
 *
 * The Dashboard keeps its compact sparkline as the glance view; this is the
 * deeper one, with range controls, start and current, and the high and low.
 * Both read the same `/history/net-worth` series, so there is exactly one
 * definition of net worth in the app and this component does not contain it.
 *
 * Ranges are only offered when the stored history can fill them — a 24M button
 * that renders the same four months as the 6M one is a control that does
 * nothing.
 */

export const TREND_DEFINITION =
  'Month-end account balances, excluding brokerage, with credit-card balances subtracting. '
  + 'The same definition the dashboard and the Accounts page use. Investment holdings are '
  + 'valued separately below, so nothing is counted twice.';

interface Props {
  snapshots: MonthSnapshot[];
}

const NetWorthTrend: React.FC<Props> = ({ snapshots }) => {
  const ranges = availableRanges(snapshots);
  // Default to the widest view the data supports — the longer arc is the story.
  const [months, setMonths] = useState<RangeMonths>(ranges[ranges.length - 1] ?? 6);

  const range = buildNetWorthRange(snapshots, ranges.includes(months) ? months : (ranges[ranges.length - 1] ?? 6));
  const positive = range.change >= 0;

  return (
    <section
      className="hero-card rounded-xl p-5 md:p-6"
      aria-labelledby="portfolio-trend-heading"
      style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', boxShadow: 'var(--edge-light), var(--shadow-card)' }}
    >
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <h2 className="label" id="portfolio-trend-heading">Net worth over time</h2>
              <InfoHint label="How net worth is calculated" text={TREND_DEFINITION} />
            </div>
            <p className="value-display" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)' }}>
              {dollars(range.current)}
            </p>
          </div>

          {ranges.length > 1 && (
            <div
              className="flex p-1 rounded-xl gap-0.5 shrink-0"
              style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}
              role="group"
              aria-label="Trend range"
            >
              {ranges.map(option => {
                const active = option === months;
                return (
                  <button
                    key={option}
                    onClick={() => setMonths(option)}
                    aria-pressed={active}
                    className="px-3 text-xs font-semibold rounded-lg transition-all"
                    style={active
                      ? { backgroundColor: 'var(--elev-2)', color: 'var(--fg)', border: '1px solid var(--line-strong)', minHeight: 34 }
                      : { color: 'var(--muted)', border: '1px solid transparent', minHeight: 34 }}
                  >
                    {option}M
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {range.hasTrend ? (
          <>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-2.5">
              <span className="label">{range.label}</span>
              <span
                className="font-mono tabular-nums text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  color: positive ? 'var(--pos)' : 'var(--neg)',
                  backgroundColor: positive ? 'var(--pos-dim)' : 'var(--neg-dim)',
                }}
              >
                {positive ? '↑' : '↓'} {dollars(Math.abs(range.change))}
                {range.pctChange != null && ` · ${signedPercent(range.pctChange)}`}
              </span>
              <span className="font-mono tabular-nums text-[11px]" style={{ color: 'var(--dim)' }}>
                from {dollars(range.start)}
              </span>
            </div>

            <figure
              className="blurrable mt-5 -mx-1 mb-0"
              style={{ height: 96 }}
              role="img"
              aria-label={range.summary}
            >
              <Sparkline data={range.points.map(p => p.value)} height={96} color="#F97316" />
            </figure>

            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3 mt-5 pt-5"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <div>
                <p className="label mb-1">Start</p>
                <p className="font-mono tabular-nums text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  {dollars(range.start)}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>{range.points[0].label}</p>
              </div>
              <div>
                <p className="label mb-1">Now</p>
                <p className="font-mono tabular-nums text-xs font-semibold" style={{ color: 'var(--fg)' }}>
                  {dollars(range.current)}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>
                  {range.points[range.points.length - 1].label}
                </p>
              </div>
              {range.high && (
                <div>
                  <p className="label mb-1">High</p>
                  <p className="font-mono tabular-nums text-xs font-semibold" style={{ color: 'var(--pos)' }}>
                    {dollars(range.high.value)}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>{range.high.label}</p>
                </div>
              )}
              {range.low && (
                <div>
                  <p className="label mb-1">Low</p>
                  <p className="font-mono tabular-nums text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    {dollars(range.low.value)}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>{range.low.label}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm mt-3 max-w-md leading-relaxed" style={{ color: 'var(--muted)' }}>
            {snapshots.length === 0
              ? 'No month-end snapshots have been recorded yet. A trend appears once your accounts have been tracked across two months — nothing is wrong, there is simply nothing to plot.'
              : 'Only one month of history so far, which is a position rather than a trend. A second month-end snapshot will draw the first line.'}
          </p>
        )}

        {/* Stated whenever the number is a change, not just the sign. */}
        {range.hasTrend && (
          <p className="sr-only">{range.summary}</p>
        )}
      </div>
    </section>
  );
};

export default NetWorthTrend;
