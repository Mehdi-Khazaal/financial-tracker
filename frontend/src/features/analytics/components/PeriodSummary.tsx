import React from 'react';
import type { PeriodSummaryData } from '../types';

interface Props {
  summary: PeriodSummaryData;
}

const VERDICT_STYLE: Record<string, { label: string; color: string; background: string }> = {
  stronger: { label: 'Stronger period', color: 'var(--pos)', background: 'var(--pos-dim)' },
  weaker: { label: 'Tighter period', color: 'var(--warn)', background: 'color-mix(in oklab, var(--warn) 12%, transparent)' },
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
    // The page's lead: the period in one sentence, the facts behind it, and
    // the one thing worth doing. Set as text, not in a box.
    <section className="max-w-3xl" aria-labelledby="analytics-summary-heading">
      <p className="sr-only">Your period at a glance</p>
      {verdict && (
        <p className="text-[13px] font-medium mb-2" style={{ color: verdict.color }}>{verdict.label}</p>
      )}
      <h2
        id="analytics-summary-heading"
        className="text-[22px] md:text-[28px] font-semibold leading-tight"
        style={{ color: 'var(--fg)', letterSpacing: '-0.02em', textWrap: 'balance' }}
      >
        {summary.headline}
      </h2>

      <ul className="mt-4 space-y-1.5">
        {summary.sentences.map((sentence, i) => (
          <li key={i} className="text-[15px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {sentence}
          </li>
        ))}
      </ul>

      {summary.suggestion && (
        <p className="mt-4 text-[15px] leading-relaxed" style={{ color: 'var(--fg)' }}>
          <span className="font-semibold">Worth doing: </span>{summary.suggestion}
        </p>
      )}

      {!summary.hasComparison && (
        <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
          There is no earlier period with activity to compare against yet, so this review describes
          the selected period on its own.
        </p>
      )}
    </section>
  );
};

export default PeriodSummary;
