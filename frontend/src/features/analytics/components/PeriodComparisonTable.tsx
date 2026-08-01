import React, { useMemo, useState } from 'react';
import type { CategoryComparison, ResolvedPeriod } from '../types';
import type { CategorySort } from '../calculations/categories';
import { sortCategories } from '../calculations/categories';
import { dollars, monthLabel, plural, signedPercent } from '../format';
import { ConfidenceChip, DeltaBadge, PanelEmpty, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  categories: CategoryComparison[];
  period: ResolvedPeriod;
  baselineLabel: string;
  baselineCount: number;
  onOpenCategory: (categoryId: number) => void;
}

const COLLAPSED_ROWS = 6;

const SORTS: { id: CategorySort; label: string }[] = [
  { id: 'change', label: 'Largest changes' },
  { id: 'amount', label: 'Highest spend' },
  { id: 'name', label: 'A–Z' },
];

/**
 * The month-versus-average table, rebuilt for scanning.
 *
 * Kept because it is the most informative thing on the page, but the old
 * version made you read four columns of raw dollars to find the story. Now the
 * change leads, the average carries its own confidence, and the whole thing
 * collapses to six rows until you ask for more.
 *
 * On mobile the table becomes a card list rather than a horizontal scroll —
 * four numeric columns never fit a phone legibly.
 */
const PeriodComparisonTable: React.FC<Props> = ({
  categories, period, baselineLabel, baselineCount, onOpenCategory,
}) => {
  const [sort, setSort] = useState<CategorySort>('change');
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(
    () => sortCategories(categories.filter(c => c.current > 0 || c.average > 0), sort),
    [categories, sort],
  );

  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const scale = Math.max(...rows.map(r => Math.max(r.current, r.previous, r.average)), 1);

  const decreased = rows.filter(r => r.deltaVsAverage < 0).length;
  const increased = rows.filter(r => r.deltaVsAverage > 0).length;
  const totalDelta = rows.reduce((s, r) => s + r.deltaVsAverage, 0);

  const previousLabel = period.previous
    ? (period.previous.months.length === 1 ? monthLabel(period.previous.months[0]) : period.previous.label)
    : null;

  const headline = baselineCount === 0
    ? 'There are no completed earlier months to average against yet.'
    : totalDelta < 0
      ? `Spending was ${dollars(Math.abs(totalDelta))} below your recent average.`
      : totalDelta > 0
        ? `Spending was ${dollars(totalDelta)} above your recent average.`
        : 'Spending landed almost exactly on your recent average.';

  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-comparison-heading">
      <SectionHeader
        id="analytics-comparison-heading"
        eyebrow="Compared with your usual"
        title={`${period.label} against a typical period`}
        description={
          <>
            {headline}
            {rows.length > 0 && baselineCount > 0 && (
              <> {plural(decreased, 'category')} decreased and {increased} increased.</>
            )}
          </>
        }
        hint={`${baselineLabel}. Only completed months count toward the average — the month in progress is excluded so it cannot drag the comparison down. Categories with little history are marked, because an average built from one month is a weak guide.`}
        right={
          rows.length > 1 ? (
            <div className="flex gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--elev-sub)' }} role="group" aria-label="Sort categories">
              {SORTS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSort(option.id)}
                  aria-pressed={sort === option.id}
                  className="px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap"
                  style={sort === option.id
                    ? { backgroundColor: 'var(--elev-1)', color: 'var(--accent)' }
                    : { color: 'var(--muted)' }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <PanelEmpty
          title="Nothing to compare yet"
          body="Once there is categorized spending in this period and at least one completed month behind it, the comparison appears here."
        />
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">
                Spending by category for {period.label}, compared with {previousLabel ?? 'no earlier period'} and with the {baselineLabel.toLowerCase()}.
              </caption>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th scope="col" className="label text-left font-normal pb-2.5">Category</th>
                  <th scope="col" className="label text-right font-normal pb-2.5 pl-3">Change vs average</th>
                  <th scope="col" className="label text-right font-normal pb-2.5 pl-3">{period.shortLabel}</th>
                  <th scope="col" className="label text-right font-normal pb-2.5 pl-3">
                    {previousLabel ? previousLabel.replace(/ \d{4}$/, '') : 'Previous'}
                  </th>
                  <th scope="col" className="label text-right font-normal pb-2.5 pl-3">Typical</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="py-3 pr-3 align-middle" style={{ minWidth: 160 }}>
                      <button
                        type="button"
                        onClick={() => onOpenCategory(row.id)}
                        className="text-left w-full group"
                        aria-label={`Open details for ${row.name}`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: row.color }}
                            aria-hidden="true"
                          />
                          <span className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>
                            {row.name}
                          </span>
                          <ConfidenceChip months={row.baselineMonths} />
                        </span>
                        {/* Bar shows this period; the tick marks the typical level. */}
                        <span
                          className="relative block h-1 mt-2 ml-4 rounded-full overflow-hidden"
                          style={{ backgroundColor: 'var(--line)' }}
                          aria-hidden="true"
                        >
                          <span
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${Math.min(100, (row.current / scale) * 100)}%`, backgroundColor: row.color }}
                          />
                          {row.average > 0 && (
                            <span
                              className="absolute top-0 h-full"
                              style={{
                                left: `${Math.min(100, (row.average / scale) * 100)}%`,
                                width: 2,
                                backgroundColor: 'var(--fg)',
                                transform: 'translateX(-1px)',
                              }}
                            />
                          )}
                        </span>
                      </button>
                    </td>
                    <td className="py-3 pl-3 text-right align-middle whitespace-nowrap">
                      {row.baselineMonths > 0 ? (
                        <>
                          <DeltaBadge value={row.deltaVsAverage} polarity="down-good" />
                          {row.pctVsAverage != null && (
                            <p className="text-[10px] mt-1" style={{ color: 'var(--dim)' }}>
                              {signedPercent(row.pctVsAverage)}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px]" style={{ color: 'var(--dim)' }}>No history</span>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right align-middle">
                      <span className="font-mono tabular-nums text-xs font-semibold" style={{ color: 'var(--fg)' }}>
                        {dollars(row.current)}
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-right align-middle">
                      <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--muted)' }}>
                        {previousLabel ? dollars(row.previous) : '—'}
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-right align-middle">
                      <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--muted)' }}>
                        {row.baselineMonths > 0 ? dollars(row.average) : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="pt-3 text-left label font-normal">Total shown</th>
                  <td className="pt-3 pl-3 text-right">
                    <DeltaBadge value={visible.reduce((s, r) => s + r.deltaVsAverage, 0)} polarity="down-good" size="md" />
                  </td>
                  <td className="pt-3 pl-3 text-right font-mono tabular-nums text-xs font-bold" style={{ color: 'var(--fg)' }}>
                    {dollars(visible.reduce((s, r) => s + r.current, 0))}
                  </td>
                  <td className="pt-3 pl-3 text-right font-mono tabular-nums text-xs font-bold" style={{ color: 'var(--muted)' }}>
                    {previousLabel ? dollars(visible.reduce((s, r) => s + r.previous, 0)) : '—'}
                  </td>
                  <td className="pt-3 pl-3 text-right font-mono tabular-nums text-xs font-bold" style={{ color: 'var(--muted)' }}>
                    {dollars(visible.reduce((s, r) => s + r.average, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Mobile cards ── */}
          <ul className="md:hidden space-y-2">
            {visible.map(row => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpenCategory(row.id)}
                  className="ledger-cell p-3.5 w-full text-left"
                  aria-label={`Open details for ${row.name}`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
                        {row.name}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-sm font-semibold shrink-0" style={{ color: 'var(--fg)' }}>
                      {dollars(row.current)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {row.baselineMonths > 0 ? (
                      <DeltaBadge value={row.deltaVsAverage} polarity="down-good" suffix="vs typical" />
                    ) : (
                      <span className="text-[11px]" style={{ color: 'var(--dim)' }}>No history to compare</span>
                    )}
                    <span className="flex items-center gap-1.5 shrink-0">
                      <ConfidenceChip months={row.baselineMonths} />
                      {row.average > 0 && (
                        <span className="font-mono text-[10px]" style={{ color: 'var(--dim)' }}>
                          typical {dollars(row.average, 0)}
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {rows.length > COLLAPSED_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className="w-full mt-3 pt-3 text-xs font-semibold pressable"
              style={{ borderTop: '1px solid var(--line)', color: 'var(--accent)', minHeight: 44 }}
            >
              {expanded
                ? 'Show fewer categories'
                : `Show all ${rows.length} categories`}
            </button>
          )}

          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--dim)' }}>
            The bar shows {period.label}; the marker on it is the typical level. {baselineLabel}.
          </p>
        </>
      )}
    </section>
  );
};

export default PeriodComparisonTable;
