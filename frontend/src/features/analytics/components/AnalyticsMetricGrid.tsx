import React from 'react';
import type { NetWorthAnalysis, PeriodMetrics, ResolvedPeriod, SavingsMetrics } from '../types';
import { dollars, percent, rateTransition } from '../format';
import { SAVINGS_DEFINITION } from '../calculations/savings';
import { DeltaBadge, InfoHint } from './AnalyticsPrimitives';
import { pctChange } from '../calculations/transactions';

interface Props {
  metrics: PeriodMetrics;
  previousMetrics: PeriodMetrics | null;
  savings: SavingsMetrics;
  netWorth: NetWorthAnalysis;
  currentNetWorth: number;
  period: ResolvedPeriod;
}

interface Tile {
  key: string;
  label: string;
  value: string;
  color: string;
  accent: string;
  hint: string;
  delta?: React.ReactNode;
  footnote?: string;
}

/**
 * The five numbers that answer "what happened". Everything below this grid
 * exists to explain these.
 *
 * Net worth is deliberately the live balance rather than a period figure — it
 * is a position, not a flow, and showing a stale month-end value beside live
 * income would be the kind of quiet contradiction this page is meant to remove.
 */
const AnalyticsMetricGrid: React.FC<Props> = ({
  metrics, previousMetrics, savings, netWorth, currentNetWorth, period,
}) => {
  const comparisonName = period.previous
    ? (period.previous.months.length === 1 ? 'previous month' : 'previous period')
    : null;

  const incomeChange = previousMetrics ? pctChange(metrics.income, previousMetrics.income) : null;
  const expenseChange = previousMetrics ? pctChange(metrics.expenses, previousMetrics.expenses) : null;

  const tiles: Tile[] = [
    {
      key: 'net-worth',
      label: 'Net worth',
      value: dollars(currentNetWorth),
      color: 'var(--fg)',
      accent: 'rgba(241,241,243,0.25)',
      hint: 'The current total of all your accounts except investments, which Fintrack tracks separately in Portfolio. This is a live balance, not a figure for the selected period.',
      delta: netWorth.points.length > 1
        ? <DeltaBadge value={netWorth.change} polarity="up-good" suffix={`/ ${netWorth.points.length}mo`} />
        : undefined,
    },
    {
      key: 'income',
      label: 'Income',
      value: `+${dollars(metrics.income)}`,
      color: 'var(--pos)',
      accent: '#22C55E',
      hint: 'Money received from outside your accounts. Transfers between your own accounts and credit-card payments are excluded, since neither is new money.',
      delta: incomeChange != null
        ? <DeltaBadge value={incomeChange} format="percent" polarity="up-good" />
        : undefined,
      footnote: comparisonName && incomeChange != null ? `vs ${comparisonName}` : undefined,
    },
    {
      key: 'expenses',
      label: 'Expenses',
      value: dollars(metrics.expenses),
      color: 'var(--neg)',
      accent: '#EF4444',
      hint: metrics.refunds > 0
        ? `Money spent, with ${dollars(metrics.refunds)} of refunds already subtracted from the categories they came back to.`
        : 'Money spent. Refunds are subtracted from the category they came back to rather than counted as income.',
      delta: expenseChange != null
        ? <DeltaBadge value={expenseChange} format="percent" polarity="down-good" />
        : undefined,
      footnote: comparisonName && expenseChange != null ? `vs ${comparisonName}` : undefined,
    },
    {
      key: 'saved',
      label: 'Left over',
      value: `${metrics.net < 0 ? '−' : ''}${dollars(Math.abs(metrics.net))}`,
      color: metrics.net >= 0 ? 'var(--pos)' : 'var(--neg)',
      accent: 'var(--accent)',
      hint: SAVINGS_DEFINITION,
      delta: savings.savedDelta != null
        ? <DeltaBadge value={savings.savedDelta} polarity="up-good" />
        : undefined,
      footnote: comparisonName && savings.savedDelta != null ? `vs ${comparisonName}` : undefined,
    },
    {
      key: 'savings-rate',
      label: 'Savings rate',
      value: metrics.savingsRate != null ? percent(metrics.savingsRate) : '—',
      color: metrics.savingsRate == null
        ? 'var(--muted)'
        : metrics.savingsRate >= 0.2 ? 'var(--pos)' : metrics.savingsRate >= 0 ? '#f59e0b' : 'var(--neg)',
      accent: '#f59e0b',
      hint: 'The share of income left after expenses. Changes are shown in percentage points — the gap between two rates — because expressing a rate change as a percentage of itself overstates it. Shown as a dash when no income was recorded, since there is nothing to take a share of.',
      // Percentage points, not percent change. See the hint above.
      delta: savings.rateDelta != null
        ? <DeltaBadge value={savings.rateDelta} format="points" polarity="up-good" />
        : undefined,
      footnote: metrics.savingsRate == null
        ? 'No income recorded'
        : savings.previousRate != null && savings.rateDelta != null
          ? rateTransition(savings.previousRate, metrics.savingsRate)
          : undefined,
    },
  ];

  return (
    // Five tiles: 2 up on phones, 3 on tablets, one row on desktop. Going
    // straight from 2 to 5 left a lone orphan tile on every tablet width.
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 md:gap-3">
      {tiles.map(tile => (
        <div
          key={tile.key}
          className="rounded-xl p-3.5 md:p-4 flex flex-col"
          style={{
            backgroundColor: 'var(--elev-1)',
            border: '1px solid var(--line)',
            borderTop: `2px solid ${tile.accent}`,
            boxShadow: 'var(--edge-light)',
          }}
        >
          <div className="flex items-center gap-1 mb-2">
            <p className="label">{tile.label}</p>
            <InfoHint label={`How ${tile.label} is calculated`} text={tile.hint} />
          </div>
          <p
            className="font-mono font-bold text-sm md:text-base leading-none mb-2"
            style={{ color: tile.color, fontVariantNumeric: 'tabular-nums' }}
          >
            {tile.value}
          </p>
          <div className="mt-auto flex flex-col gap-1 items-start">
            {tile.delta}
            {tile.footnote && (
              <p className="text-[10px]" style={{ color: 'var(--dim)' }}>{tile.footnote}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AnalyticsMetricGrid;
