import React from 'react';
import { Link } from 'react-router-dom';
import type { BriefIcon, BriefItem, BriefTone } from '../calculations/brief';

/**
 * The Morning Brief.
 *
 * A short list of sentences, not a card of statistics. Everything numeric on
 * this page is a number somewhere else; the brief's job is to say what those
 * numbers *mean* this morning, in the order they matter.
 *
 * Design constraints that shaped it:
 *   • One line per item, so four items read in about ten seconds.
 *   • Tone carried by an icon and a rail colour, never colour alone.
 *   • No card chrome per item — a stack of bordered boxes would out-shout the
 *     net-worth figure directly beneath it, which is the wrong hierarchy.
 */

/**
 * Currency as produced by `dollars()` — `$1,234.56`, always two decimals.
 *
 * Deliberately only currency. Privacy mode exists so a balance cannot be read
 * over your shoulder; a transaction count or a percentage is not a balance, and
 * blurring "3 imported transactions" would make the sentence unreadable for no
 * gain. This matches what the rest of the page already blurs — amounts, never
 * counts.
 */
const MONEY_PATTERN = /\$[\d,]+\.\d{2}/g;

/**
 * Renders a sentence with only its money blurred under privacy mode.
 *
 * The brief writes prose, not figures in cells, so it cannot simply put
 * `tabular-nums` on a whole element the way the metric tiles do — that would
 * blur the words too. Splitting on the amounts keeps the sentence legible while
 * the numbers go soft, which is the point of the mode.
 */
export const SensitiveSentence: React.FC<{ children: string }> = ({ children }) => {
  const parts: React.ReactNode[] = [];
  const pattern = new RegExp(MONEY_PATTERN.source, 'g');
  let cursor = 0;
  let match = pattern.exec(children);

  while (match !== null) {
    if (match.index > cursor) parts.push(children.slice(cursor, match.index));
    parts.push(
      <span key={`${match.index}-${match[0]}`} className="tabular-nums">{match[0]}</span>,
    );
    cursor = match.index + match[0].length;
    match = pattern.exec(children);
  }
  if (cursor < children.length) parts.push(children.slice(cursor));

  return <>{parts}</>;
};

const TONE_COLOR: Record<BriefTone, string> = {
  attention: 'var(--accent)',
  neutral: 'var(--muted)',
  positive: 'var(--pos)',
};

const ICON_PATHS: Record<BriefIcon, string> = {
  alert: 'M10 6v5m0 3h.01M10 17.5a7.5 7.5 0 110-15 7.5 7.5 0 010 15z',
  info: 'M10 13V9m0-3h.01M10 17.5a7.5 7.5 0 110-15 7.5 7.5 0 010 15z',
  check: 'M6.5 10.5l2.5 2.5 4.5-5M10 17.5a7.5 7.5 0 110-15 7.5 7.5 0 010 15z',
  calendar: 'M6.5 3v2.5M13.5 3v2.5M3 8h14M4.5 4.5h11A1.5 1.5 0 0117 6v10a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16V6a1.5 1.5 0 011.5-1.5z',
  inflow: 'M10 15.5V4.5m0 0L5.5 9M10 4.5L14.5 9',
  outflow: 'M10 4.5v11m0 0L5.5 11M10 15.5L14.5 11',
  goal: 'M10 17.5a7.5 7.5 0 110-15 7.5 7.5 0 010 15zm0-4.5a3 3 0 110-6 3 3 0 010 6z',
  trend: 'M3 13.5l4.5-4.5 3 3L17 5.5M17 5.5h-4M17 5.5v4',
};

interface Props {
  items: BriefItem[];
  /** Long date, e.g. "Sunday, August 2". */
  dateLabel: string;
}

const MorningBrief: React.FC<Props> = ({ items, dateLabel }) => (
  <section
    className="ledger-panel px-4 py-4 md:px-5 md:py-5"
    aria-labelledby="morning-brief-heading"
  >
    {/* The page header already greets by name; repeating it here would spend
        the brief's first line on something the user just read. */}
    <div className="flex items-baseline justify-between gap-3 mb-3.5">
      <h2 className="label" id="morning-brief-heading">Today</h2>
      <p className="label shrink-0 truncate">{dateLabel}</p>
    </div>

    {items.length === 0 ? (
      // Nothing qualified. Saying so is the honest option; padding the brief
      // with a manufactured observation is what this module exists to avoid.
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Nothing needs your attention this morning.
      </p>
    ) : (
      <ul className="space-y-2.5">
        {items.map(item => {
          const color = TONE_COLOR[item.tone];
          return (
            <li key={item.id} className="flex items-start gap-2.5">
              <svg
                viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.6}
                strokeLinecap="round" strokeLinejoin="round"
                className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true"
              >
                <path d={ICON_PATHS[item.icon]} />
              </svg>

              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug" style={{ color: 'var(--fg)' }}>
                  <SensitiveSentence>{item.text}</SensitiveSentence>
                </p>
                {item.detail && (
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
                    <SensitiveSentence>{item.detail}</SensitiveSentence>
                  </p>
                )}
              </div>

              {item.action && (
                <Link
                  to={item.action.to}
                  className="shrink-0 text-xs font-semibold flex items-center px-1.5 rounded-md"
                  style={{ color, minHeight: 32 }}
                >
                  {item.action.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

export default MorningBrief;
