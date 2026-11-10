import React from 'react';
import CountUp from '../../../components/CountUp';
import Sparkline from '../../../components/Sparkline';
import { InfoHint } from '../../analytics/components/AnalyticsPrimitives';
import { dollars, signedPercent } from '../../analytics/format';

/** A balance can be negative; `dollars` drops the sign. */
const signedDollars = (value: number) => (value < 0 ? '−' : '') + dollars(Math.abs(value));
import type { MonthActivity, SpendingComparison } from '../types';
import type { NetWorthTrend } from '../useOverviewModel';

/**
 * The net-worth hero.
 *
 * The loudest thing on the page, and now the only thing in this card: what you
 * are worth, how that has moved, and what you can actually spend today.
 *
 * Net worth counts holdings: account balances plus everything you hold at its
 * current value. It used to be balances only, with a second "including
 * holdings" figure beside it, so buying gold read as a loss and the page
 * carried two net worths. The split now sits under the one number instead.
 */

export const NET_WORTH_DEFINITION =
  'Your account balances (checking, savings, cash, with credit-card balances subtracting) plus everything you hold at its current value: a market price for stocks, funds and coins, and what you recorded for the rest. Buying an asset with cash leaves it unchanged. The same figure as Analytics, Portfolio, Accounts, the charts and Fin.';

export const AVAILABLE_DEFINITION =
  'Money in checking and cash accounts, which you can spend without moving anything first. Savings balances, investments and credit are excluded.';

interface Props {
  netWorth: NetWorthTrend;
  availableToSpend: number;
  /** The two parts of net worth, or null when nothing is held. */
  parts: { accounts: number; holdings: number } | null;
  activity: MonthActivity;
  comparison: SpendingComparison;
}

const toneColor: Record<SpendingComparison['tone'], string> = {
  positive: 'var(--pos)',
  negative: 'var(--neg)',
  neutral: 'var(--muted)',
};

const OverviewHero: React.FC<Props> = ({
  netWorth, availableToSpend, parts, activity, comparison,
}) => {
  const sparkValues = netWorth.points.map(p => p.value);

  // Spoken equivalent of the sparkline, so the trend is not sighted-only.
  const chartSummary = netWorth.hasTrend
    ? `Net worth over ${netWorth.timeframeLabel.toLowerCase()}: ${dollars(netWorth.start)} in ${netWorth.points[0].label}, ${dollars(netWorth.current)} now, a change of ${netWorth.change < 0 ? 'minus ' : ''}${dollars(Math.abs(netWorth.change))}.`
    : '';

  return (
    <section
      className="pb-7"
      aria-labelledby="overview-net-worth-label"
      style={{ borderBottom: '1px solid var(--line)' }}
    >
      {/* One question: what am I worth, and what can I spend. No box around
          it; the size of the number carries the hierarchy. */}
      <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
        <div className="min-w-0 mr-auto">
          <div className="flex items-center gap-1.5 mb-2">
            <h2 className="text-[13px] font-medium" id="overview-net-worth-label" style={{ color: 'var(--muted)' }}>Net Worth</h2>
            <InfoHint label="How net worth is calculated" text={NET_WORTH_DEFINITION} />
          </div>

          <p className="value-display" style={{ fontSize: 'clamp(2.5rem, 5vw, 3.5rem)', letterSpacing: '-0.025em' }}>
            $<CountUp value={netWorth.current} duration={900} />
          </p>

          {/* Timeframe, dollar change and percentage change — all three named. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-3 text-sm" style={{ color: 'var(--muted)' }}>
            <span>{netWorth.timeframeLabel}</span>
            {netWorth.hasTrend && netWorth.change !== 0 && (
              <>
                <span
                  className="font-mono tabular-nums font-semibold"
                  style={{ color: netWorth.change >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                >
                  {netWorth.change >= 0 ? '+' : '−'}{dollars(Math.abs(netWorth.change))}
                  {netWorth.pctChange != null && ` · ${signedPercent(netWorth.pctChange)}`}
                </span>
                <span className="font-mono tabular-nums" style={{ color: 'var(--dim)' }}>
                  from {dollars(netWorth.start)}
                </span>
              </>
            )}
            {!netWorth.hasTrend && (
              <span style={{ color: 'var(--dim)' }}>
                A trend appears once there are two months of history.
              </span>
            )}
          </div>

          {/* What the number is made of. Suppressed when nothing is held,
              because then it is all accounts. */}
          {parts != null && (
            <p className="font-mono tabular-nums text-xs mt-1" style={{ color: 'var(--dim)' }}>
              {signedDollars(parts.accounts)} in accounts · {dollars(parts.holdings)} in holdings
            </p>
          )}
        </div>

        {sparkValues.length > 1 && (
          <figure className="blurrable m-0 w-full sm:w-[340px]" style={{ height: 72 }} role="img" aria-label={chartSummary}>
            <Sparkline data={sparkValues} height={72} color="var(--accent)" />
          </figure>
        )}
      </div>

      <div className="flex flex-wrap gap-x-10 gap-y-4 mt-6">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Available to spend</p>
            <InfoHint label="What available to spend means" text={AVAILABLE_DEFINITION} />
          </div>
          <p className="font-mono tabular-nums text-base font-semibold" style={{ color: 'var(--fg)' }}>
            {dollars(availableToSpend)}
          </p>
        </div>

        {comparison.kind !== 'none' && (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{comparison.label}</p>
              <InfoHint label="What this comparison measures" text={comparison.hint} />
            </div>
            {/* Sans with tabular figures: it is a sentence, not a number.
                The `tabular-nums` class is also what privacy mode blurs. */}
            <p className="text-base font-medium tabular-nums" style={{ color: toneColor[comparison.tone] }}>
              {comparison.text}
            </p>
          </div>
        )}
      </div>

      {/* Why the numbers above look the way they do. Only when they need saying. */}
      {activity.headline && (
        <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1" role="status">
          <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{activity.headline}</p>
          {activity.detail && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{activity.detail}</p>
          )}
          {activity.lastPostedLabel && activity.lastPostedIsEarlier && (
            <p className="text-xs font-mono" style={{ color: 'var(--dim)' }}>
              Last posted transaction: {activity.lastPostedLabel}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default OverviewHero;
