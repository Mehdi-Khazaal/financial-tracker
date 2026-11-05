import React, { useState } from 'react';
import type { CashFlowData, CategoryComparison, PeriodMetrics, ResolvedPeriod, TypicalPeriod } from '../types';
import { dollars, percent } from '../format';
import { DeltaBadge, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  period: ResolvedPeriod;
  metrics: PeriodMetrics;
  previousMetrics: PeriodMetrics | null;
  typical: TypicalPeriod | null;
  categories: CategoryComparison[];
  cashFlow: CashFlowData;
  categoriesFailed: boolean;
  onOpenCategory: (id: number) => void;
}

/** Categories shown before "Show all". */
const FIRST_ROWS = 8;

const BILLS = 'var(--fg)';
const DAY_TO_DAY = 'color-mix(in oklab, var(--fg) 40%, var(--bg))';
const KEPT = 'var(--accent)';

const cell = 'py-2.5 text-right tabular-nums whitespace-nowrap';
const PREV = 'hidden sm:table-cell';
const TYPICAL = 'hidden md:table-cell';

const rate = (net: number, income: number): number | null => (income > 0 ? net / income : null);

/**
 * The period as a statement: income, spending line by line, and what was
 * kept — each against the previous period and a typical one.
 *
 * It replaces three views that each showed a slice of the same figures (a
 * waterfall, a donut and a comparison table). One table with the same columns
 * all the way down answers "what changed" without flicking between charts.
 * Above it, one bar shows where the income went.
 */
const StatementCard: React.FC<Props> = ({
  period, metrics, previousMetrics, typical, categories, cashFlow, categoriesFailed, onOpenCategory,
}) => {
  const [showAll, setShowAll] = useState(false);

  const rows = categories
    .filter(c => c.current > 0 || c.average > 0)
    .sort((a, b) => b.current - a.current || b.average - a.average);
  const visible = showAll ? rows : rows.slice(0, FIRST_ROWS);
  const soFar = period.isIncomplete ? ' so far' : '';
  const prevLabel = period.previous?.label ?? 'Previous';

  // ── Where the income went ───────────────────────────────────────────────────
  const spent = cashFlow.fixed + cashFlow.variable;
  const base = Math.max(cashFlow.income, spent, 1);
  const segments = cashFlow.hasFixedBreakdown
    ? [
      { key: 'bills', label: 'Bills', value: cashFlow.fixed, color: BILLS },
      { key: 'day', label: 'Day-to-day', value: cashFlow.variable, color: DAY_TO_DAY },
      { key: 'kept', label: 'Kept', value: Math.max(0, cashFlow.remaining), color: KEPT },
    ]
    : [
      { key: 'spent', label: 'Spending', value: spent, color: BILLS },
      { key: 'kept', label: 'Kept', value: Math.max(0, cashFlow.remaining), color: KEPT },
    ];

  const line = (
    label: React.ReactNode,
    current: number,
    previous: number | null,
    usual: number | null,
    polarity: 'up-good' | 'down-good',
    options: { strong?: boolean; rule?: boolean; tone?: string } = {},
  ) => (
    <tr style={options.rule ? { borderTop: '1px solid var(--fg)' } : { borderTop: '1px solid var(--line)' }}>
      <th scope="row" className={`py-2.5 pr-3 text-left ${options.strong ? 'font-semibold' : 'font-normal'}`} style={{ color: 'var(--fg)' }}>
        {label}
      </th>
      <td className={`${cell} ${options.strong ? 'font-semibold' : ''}`} style={{ color: options.tone ?? 'var(--fg)' }}>{dollars(current)}</td>
      <td className={`${cell} ${PREV}`} style={{ color: 'var(--muted)' }}>{previous != null ? dollars(previous) : '—'}</td>
      <td className={`${cell} ${TYPICAL}`} style={{ color: 'var(--muted)' }}>{usual != null ? dollars(usual) : '—'}</td>
      <td className={`${cell} pl-3`}>{usual != null ? <DeltaBadge value={current - usual} polarity={polarity} /> : <span style={{ color: 'var(--dim)' }}>—</span>}</td>
    </tr>
  );

  const currentRate = rate(metrics.net, metrics.income);
  const previousRate = previousMetrics ? rate(previousMetrics.net, previousMetrics.income) : null;
  const typicalRate = typical ? rate(typical.net, typical.income) : null;

  return (
    <section className="report-section" aria-labelledby="analytics-statement-heading">
      <SectionHeader
        id="analytics-statement-heading"
        eyebrow="Statement"
        title="Statement"
        description={typical
          ? `${period.label}${soFar}, against ${period.previous ? period.previous.label : 'nothing earlier'} and a typical period of the same length.`
          : `${period.label}${soFar}. A typical period appears once there are three completed months.`}
        hint="Transfers between your own accounts and credit-card payments are left out, so nothing is counted twice. Refunds reduce the category they came from. Typical is the average of your recent completed months, scaled to the length of this period."
      />

      <div>
        {cashFlow.income > 0 ? (
          <div className="mb-7">
            <p className="text-[13px] mb-2" style={{ color: 'var(--muted)' }}>
              Where {period.isIncomplete ? 'the income has gone so far' : 'the income went'}
            </p>
            <div className="flex h-3 w-full overflow-hidden rounded-[2px]" style={{ background: 'var(--elev-sub)' }} aria-hidden="true">
              {segments.map(s => (
                <span key={s.key} style={{ width: `${(s.value / base) * 100}%`, background: s.color }} />
              ))}
            </div>
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
              {segments.map(s => (
                <div key={s.key} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--muted)' }}>
                    <span className="w-2.5 h-2.5 shrink-0" style={{ background: s.color }} aria-hidden="true" />
                    {s.label}
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums mt-0.5" style={{ color: 'var(--fg)' }}>
                    {dollars(s.value, 0)}
                    <span className="font-normal" style={{ color: 'var(--muted)' }}> · {percent(s.value / cashFlow.income, 0)} of income</span>
                  </dd>
                </div>
              ))}
            </dl>
            {cashFlow.remaining < 0 && (
              <p className="text-[13px] mt-3" style={{ color: 'var(--neg)' }}>
                Spending ran {dollars(Math.abs(cashFlow.remaining))} past what came in.
              </p>
            )}
          </div>
        ) : (
          <p className="text-[13px] mb-6" style={{ color: 'var(--muted)' }}>No income was recorded in this period.</p>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col" className="pb-2 text-left text-[13px] font-normal" style={{ color: 'var(--muted)' }}><span className="sr-only">Line</span></th>
              <th scope="col" className="pb-2 text-right text-[13px] font-semibold" style={{ color: 'var(--fg)' }}>{period.shortLabel}{soFar}</th>
              <th scope="col" className={`pb-2 text-right text-[13px] font-normal ${PREV}`} style={{ color: 'var(--muted)' }}>{prevLabel}</th>
              <th scope="col" className={`pb-2 text-right text-[13px] font-normal ${TYPICAL}`} style={{ color: 'var(--muted)' }}>Typical</th>
              <th scope="col" className="pb-2 pl-3 text-right text-[13px] font-normal" style={{ color: 'var(--muted)' }}>vs typical</th>
            </tr>
          </thead>
          <tbody>
            {line('Income', metrics.income, previousMetrics?.income ?? null, typical?.income ?? null, 'up-good', { strong: true, rule: true })}

            <tr>
              <th scope="colgroup" colSpan={5} className="pt-6 pb-2 text-left text-[13px] font-semibold" style={{ color: 'var(--fg)' }}>
                Spending by category
              </th>
            </tr>
            {categoriesFailed ? (
              <tr style={{ borderTop: '1px solid var(--line)' }}>
                <td colSpan={5} className="py-3 text-[13px]" style={{ color: 'var(--muted)' }}>
                  Categories unavailable. The breakdown needs your category list, which could not be loaded; the totals are unaffected.
                </td>
              </tr>
            ) : visible.map(c => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--line)' }}>
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => onOpenCategory(c.id)}
                    className="group w-full text-left pressable"
                    style={{ minHeight: 36 }}
                    aria-label={`${c.name}: ${dollars(c.current)}. Open details.`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} aria-hidden="true" />
                      <span className="truncate group-hover:underline" style={{ color: 'var(--fg)' }}>{c.name}</span>
                      {c.share > 0 && <span className="text-xs shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>{percent(c.share, 0)}</span>}
                    </span>
                    <span className="block mt-1.5 h-[3px] w-full max-w-[220px]" style={{ background: 'var(--elev-sub)' }} aria-hidden="true">
                      <span className="block h-full" style={{ width: `${Math.min(100, c.share * 100)}%`, background: 'color-mix(in oklab, var(--fg) 45%, var(--bg))' }} />
                    </span>
                  </button>
                </th>
                <td className={cell} style={{ color: 'var(--fg)' }}>{dollars(c.current)}</td>
                <td className={`${cell} ${PREV}`} style={{ color: 'var(--muted)' }}>{period.previous ? dollars(c.previous) : '—'}</td>
                <td className={`${cell} ${TYPICAL}`} style={{ color: 'var(--muted)' }}>{c.baselineMonths > 0 ? dollars(c.average) : '—'}</td>
                <td className={`${cell} pl-3`}>
                  {c.baselineMonths > 0 ? <DeltaBadge value={c.deltaVsAverage} polarity="down-good" /> : <span style={{ color: 'var(--dim)' }}>—</span>}
                </td>
              </tr>
            ))}
            {!categoriesFailed && metrics.uncategorizedSpend > 0.005 && (
              <tr style={{ borderTop: '1px solid var(--line)' }}>
                <th scope="row" className="py-2.5 pr-3 text-left font-normal" style={{ color: 'var(--muted)' }}>Uncategorized</th>
                <td className={cell} style={{ color: 'var(--fg)' }}>{dollars(metrics.uncategorizedSpend)}</td>
                <td className={`${cell} ${PREV}`} />
                <td className={`${cell} ${TYPICAL}`} />
                <td className={cell} />
              </tr>
            )}
            {!categoriesFailed && rows.length > FIRST_ROWS && (
              <tr>
                <td colSpan={5} className="pt-1">
                  <button type="button" onClick={() => setShowAll(v => !v)} className="section-link pressable" style={{ minHeight: 40 }}>
                    {showAll ? 'Show fewer' : `Show all ${rows.length} categories`}
                  </button>
                </td>
              </tr>
            )}

            {line('Total spending', metrics.expenses, previousMetrics?.expenses ?? null, typical?.expenses ?? null, 'down-good', { strong: true, rule: true })}
            {line('Kept', metrics.net, previousMetrics?.net ?? null, typical?.net ?? null, 'up-good', {
              strong: true, tone: metrics.net >= 0 ? 'var(--pos)' : 'var(--neg)',
            })}
            <tr style={{ borderTop: '1px solid var(--line)' }}>
              <th scope="row" className="py-2.5 pr-3 text-left font-normal" style={{ color: 'var(--fg)' }}>Savings rate</th>
              <td className={cell} style={{ color: 'var(--fg)' }}>{currentRate != null ? percent(currentRate) : '—'}</td>
              <td className={`${cell} ${PREV}`} style={{ color: 'var(--muted)' }}>{previousRate != null ? percent(previousRate) : '—'}</td>
              <td className={`${cell} ${TYPICAL}`} style={{ color: 'var(--muted)' }}>{typicalRate != null ? percent(typicalRate) : '—'}</td>
              <td className={`${cell} pl-3`}>
                {currentRate != null && typicalRate != null
                  ? <DeltaBadge value={currentRate - typicalRate} format="points" polarity="up-good" />
                  : <span style={{ color: 'var(--dim)' }}>—</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default StatementCard;
