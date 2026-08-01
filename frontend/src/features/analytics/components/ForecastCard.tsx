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
      color: 'var(--neg)',
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
      color: (forecast.savings ?? 0) >= 0 ? 'var(--accent)' : 'var(--neg)',
      footnote: forecast.savingsRate != null
        ? `${percent(forecast.savingsRate)} savings rate`
        : 'No income projected',
    },
  ];

  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-forecast-heading">
      <SectionHeader
        id="analytics-forecast-heading"
        eyebrow="Projection"
        title={`How ${forecast.monthLabel} is tracking`}
        description="Projections, not commitments. They shift as the period goes on."
        hint="Built from what has already happened, plus bills you have scheduled, plus a daily rate for everything else. That daily rate blends this period's pace with your historical median, so an unusual first week does not set the whole projection."
        right={
          <span
            className="font-mono text-[10px] px-2.5 py-1 rounded-full whitespace-nowrap"
            style={{
              color: forecast.confidence === 'low' ? '#f59e0b' : 'var(--muted)',
              backgroundColor: forecast.confidence === 'low' ? 'rgba(245,158,11,0.12)' : 'var(--elev-sub)',
            }}
            title={CONFIDENCE_COPY[forecast.confidence]}
          >
            {forecast.confidence} confidence
          </span>
        }
      />

      <div className="mb-4">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Day {forecast.daysElapsed} of {forecast.daysTotal}
          </p>
          <p className="font-mono text-[11px]" style={{ color: 'var(--dim)' }}>
            {progress.toFixed(0)}% through
          </p>
        </div>
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: 'var(--line)' }}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress through the period"
        >
          <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: 'var(--accent)' }} />
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {tiles.map(tile => (
          <div key={tile.key} className="ledger-cell p-3.5">
            <dt className="label mb-1.5">{tile.label}</dt>
            <dd
              className="font-mono tabular-nums text-lg font-bold leading-none mb-2"
              style={{ color: tile.color }}
            >
              ≈{tile.value}
            </dd>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--dim)' }}>{tile.footnote}</p>
          </div>
        ))}
      </dl>

      {forecast.categoryRisks.length > 0 && (
        <div className="mt-4 pt-3.5" style={{ borderTop: '1px solid var(--line)' }}>
          <p className="label mb-2.5">On track to run above average</p>
          <ul className="space-y-2">
            {forecast.categoryRisks.map(risk => (
              <li key={risk.id}>
                <button
                  type="button"
                  onClick={() => onOpenCategory(risk.id)}
                  className="w-full flex items-center gap-3 text-left"
                  style={{ minHeight: 40 }}
                  aria-label={`${risk.name}, projected ${dollars(risk.projected, 0)} against a typical ${dollars(risk.average, 0)}. Open details.`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: risk.color }}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--fg)' }}>
                    {risk.name}
                  </span>
                  <span className="font-mono tabular-nums text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                    ≈{dollars(risk.projected, 0)} vs {dollars(risk.average, 0)}
                  </span>
                  <span
                    className="font-mono text-[10px] px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)' }}
                  >
                    +{(risk.pct * 100).toFixed(0)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] mt-4 leading-relaxed" style={{ color: 'var(--dim)' }}>
        {forecast.basis}
      </p>
    </section>
  );
};

export default ForecastCard;
