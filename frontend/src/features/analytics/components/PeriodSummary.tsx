import React from 'react';
import type { PeriodSummaryData } from '../types';

interface Props {
  summary: PeriodSummaryData;
}

const VERDICT_STYLE: Record<string, { label: string; color: string; background: string }> = {
  stronger: { label: 'Stronger period', color: 'var(--pos)', background: 'var(--pos-dim)' },
  weaker: { label: 'Tighter period', color: '#f59e0b', background: 'rgba(245,158,11,0.12)' },
  steady: { label: 'Steady', color: 'var(--muted)', background: 'var(--elev-sub)' },
};

/**
 * The written review of the period.
 *
 * Every clause is templated from a number computed elsewhere on this page, so
 * the prose can't drift from the charts below it. When there isn't enough
 * history to say something specific, it says less rather than hedging.
 */
const PeriodSummary: React.FC<Props> = ({ summary }) => {
  const verdict = summary.verdict ? VERDICT_STYLE[summary.verdict] : null;

  return (
    <section
      className="ledger-panel p-4 md:p-5"
      aria-labelledby="analytics-summary-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="label mb-1.5">Your period at a glance</p>
          <h2
            id="analytics-summary-heading"
            className="text-lg md:text-xl font-semibold leading-snug"
            style={{ color: 'var(--fg)' }}
          >
            {summary.headline}
          </h2>
        </div>
        {verdict && (
          <span
            className="font-mono text-[10px] px-2.5 py-1 rounded-full self-start whitespace-nowrap"
            style={{ color: verdict.color, backgroundColor: verdict.background }}
          >
            {verdict.label}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {summary.sentences.map((sentence, i) => (
          <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            {sentence}
          </p>
        ))}
      </div>

      {summary.suggestion && (
        <div
          className="mt-4 pt-3.5 flex items-start gap-2.5"
          style={{ borderTop: '1px solid var(--line)' }}
        >
          <svg
            viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
            aria-hidden="true" className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: 'var(--accent)' }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 2.5a5 5 0 00-3 9v1.5a1 1 0 001 1h4a1 1 0 001-1V11.5a5 5 0 00-3-9zM8.25 16.5h3.5" />
          </svg>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--fg)' }}>
            {summary.suggestion}
          </p>
        </div>
      )}

      {!summary.hasComparison && (
        <p className="text-[11px] mt-3" style={{ color: 'var(--dim)' }}>
          There is no earlier period with activity to compare against yet, so this review describes
          the selected period on its own.
        </p>
      )}
    </section>
  );
};

export default PeriodSummary;
