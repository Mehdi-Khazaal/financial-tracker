import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CategoryComparison, PeriodMetrics } from '../types';
import { dollars, percent, plural } from '../format';
import { DeltaBadge, PanelEmpty, SectionHeader, chartTooltipProps } from './AnalyticsPrimitives';

interface Props {
  spending: CategoryComparison[];
  metrics: PeriodMetrics;
  onOpenCategory: (categoryId: number) => void;
  onNavigate: (to: string, tab?: string) => void;
}

const VISIBLE = 7;

/**
 * Spending breakdown, now with a way in.
 *
 * Each row is a button that opens the category drawer, so "Motorcycle was
 * $1,400" becomes "here are the four transactions that made it $1,400". The
 * uncategorized total is called out explicitly rather than silently missing
 * from the chart, which is what made the old donut disagree with the header.
 */
const CategorySpendingCard: React.FC<Props> = ({ spending, metrics, onOpenCategory, onNavigate }) => {
  const total = spending.reduce((s, c) => s + c.current, 0);
  const visible = spending.slice(0, VISIBLE);
  const rest = spending.slice(VISIBLE);
  const restTotal = rest.reduce((s, c) => s + c.current, 0);

  const chartSummary = spending.length > 0
    ? `Spending by category. ${spending
      .slice(0, 5)
      .map(c => `${c.name} ${dollars(c.current)}, ${percent(c.share, 0)}`)
      .join('. ')}.`
    : 'No categorized spending in this period.';

  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-categories-heading">
      <SectionHeader
        id="analytics-categories-heading"
        eyebrow="Spending"
        title="Where the money went"
        description={spending.length > 0
          ? `${plural(spending.length, 'category')} with spending. Select any one to see what produced the total.`
          : undefined}
        hint="Shows categorized spending only. Refunds are subtracted from the category they came back to, so these totals reflect what you actually spent."
        right={
          <div className="text-right">
            <p className="label mb-1">Categorized</p>
            <p className="font-mono tabular-nums text-sm font-bold" style={{ color: 'var(--fg)' }}>
              {dollars(total)}
            </p>
          </div>
        }
      />

      {spending.length === 0 ? (
        <PanelEmpty
          title="No categorized spending in this period"
          body={metrics.uncategorizedCount > 0
            ? `There are ${plural(metrics.uncategorizedCount, 'transaction')} without a category. Filing them will populate this breakdown.`
            : 'Spending will appear here once there are expense transactions in the selected range.'}
          action={metrics.uncategorizedCount > 0 ? (
            <button
              type="button"
              onClick={() => onNavigate('/transactions')}
              className="btn-gradient px-5 py-2.5 text-sm mt-1"
            >
              Categorize transactions
            </button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[190px_1fr] items-start">
          <div className="relative mx-auto shrink-0" style={{ width: 190, height: 190 }}>
            <p className="sr-only">{chartSummary}</p>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={spending}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={84}
                  dataKey="current"
                  nameKey="name"
                  paddingAngle={2}
                  cornerRadius={5}
                  onClick={(entry: any) => {
                    const id = entry?.payload?.id ?? entry?.id;
                    if (typeof id === 'number') onOpenCategory(id);
                  }}
                  style={{ cursor: 'pointer', outline: 'none' }}
                >
                  {spending.map(entry => (
                    <Cell key={entry.id} fill={entry.color} stroke="transparent" strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(value: any, name: any) => [dollars(Number(value)), name]}
                />
              </PieChart>
            </ResponsiveContainer>

            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6">
              <p className="label mb-1" style={{ fontSize: 8 }}>Largest</p>
              <p
                className="text-[11px] font-bold text-center leading-tight"
                style={{ color: 'var(--fg)' }}
              >
                {spending[0].name}
              </p>
              <p
                className="font-mono tabular-nums text-sm font-bold mt-1"
                style={{ color: spending[0].color }}
              >
                {percent(spending[0].share, 0)}
              </p>
            </div>
          </div>

          <ul className="space-y-1 min-w-0">
            {visible.map((category, index) => (
              <li key={category.id}>
                <button
                  type="button"
                  onClick={() => onOpenCategory(category.id)}
                  className="w-full text-left rounded-lg px-2 py-2 transition-colors group"
                  style={{ minHeight: 44 }}
                  aria-label={`${category.name}, ${dollars(category.current)}, ${percent(category.share, 0)} of spending. Open details.`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] shrink-0"
                      style={{ color: 'var(--dim)', width: 16 }}
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: category.color }}
                      aria-hidden="true"
                    />
                    <span className="text-xs flex-1 truncate" style={{ color: 'var(--fg)' }}>
                      {category.name}
                    </span>
                    {category.baselineMonths >= 3 && Math.abs(category.deltaVsAverage) >= 25 && (
                      <DeltaBadge value={category.deltaVsAverage} polarity="down-good" />
                    )}
                    <span
                      className="font-mono tabular-nums text-xs font-semibold shrink-0"
                      style={{ color: 'var(--fg)' }}
                    >
                      {dollars(category.current)}
                    </span>
                    <span
                      className="text-[10px] text-right shrink-0"
                      style={{ color: 'var(--muted)', width: 32 }}
                    >
                      {percent(category.share, 0)}
                    </span>
                  </span>
                  <span
                    className="block h-1 rounded-full overflow-hidden mt-1.5 ml-[26px]"
                    style={{ backgroundColor: 'var(--line)' }}
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.min(100, category.share * 100)}%`, backgroundColor: category.color }}
                    />
                  </span>
                </button>
              </li>
            ))}

            {rest.length > 0 && (
              <li className="flex items-center justify-between gap-2 px-2 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {plural(rest.length, 'smaller category')}
                </span>
                <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--muted)' }}>
                  {dollars(restTotal)}
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      {metrics.uncategorizedSpend > 0 && spending.length > 0 && (
        <button
          type="button"
          onClick={() => onNavigate('/transactions')}
          className="mt-4 pt-3 w-full flex items-center justify-between gap-3 text-left"
          style={{ borderTop: '1px solid var(--line)', minHeight: 44 }}
        >
          <span className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            A further <span className="font-mono tabular-nums" style={{ color: 'var(--accent)' }}>{dollars(metrics.uncategorizedSpend)}</span>{' '}
            across {plural(metrics.uncategorizedCount, 'transaction')} has no category, so it is not in this breakdown.
          </span>
          <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--accent)' }}>Fix →</span>
        </button>
      )}
    </section>
  );
};

export default CategorySpendingCard;
