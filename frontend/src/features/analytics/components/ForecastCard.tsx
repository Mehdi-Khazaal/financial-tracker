import React from 'react';
import type { Forecast } from '../types';
import { dollars, percent } from '../format';
import { SectionHeader } from './AnalyticsPrimitives';

interface Props {
  forecast: Forecast;
  onOpenCategory: (categoryId: number) => void;
}

const CONFIDENCE_COPY: Record<string, string> = {
  high: 'Six or more months of history behind this',
  medium: 'Four to five months of history behind this',
  low: 'Only three months of history — treat as a rough guide',
};

/**
 * Where the period is heading, when that can be said responsibly.
 *
 * The card renders nothing at all when `calculateForecast` declines — no
 * greyed-out placeholder promising a number later, because an empty forecast
 * card is worse than no forecast card. Every figure is prefixed "projected"
 * and rounded to whole dollars, since false precision is the main way
 * forecasts mislead.
 */
const ForecastCard: React.FC<Props> = ({ forecast, onOpenCategory }) => {
  if (!forecast.available || !forecast.expenses || !forecast.income) return null;

  const progress = Math.min(100, (forecast.daysElapsed / forecast.daysTotal) * 100);

  const tiles = [
    {
      key: 'expenses',
      label: 'Projected spending',
      value: dollars(forecast.expenses.projected, 0),
      // Spending is never painted red; it is what money is for.
      color: 'var(--fg)',
      footnote: `${dollars(forecast.expenses.soFar, 0)} so far`
        + (forecast.expenses.scheduled > 0 ? ` · ${dollars(forecast.expenses.scheduled, 0)} in scheduled bills` : ''),
    },
    {
      key: 'income',
      label: 'Projected income',
      value: dollars(forecast.income.projected, 0),
      color: 'var(--pos)',
      footnote: `${dollars(forecast.income.soFar, 0)} received`
        + (forecast.income.scheduled > 0 ? ` · ${dollars(forecast.income.scheduled, 0)} scheduled` : ''),
    },
    {
      key: 'savings',
      label: 'Projected saving',
      value: `${(forecast.savings ?? 0) < 0 ? '−' : ''}${dollars(Math.abs(forecast.savings ?? 0), 0)}`,
      color: (forecast.savings ?? 0) >= 0 ? 'var(--pos)' : 'var(--neg)',
      footnote: forecast.savingsRate != null
        ? `${percent(forecast.savingsRate)} savings rate`
        : 'No income projected',
    },
  ];

  return (
    <section className="report-section" aria-labelledby="analytics-forecast-heading">
      <SectionHeader
        id="analytics-forecast-heading"
        eyebrow="Projection"
        title="Month-end outlook"
        description={`Where ${forecast.monthLabel} is heading. Projections, not commitments; they firm up as the month goes on.`}
        hint="What has already happened, plus bills you have scheduled, plus a daily rate for day-to-day spending. Bills are counted once, never multiplied by the days left. The daily rate leans on your usual months early on and on this month's own pace as it fills in."
        right={
          <span
            className="text-[13px] whitespace-nowrap"
            style={{ color: forecast.confidence === 'low' ? 'var(--warn)' : 'var(--muted)' }}
            title={CONFIDENCE_COPY[forecast.confidence]}
          >
            {forecast.confidence.charAt(0).toUpperCase() + forecast.confidence.slice(1)} confidence
          </span>
        }
      />

      <div>
      <div className="mb-5">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Day {forecast.daysElapsed} of {forecast.daysTotal}
          </p>
          <p className="font-mono text-[11px]" style={{ color: 'var(--dim)' }}>
            {progress.toFixed(0)}% through
          </p>
        </div>
        <div
          className="h-1 rounded-[1px] overflow-hidden"
          style={{ backgroundColor: 'var(--line)' }}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress through the period"
        >
          <div className="h-full" style={{ width: `${progress}%`, backgroundColor: 'var(--fg)' }} />
        </div>
      </div>

      <dl className="metric-strip grid grid-cols-2 lg:grid-cols-3">
        {tiles.map(tile => (
          <div key={tile.key} className="metric-tile">
            <dt className="metric-label">{tile.label}</dt>
            <dd className="metric-value" style={{ color: tile.color }}>≈{tile.value}</dd>
            <dd className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--muted)' }}>{tile.footnote}</dd>
          </div>
        ))}
      </dl>

      {forecast.categoryRisks.length > 0 && (
        <div className="mt-6">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--fg)' }}>Heading above their usual</p>
          <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--muted)' }}>
            Spent so far, plus bills still due, plus a typical rest of the month.
          </p>
          <ul className="row-list" style={{ borderBottom: '1px solid var(--line)' }}>
            {forecast.categoryRisks.map(risk => (
              <li key={risk.id}>
                <button
                  type="button"
                  onClick={() => onOpenCategory(risk.id)}
                  className="w-full flex items-center gap-3 text-left py-2 pressable"
                  style={{ minHeight: 44 }}
                  aria-label={`${risk.name}, projected ${dollars(risk.projected, 0)} against a typical ${dollars(risk.average, 0)}. Open details.`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: risk.color }}
                    aria-hidden="true"
                  />
                  <span className="text-sm flex-1 truncate" style={{ color: 'var(--fg)' }}>
                    {risk.name}
                  </span>
                  <span className="tabular-nums text-[13px] shrink-0" style={{ color: 'var(--muted)' }}>
                    ≈{dollars(risk.projected, 0)} vs {dollars(risk.average, 0)} usual
                  </span>
                  <span className="tabular-nums text-[13px] font-semibold shrink-0 w-14 text-right" style={{ color: 'var(--fg)' }}>
                    +{(risk.pct * 100).toFixed(0)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--dim)' }}>
        {forecast.basis}
      </p>
      </div>
    </section>
  );
};

export default ForecastCard;
