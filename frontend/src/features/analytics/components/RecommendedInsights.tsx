import React from 'react';
import type { Insight, InsightTone } from '../types';
import { SectionHeader, PanelEmpty } from './AnalyticsPrimitives';

interface Props {
  insights: Insight[];
  onOpenCategory: (categoryId: number) => void;
  onNavigate: (to: string, tab?: string) => void;
}

const TONE: Record<InsightTone, { color: string; background: string; label: string; icon: string }> = {
  positive: {
    color: 'var(--pos)',
    background: 'var(--pos-dim)',
    label: 'Going well',
    icon: 'M5 10.5l3.5 3.5 7-7',
  },
  info: {
    color: 'var(--muted)',
    background: 'var(--elev-sub)',
    label: 'Worth knowing',
    icon: 'M10 9v5m0-8.5v.01',
  },
  warning: {
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.12)',
    label: 'Keep an eye on',
    icon: 'M10 6.5v4.5m0 3v.01M10 2.5l7.5 13h-15l7.5-13z',
  },
  action: {
    color: 'var(--accent)',
    background: 'oklch(72% 0.17 55 / 0.12)',
    label: 'To review',
    icon: 'M4 10h12m-5-5l5 5-5 5',
  },
};

/**
 * At most three insights, ranked. The cap is the point: a page that flags
 * everything flags nothing, and the ranking in `insights.ts` already discards
 * anything below a materiality threshold.
 */
const RecommendedInsights: React.FC<Props> = ({ insights, onOpenCategory, onNavigate }) => (
  <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-insights-heading">
    <SectionHeader
      id="analytics-insights-heading"
      eyebrow="Things to review"
      title="What to look at next"
      description="Drawn from the numbers on this page. Only changes large enough to matter are listed."
    />

    {insights.length === 0 ? (
      <PanelEmpty
        title="Nothing needs your attention"
        body="No category, subscription, or savings figure moved far enough from its usual level to be worth flagging in this period."
      />
    ) : (
      <ul className="space-y-2.5">
        {insights.map(insight => {
          const tone = TONE[insight.tone];
          return (
            <li
              key={insight.id}
              className="ledger-cell p-3.5 md:p-4 flex items-start gap-3"
            >
              <span
                className="shrink-0 rounded-lg flex items-center justify-center mt-0.5"
                style={{ width: 28, height: 28, backgroundColor: tone.background }}
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 20 20" fill="none" stroke={tone.color} strokeWidth="1.7"
                  strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"
                >
                  <path d={tone.icon} />
                </svg>
              </span>

              <div className="min-w-0 flex-1">
                {/* Text label alongside colour, so tone survives greyscale and colour-blindness. */}
                <p
                  className="label mb-1"
                  style={{ color: tone.color }}
                >
                  {tone.label}
                </p>
                <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--fg)' }}>
                  {insight.title}
                </p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {insight.body}
                </p>

                {insight.action && (
                  <button
                    type="button"
                    onClick={() => {
                      if (insight.action?.categoryId != null) onOpenCategory(insight.action.categoryId);
                      else if (insight.action?.to) onNavigate(insight.action.to, insight.action.tab);
                    }}
                    className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold rounded-lg pressable transition-colors"
                    style={{ color: 'var(--accent)', minHeight: 32 }}
                  >
                    {insight.action.label}
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3 h-3">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

export default RecommendedInsights;
