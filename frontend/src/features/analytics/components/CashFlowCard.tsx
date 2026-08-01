import React from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CashFlowData, ResolvedPeriod } from '../types';
import { compactDollars, dollars, percent } from '../format';
import { Amount, PanelEmpty, SectionHeader, chartTooltipProps } from './AnalyticsPrimitives';

interface Props {
  cashFlow: CashFlowData;
  period: ResolvedPeriod;
}

const CHART_HEIGHT = 210;
/**
 * Bars top out at 86% of the plot so the value label above the tallest one
 * still has room inside the box. Without it the label sits outside the
 * container and either gets clipped or extends the page.
 */
const HEADROOM = 0.86;

/**
 * Cash flow, shaped to the question the range is asking.
 *
 * A single month is a true waterfall: income sets the level, each cost steps
 * down from where the last one ended, and the final bar rises from zero to
 * what survived. Connector lines carry the running total across, so the
 * descent reads as one continuous story rather than four unrelated bars.
 *
 * It is drawn directly rather than through the chart library. The earlier
 * version faked the steps with a stacked transparent spacer bar, which is
 * exactly the kind of trick that produces a chart nobody can quite read — and
 * it could not draw connectors at all.
 *
 * Several months become a grouped income-vs-expense trend, because then the
 * question is direction rather than composition.
 */
const CashFlowCard: React.FC<Props> = ({ cashFlow, period }) => {
  const isWaterfall = cashFlow.mode === 'waterfall';
  const hasData = cashFlow.income > 0 || cashFlow.fixed > 0 || cashFlow.variable > 0
    || cashFlow.series.some(p => p.Income > 0 || p.Expenses > 0);

  const savingsRate = cashFlow.income > 0 ? cashFlow.remaining / cashFlow.income : null;

  // Waterfall geometry. Every bar spans [base, base + |value|]; the axis is
  // stretched to cover a shortfall dipping below zero.
  const axisMin = Math.min(0, ...cashFlow.steps.map(s => s.base));
  const axisMax = Math.max(1, ...cashFlow.steps.map(s => s.base + Math.abs(s.value)));
  const span = axisMax - axisMin || 1;
  const toPct = (value: number) => ((value - axisMin) / span) * 100 * HEADROOM;

  const bars = cashFlow.steps.map(step => {
    const magnitude = Math.abs(step.value);
    // The running total after this step — where the connector to the next
    // column sits. Income tops out at its own height; costs land at their base.
    const running = step.kind === 'income' ? step.base + magnitude : step.base;
    return {
      ...step,
      magnitude,
      bottomPct: toPct(step.base),
      heightPct: (magnitude / span) * 100 * HEADROOM,
      connectorPct: toPct(running),
    };
  });

  const chartSummary = isWaterfall
    ? `Cash flow for ${period.label}. Income ${dollars(cashFlow.income)}. `
      + (cashFlow.hasFixedBreakdown
        ? `Recurring costs ${dollars(cashFlow.fixed)}. Other spending ${dollars(cashFlow.variable)}. `
        : `Spending ${dollars(cashFlow.fixed + cashFlow.variable)}. `)
      + `${cashFlow.remaining >= 0 ? 'Left over' : 'Shortfall'} ${dollars(Math.abs(cashFlow.remaining))}.`
    : `Monthly income and expenses for ${period.label}. `
      + cashFlow.series
        .map(p => `${p.label}: income ${dollars(p.Income)}, expenses ${dollars(p.Expenses)}`)
        .join('. ')
      + '.';

  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-cashflow-heading">
      <SectionHeader
        id="analytics-cashflow-heading"
        eyebrow="Cash flow"
        title={isWaterfall ? `Where ${period.label} went` : 'Income and spending by month'}
        description={isWaterfall
          ? (cashFlow.hasFixedBreakdown
            ? 'Income, less the bills you have set up as recurring, less everything else.'
            : 'Income less spending. Set up recurring bills to split this into fixed and variable costs.')
          : 'Each month in the selected range, side by side.'}
        hint="Transfers between your own accounts and credit-card payments are excluded from both sides. Refunds reduce spending rather than adding to income."
        right={savingsRate != null ? (
          <div className="text-right">
            <p className="label mb-1">Left over</p>
            <p
              className="font-mono tabular-nums text-sm font-bold"
              style={{ color: cashFlow.remaining >= 0 ? 'var(--pos)' : 'var(--neg)' }}
            >
              {percent(savingsRate)}
            </p>
          </div>
        ) : undefined}
      />

      {!hasData ? (
        <PanelEmpty
          title="No income or spending in this period"
          body="Once transactions land in the selected range, the breakdown appears here."
        />
      ) : (
        <>
          <p className="sr-only">{chartSummary}</p>

          {isWaterfall ? (
            <div role="img" aria-label={chartSummary}>
              {/* Clipped so a long value label can never push the page sideways. */}
              <div
                className="flex items-stretch gap-2 sm:gap-4"
                style={{ height: CHART_HEIGHT, overflow: 'hidden' }}
              >
                {bars.map((bar, index) => (
                  <div key={bar.key} className="flex-1 relative min-w-0" style={{ overflow: 'visible' }}>
                    {/* Zero line, so a shortfall is legible as below-zero. */}
                    {axisMin < 0 && (
                      <span
                        className="absolute left-0 right-0"
                        style={{ bottom: `${toPct(0)}%`, height: 1, backgroundColor: 'var(--line-strong)' }}
                        aria-hidden="true"
                      />
                    )}

                    {/* Connector carrying the running total into the next column. */}
                    {index < bars.length - 1 && (
                      <span
                        className="absolute"
                        style={{
                          bottom: `${bar.connectorPct}%`,
                          left: '8%',
                          width: '108%',
                          height: 0,
                          borderTop: '1px dashed var(--line-strong)',
                        }}
                        aria-hidden="true"
                      />
                    )}

                    <span
                      className="absolute rounded-t"
                      style={{
                        left: '8%',
                        right: '8%',
                        bottom: `${bar.bottomPct}%`,
                        height: `${Math.max(bar.heightPct, 0.6)}%`,
                        backgroundColor: bar.color,
                        borderRadius: bar.kind === 'cost' ? '0 0 4px 4px' : '4px 4px 0 0',
                      }}
                      title={`${bar.label}: ${bar.kind === 'cost' ? '−' : ''}${dollars(bar.magnitude)}`}
                    />

                    {/* Value sits above its bar. Hidden on the narrowest
                        screens, where four columns leave no room for it — the
                        summary grid below carries the exact figures. */}
                    <span
                      className="hidden sm:block absolute left-0 right-0 text-center font-mono tabular-nums text-[11px] font-semibold whitespace-nowrap"
                      style={{
                        bottom: `calc(${bar.bottomPct + Math.max(bar.heightPct, 0.6)}% + 4px)`,
                        color: bar.color,
                      }}
                    >
                      {bar.kind === 'cost' ? '−' : ''}{dollars(bar.magnitude, 0)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-start gap-2 sm:gap-4 mt-2">
                {bars.map(bar => (
                  <p
                    key={bar.key}
                    className="flex-1 min-w-0 text-center text-[10px] sm:text-xs leading-snug"
                    style={{ color: 'var(--muted)' }}
                  >
                    {bar.label}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ width: '100%', height: 240 }} role="img" aria-label={chartSummary}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashFlow.series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--dim)' }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    tickFormatter={(v: number) => compactDollars(v)}
                  />
                  <Tooltip {...chartTooltipProps} formatter={(v: any, name: any) => [dollars(Number(v)), name]} />
                  <Legend
                    verticalAlign="bottom"
                    height={28}
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }}
                  />
                  <Bar dataKey="Income" fill="var(--pos)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="var(--neg)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {isWaterfall && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
              {cashFlow.steps.map(step => (
                <div key={step.key} className="ledger-cell p-3 min-w-0">
                  <dt className="label mb-1.5 flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: step.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{step.label}</span>
                  </dt>
                  <dd>
                    <Amount
                      value={step.kind === 'cost' ? -Math.abs(step.value) : step.value}
                      className="text-sm font-semibold"
                      color={step.color}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  );
};

export default CashFlowCard;
