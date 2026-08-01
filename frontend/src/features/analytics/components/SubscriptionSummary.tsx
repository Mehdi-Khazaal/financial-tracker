import React from 'react';
import type { SubscriptionInsight } from '../types';
import { dollars, plural, signedDollars } from '../format';
import { PanelEmpty, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  subscriptions: SubscriptionInsight;
  onNavigate: (to: string, tab?: string) => void;
}

/**
 * Subscription cost, annualised.
 *
 * Fintrack cannot cancel anything on the user's behalf, so every action here
 * says "review" and links to the recurring list. Detected-but-undeclared
 * charges are shown in their own group, clearly marked as a suggestion rather
 * than a fact.
 */
const SubscriptionSummary: React.FC<Props> = ({ subscriptions, onNavigate }) => {
  const hasDeclared = subscriptions.count > 0;
  const hasAnything = hasDeclared || subscriptions.detected.length > 0;

  return (
    <section className="ledger-panel p-4 md:p-5 h-full flex flex-col" aria-labelledby="analytics-subs-heading">
      <SectionHeader
        id="analytics-subs-heading"
        eyebrow="Subscriptions"
        title="What repeats every month"
        hint="Weekly, quarterly and yearly charges are converted to a monthly equivalent so the total is comparable. The annual figure is that monthly total across twelve months."
        right={
          <button
            type="button"
            onClick={() => onNavigate('/transactions', 'recurring')}
            className="text-xs font-semibold pressable"
            style={{ color: 'var(--accent)' }}
          >
            Review →
          </button>
        }
      />

      {!hasAnything ? (
        <PanelEmpty
          title="No subscriptions tracked"
          body="Add your recurring services to see what they cost you a month and a year, and to be told when one changes price."
          action={
            <button
              type="button"
              onClick={() => onNavigate('/transactions', 'recurring')}
              className="btn-gradient px-5 py-2.5 text-sm mt-1"
            >
              Add a subscription
            </button>
          }
        />
      ) : (
        <>
          {hasDeclared && (
            <dl className="grid grid-cols-3 gap-2.5 mb-4">
              <div className="ledger-cell p-3">
                <dt className="label mb-1.5">Monthly</dt>
                <dd className="font-mono tabular-nums text-sm font-bold" style={{ color: 'var(--fg)' }}>
                  {dollars(subscriptions.monthlyTotal)}
                </dd>
              </div>
              <div className="ledger-cell p-3">
                <dt className="label mb-1.5">A year</dt>
                <dd className="font-mono tabular-nums text-sm font-bold" style={{ color: 'var(--accent)' }}>
                  {dollars(subscriptions.annualized, 0)}
                </dd>
              </div>
              <div className="ledger-cell p-3">
                <dt className="label mb-1.5">Services</dt>
                <dd className="font-mono tabular-nums text-sm font-bold" style={{ color: 'var(--fg)' }}>
                  {subscriptions.count}
                </dd>
              </div>
            </dl>
          )}

          {subscriptions.increased.length > 0 && (
            <div className="mb-4">
              <p className="label mb-2.5">Recently went up</p>
              <ul className="space-y-2">
                {subscriptions.increased.map(item => (
                  <li key={item.name} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>{item.name}</p>
                      <p className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>
                        {dollars(item.from)} → {dollars(item.to)}
                      </p>
                    </div>
                    <p className="font-mono tabular-nums text-xs font-semibold shrink-0" style={{ color: 'var(--neg)' }}>
                      {signedDollars(item.delta)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {subscriptions.possibleDuplicates.length > 0 && (
            <div
              className="mb-4 rounded-lg p-3"
              style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}
            >
              <p className="label mb-1.5">Possible overlap</p>
              {subscriptions.possibleDuplicates.map(duplicate => (
                <p key={duplicate.names.join('|')} className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  <span style={{ color: 'var(--fg)' }}>{duplicate.names.join(' and ')}</span> {duplicate.note} Worth
                  confirming before either renews.
                </p>
              ))}
            </div>
          )}

          {subscriptions.detected.length > 0 && (
            <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--line)' }}>
              <p className="label mb-1.5">Not set up yet</p>
              <p className="text-[11px] mb-2.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
                {plural(subscriptions.detected.length, 'charge')} in your history repeats on a regular cycle at a
                steady amount, but is not tracked as recurring.
              </p>
              <ul className="space-y-1.5">
                {subscriptions.detected.slice(0, 3).map(item => (
                  <li key={item.key} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>{item.name}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>
                        about every {item.medianIntervalDays} days · {plural(item.occurrences, 'charge')}
                      </p>
                    </div>
                    <p className="font-mono tabular-nums text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                      {dollars(item.monthlyAmount)}/mo
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default SubscriptionSummary;
