import React, { useState } from 'react';
import type { FinancialHealth } from '../types';
import { plural } from '../format';
import { Collapsible, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  health: FinancialHealth;
}

const LABEL_COLOR: Record<string, string> = {
  Excellent: 'var(--pos)',
  Good: 'var(--pos)',
  Fair: '#f59e0b',
  'Needs attention': 'var(--neg)',
};

/**
 * A score that shows its working.
 *
 * Nothing is hidden: every factor lists its measured value, its weight, and
 * the band that turned one into the other. If the arithmetic isn't convincing,
 * the user can see exactly which term to disagree with — which is the only way
 * a composite score like this earns any trust.
 */
const FinancialHealthCard: React.FC<Props> = ({ health }) => {
  // Open by default — the score is the point of the card. Collapsing is
  // offered so a long page can be shortened, not to hide the headline.
  const [open, setOpen] = useState(true);

  if (!health.available) {
    return (
      <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-health-heading">
        <SectionHeader
          id="analytics-health-heading"
          eyebrow="Financial health"
          title="Your overall position"
        />
        <div className="flex flex-col items-center text-center py-6 px-4 gap-2">
          <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
            More history is needed to calculate your financial health score.
          </p>
          <p className="text-xs max-w-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            The score needs {plural(health.requiredMonths, 'completed month')} of transactions so that savings
            rate, spending stability and emergency-fund cover can be measured against something.
            You have {plural(health.monthsOfHistory, 'completed month')} so far.
          </p>
        </div>
      </section>
    );
  }

  const score = health.score ?? 0;
  const change = health.previousScore != null ? score - health.previousScore : null;
  const color = LABEL_COLOR[health.label ?? 'Fair'] ?? 'var(--accent)';

  // Semicircular gauge: a 100-unit arc, filled to the score.
  const radius = 52;
  const circumference = Math.PI * radius;
  const filled = (score / 100) * circumference;

  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-health-heading">
      <SectionHeader
        id="analytics-health-heading"
        eyebrow="Financial health"
        title="Your overall position"
        description="A weighted summary of your own numbers. Not financial advice."
        hint="Each factor below is scored 0–100 against a stated band, then weighted. Weights are renormalised when a factor does not apply to you, so the total is always out of 100."
        toggle={{ open, onToggle: () => setOpen(v => !v), controls: 'analytics-health-body' }}
        collapsedSummary={`${score} out of 100 — ${health.label}`}
      />

      <div id="analytics-health-body" hidden={!open}>
      <div className="grid gap-5 sm:grid-cols-[160px_1fr] items-center">
        <div className="mx-auto" style={{ width: 140 }}>
          <svg viewBox="0 0 130 78" className="w-full" role="img" aria-label={`Financial health score ${score} out of 100, rated ${health.label}`}>
            <path
              d={`M 13 65 A ${radius} ${radius} 0 0 1 117 65`}
              fill="none"
              stroke="var(--line)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d={`M 13 65 A ${radius} ${radius} 0 0 1 117 65`}
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference}`}
            />
            <text
              x="65" y="58" textAnchor="middle"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, fill: 'var(--fg)' }}
            >
              {score}
            </text>
          </svg>
          <div className="text-center -mt-1">
            <p className="text-sm font-semibold" style={{ color }}>{health.label}</p>
            {change != null && change !== 0 && (
              <p
                className="font-mono text-[11px] mt-0.5"
                style={{ color: change > 0 ? 'var(--pos)' : 'var(--neg)' }}
              >
                {change > 0 ? '↑' : '↓'} {Math.abs(change)} from last month
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          {health.strengths.length > 0 && (
            <div>
              <p className="label mb-1.5" style={{ color: 'var(--pos)' }}>Working in your favour</p>
              <ul className="space-y-1">
                {health.strengths.map(factor => (
                  <li key={factor.key} className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                    <span style={{ color: 'var(--fg)' }}>{factor.label}:</span> {factor.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {health.weaknesses.length > 0 && (
            <div>
              <p className="label mb-1.5" style={{ color: '#f59e0b' }}>Holding the score back</p>
              <ul className="space-y-1">
                {health.weaknesses.map(factor => (
                  <li key={factor.key} className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                    <span style={{ color: 'var(--fg)' }}>{factor.label}:</span> {factor.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
        <Collapsible
          label="Show how the financial health score is calculated"
          summary={
            <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
              How this is calculated
            </span>
          }
        >
          <ul className="space-y-3">
            {health.factors.map(factor => (
              <li key={factor.key}>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-xs font-semibold" style={{ color: 'var(--fg)' }}>{factor.label}</p>
                  <p className="font-mono tabular-nums text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>
                    {Math.round(factor.score)}/100 · {Math.round(factor.weight * 100)}% weight
                  </p>
                </div>
                <div
                  className="h-1 rounded-full overflow-hidden mb-1.5"
                  style={{ backgroundColor: 'var(--line)' }}
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${factor.score}%`,
                      backgroundColor: factor.score >= 60 ? 'var(--pos)' : factor.score >= 40 ? '#f59e0b' : 'var(--neg)',
                    }}
                  />
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {factor.detail}. {factor.explanation}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-[10px] mt-4 leading-relaxed" style={{ color: 'var(--dim)' }}>
            Measured over your last {plural(Math.min(health.monthsOfHistory, 6), 'completed month')}. Spending is
            scored as a ratio to income, so a large month funded by a large income is not penalised. This is a
            summary of your own data, not professional financial advice.
          </p>
        </Collapsible>
      </div>
      </div>
    </section>
  );
};

export default FinancialHealthCard;
