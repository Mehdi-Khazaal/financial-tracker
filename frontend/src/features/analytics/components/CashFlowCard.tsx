import React from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CashFlowData, ResolvedPeriod } from '../types';
import { compactDollars, dollars, percent } from '../format';
import { Amount, PanelEmpty, SectionHeader, chartTooltipProps } from './AnalyticsPrimitives';

interface Props {
  cashFlow: CashFlowData;
  period: ResolvedPeriod;
}

/**
 * Cash flow, shaped to the question the range is asking.
 *
 * A single month becomes a waterfall — income at the top, costs stepping down,
 * what survived at the bottom — because for one month the useful question is
 * *where did it go*. Several months become a trend, because then the question
 * is *which way is this heading*. The previous chart drew two bars for one
 * month and answered neither.
 *
 * Expenses are drawn as downward steps rather than negative numbers, so no
 * axis ever reads "−$2,400" for money that was simply spent.
 */
const CashFlowCard: React.FC<Props> = ({ cashFlow, period }) => {
  const isWaterfall = cashFlow.mode === 'waterfall';
  const hasData = cashFlow.income > 0 || cashFlow.fixed > 0 || cashFlow.variable > 0
    || cashFlow.series.some(p => p.Income > 0 || p.Expenses > 0);

  const waterfallData = cashFlow.steps.map(step => ({
    label: step.label,
    base: step.base,
    magnitude: Math.abs(step.value),
    signed: step.value,
    color: step.color,
    hint: step.hint,
    kind: step.kind,
  }));

  const savingsRate = cashFlow.income > 0 ? cashFlow.remaining / cashFlow.income : null;

  // Plain-text equivalent of the chart for screen readers.
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
            <p className="label mb-1">Kept</p>
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

          <div style={{ width: '100%', height: 240 }} role="img" aria-label={chartSummary}>
            <ResponsiveContainer width="100%" height="100%">
              {isWaterfall ? (
                <BarChart data={waterfallData} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: 'var(--dim)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--dim)' }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    tickFormatter={(v: number) => compactDollars(v)}
                  />
                  <Tooltip
                    {...chartTooltipProps}
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[payload.length - 1].payload as typeof waterfallData[number];
                      return (
                        <div
                          className="p-3 rounded-xl"
                          style={{
                            backgroundColor: 'var(--elev-sub)',
                            border: '1px solid var(--line-strong)',
                            boxShadow: 'var(--shadow-modal)',
                            maxWidth: 230,
                          }}
                        >
                          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--fg)' }}>{row.label}</p>
                          <p className="font-mono tabular-nums text-sm font-bold mb-1.5" style={{ color: row.color }}>
                            {row.kind === 'cost' ? '−' : ''}{dollars(row.magnitude)}
                          </p>
                          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>{row.hint}</p>
                        </div>
                      );
                    }}
                  />
                  {/* Invisible spacer bar lifts each step to where the previous one ended. */}
                  <Bar dataKey="base" stackId="flow" fill="transparent" isAnimationActive={false} />
                  <Bar dataKey="magnitude" stackId="flow" radius={[4, 4, 0, 0]}>
                    {waterfallData.map(entry => (
                      <Cell key={entry.label} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
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
              )}
            </ResponsiveContainer>
          </div>

          {isWaterfall && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
              {cashFlow.steps.map(step => (
                <div key={step.key} className="ledger-cell p-3">
                  <dt className="label mb-1.5 flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: step.color }}
                      aria-hidden="true"
                    />
                    {step.label}
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
