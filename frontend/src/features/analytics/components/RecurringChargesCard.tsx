import React, { useState } from 'react';
import type { SubscriptionInsight } from '../types';
import { dollars, plural, signedDollars } from '../format';
import { Collapsible, PanelEmpty, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  subscriptions: SubscriptionInsight;
  onNavigate: (to: string, tab?: string) => void;
}

const PERIOD_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/**
 * Everything that charges on a schedule, grouped by what it actually is.
 *
 * "Subscriptions" was doing too much work as a heading — a water bill is not a
 * subscription. Bills (amount varies each cycle) and subscriptions (same
 * amount every cycle) are now separated using fields the user set, so the
 * grouping can explain itself rather than guessing from merchant names.
 *
 * Fintrack cannot cancel anything, so every action reads "review".
 */
const RecurringChargesCard: React.FC<Props> = ({ subscriptions, onNavigate }) => {
  const [open, setOpen] = useState(false);
  const hasDeclared = subscriptions.count > 0;
  const hasAnything = hasDeclared || subscriptions.detected.length > 0;

  return (
    <section className="ledger-panel p-4 md:p-5 h-full flex flex-col" aria-labelledby="analytics-recurring-heading">
      <SectionHeader
        id="analytics-recurring-heading"
        eyebrow="Recurring charges"
        title="What repeats on a schedule"
        hint="Weekly, quarterly and yearly charges are converted to a monthly equivalent so totals are comparable. Bills are charges whose amount changes each cycle; subscriptions are the same amount every time."
        toggle={{ open, onToggle: () => setOpen(v => !v), controls: 'analytics-recurring-body' }}
        collapsedSummary={hasDeclared
          ? `${dollars(subscriptions.monthlyTotal)} a month across ${plural(subscriptions.count, 'charge')} · ${dollars(subscriptions.annualized, 0)} a year`
          : 'Nothing recurring tracked yet'}
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

      {/* The `flex` class must drop when collapsed: a stylesheet `display:flex`
          beats the user-agent `[hidden] { display: none }`, so the panel would
          stay visible with only the chevron flipping. */}
      <div id="analytics-recurring-body" hidden={!open} className={open ? 'flex-1 flex flex-col' : undefined}>
      {!hasAnything ? (
        <PanelEmpty
          title="Nothing recurring tracked yet"
          body="Add your bills and subscriptions to see what they cost each month and each year, and to be told when one changes price."
          action={
            <button
              type="button"
              onClick={() => onNavigate('/transactions', 'recurring')}
              className="btn-gradient px-5 py-2.5 text-sm mt-1"
            >
              Add a recurring charge
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
                <dt className="label mb-1.5">Charges</dt>
                <dd className="font-mono tabular-nums text-sm font-bold" style={{ color: 'var(--fg)' }}>
                  {subscriptions.count}
                </dd>
              </div>
            </dl>
          )}

          {/* ── Grouped: bills, subscriptions, other ── */}
          {subscriptions.groups.map((group, index) => (
            <div
              key={group.kind}
              className={index > 0 ? 'mt-2 pt-2' : ''}
              style={index > 0 ? { borderTop: '1px solid var(--line)' } : undefined}
            >
              <Collapsible
                label={`Show ${group.label.toLowerCase()}`}
                defaultOpen={index === 0}
                summary={
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold" style={{ color: 'var(--fg)' }}>
                      {group.label}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--dim)' }}>
                      {group.charges.length} · {dollars(group.monthlyTotal)}/mo
                    </span>
                  </span>
                }
              >
                <p className="text-[10px] mb-2.5" style={{ color: 'var(--dim)' }}>{group.description}</p>
                <ul className="space-y-2">
                  {group.charges.map(charge => (
                    <li key={charge.id} className="flex items-center gap-3">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: charge.categoryColor }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>
                          {charge.name}
                        </span>
                        <span className="block text-[10px] mt-0.5 truncate" style={{ color: 'var(--dim)' }}>
                          {PERIOD_LABEL[charge.period] ?? charge.period}
                          {charge.categoryName && ` · ${charge.categoryName}`}
                          {charge.isVariable && ' · amount varies'}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block font-mono tabular-nums text-xs font-semibold" style={{ color: 'var(--fg)' }}>
                          {dollars(charge.amount)}
                        </span>
                        {charge.period !== 'monthly' && (
                          <span className="block font-mono text-[10px]" style={{ color: 'var(--dim)' }}>
                            {dollars(charge.monthlyAmount)}/mo
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </Collapsible>
            </div>
          ))}

          {subscriptions.increased.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
              <p className="label mb-2.5">Recently went up</p>
              <ul className="space-y-2">
                {subscriptions.increased.map(item => (
                  <li key={item.name} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>{item.name}</span>
                      <span className="block font-mono text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>
                        {dollars(item.from)} → {dollars(item.to)}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-xs font-semibold shrink-0" style={{ color: 'var(--neg)' }}>
                      {signedDollars(item.delta)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {subscriptions.possibleDuplicates.length > 0 && (
            <div
              className="mt-3 rounded-lg p-3"
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

          {/* ── Unconfirmed detections ── */}
          {subscriptions.detected.length > 0 && (
            <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--line)' }}>
              <p className="label mb-1.5">
                {plural(subscriptions.detected.length, 'possible recurring charge')}
              </p>
              <p className="text-[11px] mb-2.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
                These charge on a regular cycle at a steady amount, but you have not set them up as
                recurring. Fintrack has not confirmed what they are.
              </p>
              <ul className="space-y-1.5">
                {subscriptions.detected.slice(0, 3).map(item => (
                  <li key={item.key} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>{item.name}</span>
                      <span className="block text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>
                        about every {item.medianIntervalDays} days · seen {plural(item.occurrences, 'time')}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                      {dollars(item.monthlyAmount)}/mo
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      </div>
    </section>
  );
};

export default RecurringChargesCard;
