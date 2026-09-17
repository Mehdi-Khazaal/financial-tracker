import React from 'react';
import type { RecurringGroupKey, RecurringSuggestion } from '../../../types';
import { dollars } from '../../analytics/format';
import { GroupIcon } from './GroupIcon';
import { PERIOD_LABEL, billAmount, num, shortDate } from '../calculations';

interface Props {
  suggestions: RecurringSuggestion[];
  /** Group the user picked before tracking, keyed by identity. */
  chosenGroups: Record<string, RecurringGroupKey>;
  groupLabels: Record<string, string>;
  busyIdentity: string | null;
  onTrack: (suggestion: RecurringSuggestion) => void;
  onDismiss: (suggestion: RecurringSuggestion) => void;
  onChangeGroup: (suggestion: RecurringSuggestion) => void;
}

/**
 * Repeating charges found in the transaction history that are not tracked.
 *
 * Each one says *why* it was suggested — how many charges, on what cycle, and
 * what the bank called it — so tracking one is a decision rather than a leap
 * of faith. Nothing is tracked until the user taps Track; "Not a bill" hides
 * it for good.
 */
const SuggestionList: React.FC<Props> = ({
  suggestions, chosenGroups, groupLabels, busyIdentity, onTrack, onDismiss, onChangeGroup,
}) => {
  if (suggestions.length === 0) return null;
  const monthlyTotal = suggestions.filter(s => !s.is_income).reduce((sum, s) => sum + num(s.monthly_amount), 0);

  return (
    <section aria-labelledby="recurring-found-heading">
      <div className="flex items-baseline justify-between gap-3 mb-2.5 px-1">
        <div>
          <h2 id="recurring-found-heading" className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>
            Found in your transactions
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {suggestions.length === 1 ? 'This looks recurring' : `${suggestions.length} charges look recurring`}
            {monthlyTotal > 0 && <span className="tabular-nums"> · about {dollars(monthlyTotal)} a month not in your total yet</span>}
          </p>
        </div>
      </div>

      <ul className="space-y-2.5 stagger-in">
        {suggestions.map(s => {
          const group = chosenGroups[s.identity] ?? s.group_key;
          const busy = busyIdentity === s.identity;
          return (
            <li key={s.identity} className="card p-4" style={{ borderColor: s.confidence === 'high' ? 'rgba(249,115,22,0.28)' : undefined }}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>{s.name}</p>
                    {s.confidence === 'high' && (
                      <span className="label shrink-0" style={{ color: 'var(--accent)', fontSize: 9 }}>Strong match</span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                    {s.account_name ?? 'Account'} · last {shortDate(s.last_date)} · next about {shortDate(s.next_date)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono tabular-nums text-sm font-medium" style={{ color: s.is_income ? 'var(--pos)' : 'var(--fg)' }}>
                    {billAmount(s.amount, s.is_variable, dollars)}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--dim)' }}>{PERIOD_LABEL[s.period]}</p>
                </div>
              </div>

              <ul className="flex flex-wrap gap-1.5 mt-3" aria-label="Why this was suggested">
                {s.reasons.map(reason => (
                  <li key={reason} className="text-[11px] px-2 py-0.5 rounded-full tabular-nums"
                    style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                    {reason}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2 mt-3.5">
                {!s.is_income && (
                  <button type="button" onClick={() => onChangeGroup(s)}
                    className="flex items-center gap-2 text-xs font-medium pressable rounded-lg pr-2.5"
                    style={{ color: 'var(--fg)', minHeight: 36 }}
                    aria-label={`Group: ${groupLabels[group] ?? s.group_label}. Change group`}>
                    <GroupIcon group={group} size={14} />
                    {groupLabels[group] ?? s.group_label}
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" style={{ color: 'var(--dim)' }} aria-hidden="true">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
                <span className="flex-1" />
                <button type="button" onClick={() => onDismiss(s)} disabled={busy}
                  className="btn-ghost px-3.5 py-2 text-xs disabled:opacity-50">
                  Not a bill
                </button>
                <button type="button" onClick={() => onTrack(s)} disabled={busy}
                  className="btn-gradient px-4 py-2 text-xs disabled:opacity-50">
                  {busy ? 'Tracking…' : 'Track'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default SuggestionList;
