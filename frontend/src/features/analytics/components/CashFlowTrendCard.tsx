import React from 'react';
import type { TrendMonth } from '../types';
import { MINUS, compactDollars, dollars, monthLabel, monthTick, plural } from '../format';
import { PanelEmpty, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  trend: TrendMonth[];
  periodLabel: string;
}

const INCOME = 'color-mix(in oklab, var(--fg) 22%, var(--bg))';
const SPENDING = 'var(--fg)';
const CHART_HEIGHT = 200;

/** Rounds a gridline step up to 1, 2, 2.5 or 5 times a power of ten. */
const niceStep = (raw: number): number => {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  return nice * magnitude;
};

const signedCompact = (value: number): string =>
  value > 0 ? `+${compactDollars(value)}` : value < 0 ? compactDollars(value) : '$0';

/** A hatch for a month still running: same colour, visibly unfinished. */
const hatch = (color: string): React.CSSProperties => ({
  backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`,
  boxShadow: `inset 0 0 0 1px ${color}`,
});

/**
 * A year of cash flow: what came in and what went out each month, with what
 * was kept written underneath. The selected period is drawn at full strength
 * and the months around it lighter, so it reads against what came before.
 *
 * Plain elements rather than a chart library: two bars and a number per month
 * need nothing more, and the text stays crisp at any width. Screen readers get
 * the same figures as a table.
 */
const CashFlowTrendCard: React.FC<Props> = ({ trend, periodLabel }) => {
  const hasData = trend.some(m => m.income > 0 || m.expenses > 0);
  const complete = trend.filter(m => !m.partial && (m.income > 0 || m.expenses > 0));

  const max = Math.max(1, ...trend.map(m => Math.max(m.income, m.expenses)));
  const step = niceStep(max / 3);
  const top = step * Math.ceil(max / step);
  const gridlines = Array.from({ length: Math.round(top / step) }, (_, i) => step * (i + 1));
  const pct = (value: number) => `${Math.max(0, Math.min(100, (value / top) * 100))}%`;

  const avg = (pick: (m: TrendMonth) => number) =>
    complete.length > 0 ? complete.reduce((s, m) => s + pick(m), 0) / complete.length : 0;
  const surplusMonths = complete.filter(m => m.net > 0).length;
  const oneOffCount = complete.filter(m => m.oneOffs > 0).length;
  const best = complete.reduce<TrendMonth | null>((b, m) => (b == null || m.net > b.net ? m : b), null);
  const partial = trend.find(m => m.partial);

  return (
    <section className="report-section" aria-labelledby="analytics-trend-heading">
      <SectionHeader
        id="analytics-trend-heading"
        eyebrow="Cash flow"
        title="Cash flow"
        description={`Income and spending each month, with what was kept underneath. ${periodLabel} is drawn at full strength.`}
        right={hasData ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" style={{ color: 'var(--muted)' }} aria-hidden="true">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5" style={{ background: INCOME }} />Income</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5" style={{ background: SPENDING }} />Spending</span>
          </div>
        ) : undefined}
      />

      {!hasData || trend.length < 2 ? (
        <PanelEmpty
          title="Not enough months yet"
          body="The trend appears once there are two months of income or spending to compare."
        />
      ) : (
        <div>
          <div aria-hidden="true">
            {/* Headroom so the top gridline's label clears the section rule. */}
            <div className="relative mt-6" style={{ height: CHART_HEIGHT }}>
              {gridlines.map(value => (
                <div
                  key={value}
                  className="absolute left-0 right-0 flex justify-end"
                  style={{ bottom: pct(value), borderTop: '1px solid var(--line)' }}
                >
                  <span className="text-xs -mt-[1px] pl-1 tabular-nums" style={{ color: 'var(--dim)', background: 'var(--bg)', transform: 'translateY(-100%)' }}>
                    {compactDollars(value)}
                  </span>
                </div>
              ))}
              <div className="absolute inset-0 flex items-end">
                {trend.map(m => (
                  <div
                    key={m.month}
                    className="flex-1 h-full flex items-end justify-center gap-[3px]"
                    style={{ opacity: m.inPeriod ? 1 : 0.38 }}
                    title={`${monthLabel(m.month)}${m.partial ? ' so far' : ''}: income ${dollars(m.income)}, spending ${dollars(m.expenses)}`}
                  >
                    <span
                      className="w-[34%] max-w-[16px] rounded-t-[1px]"
                      style={{ height: pct(m.income), minHeight: m.income > 0 ? 1 : 0, ...(m.partial ? hatch(INCOME) : { background: INCOME }) }}
                    />
                    <span
                      className="w-[34%] max-w-[16px] rounded-t-[1px]"
                      style={{ height: pct(m.expenses), minHeight: m.expenses > 0 ? 1 : 0, ...(m.partial ? hatch(SPENDING) : { background: SPENDING }) }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex" style={{ borderTop: '1px solid var(--fg)' }}>
              {trend.map(m => (
                <div
                  key={m.month}
                  className="flex-1 text-center pt-1.5 text-xs"
                  style={{ color: m.inPeriod ? 'var(--fg)' : 'var(--muted)', fontWeight: m.inPeriod ? 600 : 400 }}
                >
                  {monthTick(m.month)}
                </div>
              ))}
            </div>
            {/* What was kept, per month. Too dense for a phone, where the
                averages below carry it instead. */}
            <div className="hidden sm:flex mt-1">
              {trend.map(m => (
                <div
                  key={m.month}
                  className="flex-1 text-center text-xs tabular-nums"
                  style={{ color: m.income === 0 && m.expenses === 0 ? 'var(--dim)' : m.net >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                >
                  {m.income === 0 && m.expenses === 0 ? '—' : signedCompact(m.net)}
                </div>
              ))}
            </div>
            {partial && (
              <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                {monthTick(partial.month)} is still running, so its bars are hatched and show the month so far.
              </p>
            )}
          </div>

          {/* `sr-only` goes on a wrapper: a table ignores the 1px width and
              would widen the page on a phone. */}
          <div className="sr-only">
          <table>
            <caption>Income, spending and money kept by month</caption>
            <thead>
              <tr><th scope="col">Month</th><th scope="col">Income</th><th scope="col">Spending</th><th scope="col">Kept</th></tr>
            </thead>
            <tbody>
              {trend.map(m => (
                <tr key={m.month}>
                  <th scope="row">{monthLabel(m.month)}{m.partial ? ' (so far)' : ''}</th>
                  <td>{dollars(m.income)}</td>
                  <td>{dollars(m.expenses)}</td>
                  <td>{m.net < 0 ? `${MINUS}${dollars(Math.abs(m.net))}` : dollars(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {complete.length > 0 && (
            <dl className="metric-strip metric-strip--dense grid grid-cols-2 lg:grid-cols-4 mt-6">
              <div className="metric-tile">
                <dt className="metric-label">Average income</dt>
                <dd className="metric-value">{dollars(avg(m => m.income), 0)}</dd>
                <dd className="metric-note">a month, {plural(complete.length, 'full month')}</dd>
              </div>
              <div className="metric-tile">
                <dt className="metric-label">Average spending</dt>
                <dd className="metric-value">{dollars(avg(m => m.expenses), 0)}</dd>
                <dd className="metric-note">a month</dd>
              </div>
              <div className="metric-tile">
                <dt className="metric-label">Average kept</dt>
                <dd className="metric-value" style={{ color: avg(m => m.net) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {signedCompact(Math.round(avg(m => m.net)))}
                </dd>
                <dd className="metric-note">
                  {/* The goal plan funds goals from a usual month, so say what that is. */}
                  {oneOffCount > 0
                    ? `a month; ${signedCompact(Math.round(avg(m => m.net + m.oneOffs)))} in a usual month, leaving out big one-offs`
                    : 'a month'}
                </dd>
              </div>
              <div className="metric-tile">
                <dt className="metric-label">Months with money left</dt>
                <dd className="metric-value">{surplusMonths} of {complete.length}</dd>
                <dd className="metric-note">{best && best.net > 0 ? `Best: ${monthLabel(best.month)}, ${signedCompact(best.net)}` : 'No month ended ahead yet'}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </section>
  );
};

export default CashFlowTrendCard;
