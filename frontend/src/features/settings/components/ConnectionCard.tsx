import React, { useId, useState } from 'react';
import type { PlaidHealthRow, PlaidItemSummary } from '../types';
import {
  assessConnection,
  exactTime,
  lastSyncSummary,
  relativeTime,
  type ConnectionStatus,
} from '../calculations/connectionHealth';
import { Avatar } from './SettingsPrimitives';

/**
 * One connected institution: what it is, whether it looks well, and one action.
 *
 * Compact by intent. The diagnostics behind this are extensive, and the
 * temptation is to show them; but the everyday question is "is my bank still
 * feeding me data", and everything needed to answer it fits in three lines.
 * The rest lives behind Details, which is closed by default.
 *
 * Status is text plus a dot, never a dot alone — the whole point is that
 * "needs attention" reaches someone who cannot distinguish amber from green.
 */

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  healthy: 'var(--pos)',
  'needs-attention': 'var(--accent)',
  'sync-issue': 'var(--neg)',
  unavailable: 'var(--muted)',
  'not-synced-yet': 'var(--muted)',
  unknown: 'var(--dim)',
};

interface Props {
  item: PlaidItemSummary;
  health: PlaidHealthRow | undefined;
  /** True while diagnostics are still loading, so status is not yet knowable. */
  healthLoading: boolean;
  disconnecting: boolean;
  onDisconnect: () => void;
  /** Present only when this connection can actually be repaired via Link. */
  onReconnect?: () => void;
  reconnecting?: boolean;
  /**
   * Present only after a real Disconnect has failed against Plaid. Absent on
   * every other card, so the local-only removal can never be reached before
   * the honest path has been tried.
   */
  onRemoveAnyway?: () => void;
  removing?: boolean;
  now?: number;
}

const Row: React.FC<{ label: string; value: string; title?: string | null }> = ({
  label, value, title,
}) => (
  <div className="flex items-baseline justify-between gap-3 text-xs">
    <dt style={{ color: 'var(--dim)' }}>{label}</dt>
    <dd
      className="text-right min-w-0 truncate"
      style={{ color: 'var(--muted)' }}
      title={title ?? undefined}
    >
      {value}
    </dd>
  </div>
);

const ConnectionCard: React.FC<Props> = ({
  item, health, healthLoading, disconnecting, onDisconnect, onReconnect, reconnecting,
  onRemoveAnyway, removing, now,
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId().replace(/:/g, '');
  const assessment = assessConnection(health, now);
  const name = item.institution_name || 'Bank';

  const notRecorded = 'Not recorded yet';
  const value = (relative: string | null) => relative ?? notRecorded;

  return (
    <li
      className="p-4"
      style={{ borderBottom: '1px solid var(--line)' }}
    >
      <div className="flex items-start gap-3">
        <Avatar label={name} tone="positive" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-text truncate">{name}</p>
            {healthLoading ? (
              <span className="text-[10px]" style={{ color: 'var(--dim)' }}>Checking…</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block"
                  style={{ backgroundColor: STATUS_COLOR[assessment.status] }}
                  aria-hidden="true"
                />
                <span style={{ color: STATUS_COLOR[assessment.status] }}>{assessment.label}</span>
              </span>
            )}
          </div>

          <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
            Connected {new Date(item.created_at).toLocaleDateString()}
          </p>

          {!healthLoading && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
              {lastSyncSummary(health, now)}
            </p>
          )}

          {/* Only the states a person can act on get a sentence in the card
              itself. Everything healthy stays quiet. */}
          {!healthLoading && assessment.actionable && (
            <p className="text-xs mt-1.5" role="alert" style={{ color: 'var(--accent)' }}>
              {assessment.detail}
            </p>
          )}

          {/* Only for connections Plaid says can be repaired through Link, and
              deliberately the most prominent control on the card: it is the
              recommended recovery, and Disconnect beside it is not. */}
          {!healthLoading && onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              disabled={reconnecting}
              aria-busy={reconnecting}
              className="mt-2 min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
              style={{
                backgroundColor: 'var(--accent-dim)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-glow)',
              }}
            >
              {reconnecting ? 'Opening your bank…' : `Reconnect ${name}`}
            </button>
          )}

          {!healthLoading && assessment.deliveryDelayed && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
              Bank updates may be delayed reaching Fintrack.
            </p>
          )}
        </div>

        <button
          onClick={onDisconnect}
          disabled={disconnecting}
          aria-busy={disconnecting}
          aria-label={`Disconnect ${name}`}
          className="shrink-0 min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
          style={{
            backgroundColor: 'oklch(70% 0.17 25 / 0.1)',
            color: 'var(--neg)',
            border: '1px solid oklch(70% 0.17 25 / 0.2)',
          }}
        >
          {disconnecting ? '…' : 'Disconnect'}
        </button>
      </div>

      {/* Shown only once a Disconnect has actually failed, and deliberately the
          least prominent control on the card. The order of the three actions
          is the order they should be tried: Reconnect repairs, Disconnect is
          the correct removal, and this one is the last resort that cannot
          confirm anything with Plaid. Its consequence is stated here as well
          as in the confirmation, because a control this quiet should not rely
          on a dialog to carry the meaning. */}
      {onRemoveAnyway && (
        <div
          className="mt-3 pt-3"
          style={{ borderTop: '1px solid var(--line)' }}
          role="group"
          aria-label={`Troubleshooting for ${name}`}
        >
          <p className="text-xs leading-relaxed max-w-prose" style={{ color: 'var(--muted)' }}>
            Fintrack could not disconnect this bank with Plaid, so nothing was changed.
            Try Disconnect again first — removing it here only removes it from Fintrack,
            and the bank’s connection may stay active at Plaid.
          </p>
          <button
            type="button"
            onClick={onRemoveAnyway}
            disabled={removing}
            aria-busy={removing}
            className="mt-1.5 min-h-[44px] -ml-1 px-1 text-xs font-semibold underline underline-offset-2 disabled:opacity-40"
            style={{ color: 'var(--neg)' }}
          >
            {removing ? 'Removing…' : 'Remove from Fintrack anyway'}
          </button>
        </div>
      )}

      {health && (
        <>
          <button
            type="button"
            onClick={() => setDetailsOpen(open => !open)}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            className="mt-2 min-h-[44px] -ml-1 px-1 inline-flex items-center gap-1 text-xs font-semibold"
            style={{ color: 'var(--muted)' }}
          >
            Details
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`w-3.5 h-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {detailsOpen && (
            <dl
              id={detailsId}
              className="mt-1 space-y-1.5 pt-3"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <Row
                label="Last update from your bank"
                value={value(relativeTime(health.plaid_last_successful_update, now))}
                title={exactTime(health.plaid_last_successful_update)}
              />
              <Row
                label="Last update received"
                value={value(relativeTime(health.fintrack_last_webhook_at, now))}
                title={exactTime(health.fintrack_last_webhook_at)}
              />
              <Row
                label="Last sync"
                value={value(relativeTime(health.last_sync_at, now))}
                title={exactTime(health.last_sync_at)}
              />
              {health.last_sync_source && (
                <Row
                  label="Sync started by"
                  value={health.last_sync_source === 'webhook'
                    ? 'Your bank'
                    : health.last_sync_source === 'manual' ? 'You' : 'Fintrack'}
                />
              )}
              {health.last_added_count != null && (
                <Row
                  label="Last import"
                  value={`${health.last_added_count} added`}
                />
              )}
              <Row
                label="History set up"
                value={health.cursor_initialized ? 'Yes' : 'Not yet'}
              />
              {health.consent_expiration_time && (
                <Row
                  label="Access expires"
                  value={value(relativeTime(health.consent_expiration_time, now))}
                  title={exactTime(health.consent_expiration_time)}
                />
              )}
              {/* Sanitized server-side to a short, credential-free summary and
                  capped at 300 characters — see `_safe_error`. Kept out of the
                  card itself so a stack-shaped string is never the first thing
                  a user reads. */}
              {health.last_sync_ok === false && health.last_sync_error && (
                <Row label="Last error" value={health.last_sync_error} />
              )}
            </dl>
          )}
        </>
      )}
    </li>
  );
};

export default ConnectionCard;
