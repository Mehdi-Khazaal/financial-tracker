import React from 'react';
import CountUp from '../../../components/CountUp';
import Sparkline from '../../../components/Sparkline';
import { InfoHint } from '../../analytics/components/AnalyticsPrimitives';
import { dollars, signedPercent } from '../../analytics/format';
import type { MonthActivity, SpendingComparison } from '../types';
import type { NetWorthTrend } from '../useOverviewModel';

/**
 * The net-worth hero.
 *
 * The loudest thing on the page, and now the only thing in this card: what you
 * are worth, how that has moved, and what you can actually spend today.
 *
 * The month totals and the asset pools that used to share this card moved out
 * to the metric band. They were secondary questions competing with the primary
 * one, and worse, assets and investments are *excluded* from net worth — sitting
 * them inside a card headed "Net Worth" implied the opposite of the truth.
 */

export const NET_WORTH_DEFINITION =
  'The total of your account balances — checking, savings, cash and credit cards — with credit-card balances subtracting. Investments and physical assets are tracked separately and are not included here, which is the same definition Analytics and the net-worth chart use.';

export const AVAILABLE_DEFINITION =
  'Money in checking and cash accounts, which you can spend without moving anything first. Savings balances, investments and credit are excluded.';

interface Props {
  netWorth: NetWorthTrend;
  availableToSpend: number;
  activity: MonthActivity;
  comparison: SpendingComparison;
}

const toneColor: Record<SpendingComparison['tone'], string> = {
  positive: 'var(--pos)',
  negative: 'var(--neg)',
  neutral: 'var(--muted)',
};

const OverviewHero: React.FC<Props> = ({
  netWorth, availableToSpend, activity, comparison,
}) => {
  const sparkValues = netWorth.points.map(p => p.value);

  // Spoken equivalent of the sparkline, so the trend is not sighted-only.
  const chartSummary = netWorth.hasTrend
    ? `Net worth over ${netWorth.timeframeLabel.toLowerCase()}: ${dollars(netWorth.start)} in ${netWorth.points[0].label}, ${dollars(netWorth.current)} now, a change of ${netWorth.change < 0 ? 'minus ' : ''}${dollars(Math.abs(netWorth.change))}.`
    : '';

  return (
    <section
      className="hero-card rounded-xl p-6 md:p-8"
      aria-labelledby="overview-net-worth-label"
      style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', boxShadow: 'var(--edge-light), var(--shadow-card)' }}
    >
      {/* One card, one question: what am I worth, and what can I spend. The
          month totals and the excluded pools moved to the metric band below —
          printing them here implied they were part of this figure. */}
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-3">
            <p className="label" id="overview-net-worth-label">Net Worth</p>
            <InfoHint label="How net worth is calculated" text={NET_WORTH_DEFINITION} />
          </div>

          <p className="value-display" style={{ fontSize: 'clamp(2.25rem, 5vw, 4rem)' }}>
            $<CountUp value={netWorth.current} duration={1100} />
          </p>

          {/* Timeframe, dollar change and percentage change — all three named. */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-2.5">
            <span className="label">{netWorth.timeframeLabel}</span>
            {netWorth.hasTrend && netWorth.change !== 0 && (
              <>
                <span
                  className="font-mono tabular-nums text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    color: netWorth.change >= 0 ? 'var(--pos)' : 'var(--neg)',
                    backgroundColor: netWorth.change >= 0 ? 'var(--pos-dim)' : 'var(--neg-dim)',
                  }}
                >
                  {netWorth.change >= 0 ? '↑' : '↓'} {dollars(Math.abs(netWorth.change))}
                  {netWorth.pctChange != null && ` · ${signedPercent(netWorth.pctChange)}`}
                </span>
                <span className="font-mono tabular-nums text-[11px]" style={{ color: 'var(--dim)' }}>
                  from {dollars(netWorth.start)}
                </span>
              </>
            )}
            {!netWorth.hasTrend && (
              <span className="text-[11px]" style={{ color: 'var(--dim)' }}>
                A trend appears once there are two months of history.
              </span>
            )}
          </div>

          {sparkValues.length > 1 && (
            <figure className="blurrable mt-5 -mx-1 mb-0" style={{ height: 52 }} role="img" aria-label={chartSummary}>
              <Sparkline data={sparkValues} height={52} color="#F97316" />
            </figure>
          )}

          <div className="flex flex-wrap gap-8 md:gap-12 mt-5 pt-5" style={{ borderTop: '1px solid var(--line)' }}>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="label">Available to spend</p>
                <InfoHint label="What available to spend means" text={AVAILABLE_DEFINITION} />
              </div>
              <p className="font-mono tabular-nums text-sm font-medium" style={{ color: 'var(--pos)' }}>
                {dollars(availableToSpend)}
              </p>
            </div>

            {comparison.kind !== 'none' && (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <p className="label">{comparison.label}</p>
                  <InfoHint label="What this comparison measures" text={comparison.hint} />
                </div>
                {/* Sans with tabular figures: it is a sentence, not a number.
                    The `tabular-nums` class is also what privacy mode blurs. */}
                <p className="text-sm font-medium tabular-nums" style={{ color: toneColor[comparison.tone] }}>
                  {comparison.text}
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Why the numbers above look the way they do. Only when they need saying. */}
      {activity.headline && (
        <div
          className="relative mt-5 pt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1"
          style={{ zIndex: 1, borderTop: '1px solid var(--line)' }}
          role="status"
        >
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
