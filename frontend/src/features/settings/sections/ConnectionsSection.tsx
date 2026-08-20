import React from 'react';
import type { UsePlaidConnections } from '../hooks/usePlaidConnections';
import {
  Avatar,
  EmptyBlock,
  LoadingBlock,
  SectionErrorBlock,
  SectionHeading,
  SettingsRow,
} from '../components/SettingsPrimitives';

/**
 * Connected banks.
 *
 * Behaviour is unchanged from the page — 6C owns wiring `/plaid/sync-health`
 * into this section, moving Reset into a Danger Zone, and reconnect/repair.
 * The one thing fixed here is the load state: `plaidGetItems` previously failed
 * into a bare `catch {}`, so a request that never succeeded rendered as "no
 * banks connected". That is the single most misleading thing this section
 * could say, since the obvious next step — reconnect — is destructive-adjacent
 * and entirely unnecessary if the connection is fine.
 */

interface Props {
  connections: UsePlaidConnections;
}

const ConnectionsSection: React.FC<Props> = ({ connections }) => {
  const hasItems = connections.items.length > 0;

  return (
    <section aria-labelledby="settings-connections-heading">
      <SectionHeading
        title="Connected banks"
        badge={(
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)' }}
          >
            PLAID
          </span>
        )}
      />
      <h2 className="sr-only" id="settings-connections-heading">Connected banks</h2>

      <div className="flex gap-2 flex-wrap mb-3">
        {hasItems && (
          <button
            onClick={() => { void connections.syncNow(); }}
            disabled={connections.syncing}
            className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
            style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.1)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.2)' }}
          >
            {connections.syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        )}
        <button
          onClick={connections.startConnect}
          className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-all"
          style={{ backgroundColor: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-glow)' }}
        >
          + Connect Bank
        </button>
      </div>

      {connections.status === 'loading' ? (
        <LoadingBlock label="Loading connected banks" />
      ) : connections.status === 'error' ? (
        <SectionErrorBlock
          message="Your connected banks could not be loaded. This does not mean they are disconnected."
          onRetry={connections.reload}
        />
      ) : !hasItems ? (
        <EmptyBlock>No banks connected yet</EmptyBlock>
      ) : (
        <div className="card overflow-hidden">
          {connections.items.map((item, index) => (
            <SettingsRow
              key={item.id}
              isLast={index === connections.items.length - 1}
              action={(
                <button
                  onClick={() => { void connections.disconnect(item); }}
                  disabled={connections.disconnectingId === item.id}
                  className="shrink-0 min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
                  style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}
                >
                  {connections.disconnectingId === item.id ? '…' : 'Disconnect'}
                </button>
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar label={item.institution_name || 'B'} tone="positive" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text truncate">
                    {item.institution_name || 'Bank'}
                  </p>
                  <p className="text-xs text-muted">
                    Connected {new Date(item.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </SettingsRow>
          ))}
        </div>
      )}

      {/* Kept in place, not hidden: 6C owns the Danger Zone treatment. It is
          separated and labelled so it no longer sits in the same row as the
          everyday actions. */}
      <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
        <p className="label mb-2">Troubleshooting</p>
        <p className="text-xs text-muted mb-3 max-w-prose">
          Start over if syncing is broken beyond repair. This is irreversible.
        </p>
        <button
          onClick={() => { void connections.reset(); }}
          disabled={connections.resetting}
          className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
          style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.08)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}
        >
          {connections.resetting ? 'Clearing…' : 'Reset & Start Fresh'}
        </button>
      </div>
    </section>
  );
};

export default ConnectionsSection;
