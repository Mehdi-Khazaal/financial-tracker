import React from 'react';
import type { FinancialHealth } from '../types';
import { plural } from '../format';
import { InfoHint, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  health: FinancialHealth;
}

/** One word per ratio, so the column can be scanned top to bottom. */
const rating = (score: number): { word: string; color: string } =>
  score >= 80 ? { word: 'Strong', color: 'var(--pos)' }
    : score >= 60 ? { word: 'Good', color: 'var(--fg)' }
      : score >= 40 ? { word: 'Fair', color: 'var(--warn)' }
        : { word: 'Weak', color: 'var(--neg)' };

/**
 * The ratios a planner would look at first, each with its figure and a
 * one-word reading.
 *
 * It replaces a scored gauge. A dial reading "88" said how the page felt
 * about you; the ratios underneath it say what to do, so they lead and the
 * overall score is one line of the description.
 */
const KeyRatiosCard: React.FC<Props> = ({ health }) => {
  const change = health.score != null && health.previousScore != null ? health.score - health.previousScore : null;

  return (
    <section className="report-section" aria-labelledby="analytics-ratios-heading">
      <SectionHeader
        id="analytics-ratios-heading"
        eyebrow="Financial health"
        title="Key ratios"
        description={health.available && health.score != null
          ? `Taken together, ${health.score} of 100 (${health.label?.toLowerCase()})${change ? `, ${change > 0 ? 'up' : 'down'} ${Math.abs(change)} from last month` : ''}. Measured over your last ${plural(health.monthsOfHistory, 'completed month')}.`
          : 'How savings, spending and debt compare with common rules of thumb.'}
        hint="Each ratio is scored against a common rule of thumb, such as keeping three to six months of spending in cash. The overall figure weights them together. It is a summary of your own numbers, not financial advice."
      />

      {!health.available ? (
        <div className="py-2">
          <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
            More history is needed before these can be measured.
          </p>
          <p className="text-[13px] mt-1 max-w-prose leading-relaxed" style={{ color: 'var(--muted)' }}>
            The ratios need {plural(health.requiredMonths, 'completed month')} of transactions, so savings rate,
            spending stability and emergency-fund cover have something to be measured against.
            You have {plural(health.monthsOfHistory, 'completed month')} so far.
          </p>
        </div>
      ) : (
        <ul className="row-list" style={{ borderBottom: '1px solid var(--line)' }}>
          {health.factors.map(factor => {
            const r = rating(factor.score);
            return (
              <li key={factor.key} className="grid grid-cols-[1fr_auto] sm:grid-cols-[12rem_1fr_5rem] gap-x-6 gap-y-1 py-3 items-baseline">
                <span className="flex items-center gap-1.5 text-sm font-medium min-w-0" style={{ color: 'var(--fg)' }}>
                  <span className="truncate">{factor.label}</span>
                  <InfoHint label={`About ${factor.label.toLowerCase()}`} text={factor.explanation} />
                </span>
                <span className="text-sm text-right sm:order-last font-semibold" style={{ color: r.color }}>{r.word}</span>
                <span className="col-span-2 sm:col-span-1 text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>{factor.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default KeyRatiosCard;
