import React from 'react';
import { Link } from 'react-router-dom';
import type { StatusInsight } from '../types';

/**
 * One line telling the user what to look at next.
 *
 * One, not a list: Analytics already owns "here are three things about your
 * spending", and a second ranked list on Overview would only ever compete with
 * it. Tone is carried by an icon and a word as well as a colour, so the meaning
 * survives colour-blindness and greyscale.
 */

const TONE_STYLES: Record<StatusInsight['tone'], { color: string; background: string; border: string; word: string }> = {
  attention: { color: 'var(--accent)', background: 'oklch(72% 0.17 55 / 0.10)', border: 'oklch(72% 0.17 55 / 0.28)', word: 'Needs attention' },
  neutral: { color: 'var(--muted)', background: 'var(--elev-sub)', border: 'var(--line)', word: 'Status' },
  positive: { color: 'var(--pos)', background: 'var(--pos-dim)', border: 'rgba(34,197,94,0.28)', word: 'All clear' },
};

const ICONS: Record<StatusInsight['tone'], string> = {
  // Exclamation, information, check — distinguishable without colour.
  attention: 'M10 6v5m0 3h.01M10 17.5a7.5 7.5 0 110-15 7.5 7.5 0 010 15z',
  neutral: 'M10 13V9m0-3h.01M10 17.5a7.5 7.5 0 110-15 7.5 7.5 0 010 15z',
  positive: 'M6.5 10.5l2.5 2.5 4.5-5M10 17.5a7.5 7.5 0 110-15 7.5 7.5 0 010 15z',
};

const StatusInsightCard: React.FC<{ insight: StatusInsight }> = ({ insight }) => {
  const tone = TONE_STYLES[insight.tone];

  return (
    <section
      className="rounded-xl px-4 py-3.5"
      aria-label="Status"
      style={{ backgroundColor: tone.background, border: `1px solid ${tone.border}` }}
    >
      <div className="flex items-start gap-3">
        <svg
          viewBox="0 0 20 20" fill="none" stroke={tone.color} strokeWidth={1.6}
          strokeLinecap="round" strokeLinejoin="round"
          className="w-[18px] h-[18px] shrink-0 mt-0.5" aria-hidden="true"
        >
          <path d={ICONS[insight.tone]} />
        </svg>

        <div className="min-w-0 flex-1">
          {/* The status word makes the tone readable without relying on colour. */}
          <p className="label mb-1" style={{ color: tone.color }}>{tone.word}</p>
          <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{insight.title}</p>
          {insight.detail && (
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--muted)' }}>{insight.detail}</p>
          )}
        </div>

        {insight.action && (
          <Link
            to={insight.action.to}
            className="shrink-0 self-center text-xs font-semibold rounded-lg px-3 flex items-center pressable"
            style={{ color: tone.color, border: `1px solid ${tone.border}`, minHeight: 36 }}
          >
            {insight.action.label}
          </Link>
        )}
      </div>
    </section>
  );
};

export default StatusInsightCard;
