import React, { useEffect, useRef } from 'react';
import type { UsePlaidConnections } from '../hooks/usePlaidConnections';
import { useConnectionHealth } from '../hooks/useConnectionHealth';
import { useManualSync, type UseManualSync } from '../hooks/useManualSync';
import ConnectionCard from '../components/ConnectionCard';
import { isRepairable } from '../calculations/connectionHealth';
import { REBUILD_CONFIRMATION } from '../hooks/usePlaidConnections';
import { useToast } from '../../../context/ToastContext';
import {
  EmptyBlock,
  LoadingBlock,
  SectionErrorBlock,
  SectionHeading,
} from '../components/SettingsPrimitives';

/**
 * Connected banks, and whether they are actually working.
 *
 * The section previously listed institution names and a connect date, which
 * answered none of the questions someone arrives here with — the diagnostics
 * existed at `/plaid/sync-health` and nothing consumed them.
 *
 * Two loads, deliberately separate and unequal:
 *
 *   • `/plaid/items` is a plain database read and owns the list. It decides
 *     which banks exist.
 *   • `/plaid/sync-health` makes one live Plaid `/item/get` per Item, serially,
 *     so it is fetched only when this section mounts — never on a Settings
 *     page load. It *decorates* the list and can never remove from it: if it
 *     fails entirely, every bank still renders with an unknown status.
 *
 * Sync Now reports what actually happened rather than what was requested. The
 * POST returns before Plaid is contacted, so completion is established by
 * watching `/plaid/sync-status` — local columns, no Plaid call — until each
 * connection's `last_sync_at` advances past a baseline taken beforehand. See
 * `useManualSync`.
 *
 * Disconnect removes the connection at Plaid before removing it here, so a
 * failure leaves the card in place rather than reporting a success that did
 * not happen. Only a card whose Disconnect has actually failed is then offered
 * the local-only escape hatch — see `usePlaidConnections`.
 *
 * The actions are laid out as a recovery ladder, least destructive first, and
 * deliberately not visually equal: automatic sync, then Sync all now, then
 * Reconnect on the card that needs it, then Rebuild bank history under
 * Troubleshooting, then Disconnect, and only then Reset in a Danger Zone of
 * its own. Someone should almost never reach the bottom rung, and the two
 * rungs people confuse — Rebuild and Reset — are separated by a divider and
 * described in terms of what each one keeps.
 */

interface Props {
  connections: UsePlaidConnections;
}

const BUTTON_LABEL: Record<string, string> = {
  idle: 'Sync all now',
  requesting: 'Requesting sync…',
  waiting: 'Checking for updates…',
  completed: 'Sync all now',
  partial_failure: 'Sync all now',
  timed_out: 'Sync all now',
  request_failed: 'Sync all now',
};

/**
 * The outcome line for a long-running operation, shared by Sync and Rebuild.
 *
 * Announced politely so a screen reader hears the result without the whole
 * section being re-read. Timing out is reported as still-running rather than
 * failed: `record_sync_health` swallows its own write errors, so a real sync
 * can finish without the timestamp ever moving.
 */
const ProgressBanner: React.FC<{ state: UseManualSync; onCheckStatus: () => void }> = ({
  state, onCheckStatus,
}) => {
  if (!state.message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="card p-3 mb-3 mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <p
          className="text-xs font-medium"
          style={{
            color: state.phase === 'request_failed' || state.phase === 'partial_failure'
              ? 'var(--neg)'
              : state.phase === 'timed_out' ? 'var(--muted)' : 'var(--pos)',
          }}
        >
          {state.message}
        </p>
        {state.perItem.length > 1 && (
          <ul className="mt-1 space-y-0.5">
            {state.perItem.map(entry => (
              <li key={entry.name} className="text-[11px]" style={{ color: 'var(--dim)' }}>
                {entry.name} · {entry.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        {state.phase === 'timed_out' && (
          <button
            type="button"
            onClick={onCheckStatus}
            className="min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg"
            style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--fg)', border: '1px solid var(--line)' }}
          >
            Check status
          </button>
        )}
        <button
          type="button"
          onClick={state.dismiss}
          className="min-h-[44px] px-2 py-1.5 text-xs font-semibold rounded-lg"
          style={{ color: 'var(--dim)' }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};

const ConnectionsSection: React.FC<Props> = ({ connections }) => {
  const toast = useToast();
  const health = useConnectionHealth();
  // Health is refreshed exactly once, when the sync actually settles — not on
  // a timer, and never as part of the poll: `/plaid/sync-health` costs a live
  // Plaid call per Item.
  const sync = useManualSync(health.reload);
  // The same machine, told which operation it is running. A rebuild records
  // its runs as manual syncs, so `/plaid/sync-status` reports one exactly as
  // it reports a sync; a second polling implementation would only be a second
  // place to mistake a queued request for a finished job.
  const rebuild = useManualSync(health.reload, { kind: 'rebuild' });
  const hasItems = connections.items.length > 0;

  /**
   * One long job at a time, across both machines.
   *
   * `useManualSync` already refuses to start twice, but each instance only
   * knows about itself — and both establish completion from the *same*
   * evidence, each connection's `last_sync_at`. Two running together would
   * each settle on whichever advance landed first and report the other's work
   * as their own: a rebuild finishing could be announced as "Sync complete",
   * or a sync's timestamp could end a rebuild that had barely started. The
   * guard belongs here because this is the only place that can see both.
   */
  const busy = sync.busy || rebuild.busy;

  const startRebuild = async () => {
    const confirmed = await toast.confirm(REBUILD_CONFIRMATION, {
      title: 'Rebuild bank history?',
    });
    if (!confirmed) return;
    await rebuild.start();
  };

  // After a successful repair, re-read health and run an ordinary sync — the
  // same honest one Sync Now uses, rather than a second "repair sync" with its
  // own idea of completion. Plaid clears the Item error itself and backfills
  // the missed window on its next webhook, so nothing here needs to chase it.
  //
  // The hooks are held in refs because their identities change every render;
  // depending on them directly would re-run this on each one.
  const healthRef = useRef(health);
  healthRef.current = health;
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const handledRepairRef = useRef<number | null>(null);

  useEffect(() => {
    const completedAt = connections.repairCompletedAt;
    if (completedAt == null || handledRepairRef.current === completedAt) return;
    handledRepairRef.current = completedAt;
    healthRef.current.reload();
    void syncRef.current.start();
  }, [connections.repairCompletedAt]);

  // A completed Reset removed every connection, so the diagnostics held for
  // them describe things that no longer exist. Nothing renders them once the
  // list is empty, but leaving them in memory means the next bank connected in
  // this same session could be joined against a stale map. Re-reading costs
  // nothing here: with no Items, `/plaid/sync-health` makes no Plaid call at
  // all. Keyed on the phase, so it fires once on the transition.
  useEffect(() => {
    if (connections.resetPhase !== 'completed') return;
    healthRef.current.reload();
  }, [connections.resetPhase]);

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

      <div className="flex gap-2 flex-wrap mb-2">
        {hasItems && (
          <button
            onClick={() => { void sync.start(); }}
            disabled={busy}
            aria-busy={sync.busy}
            className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
            style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.1)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.2)' }}
          >
            {BUTTON_LABEL[sync.phase] ?? 'Sync all now'}
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

      <ProgressBanner state={sync} onCheckStatus={health.reload} />

      {/* Sets the expectation that syncing is automatic, and heads off the two
          questions this section otherwise generates: "do I have to press this
          every day" and "why is this morning's coffee missing". Neither is an
          error, so neither is styled as one — and Sync Now is deliberately not
          offered as a way to make a pending charge post, because it cannot. */}
      {hasItems && (
        <p className="text-xs mb-4 leading-relaxed max-w-prose" style={{ color: 'var(--dim)' }}>
          Fintrack checks for bank updates automatically in the background — use
          Sync Now if something looks out of date. Some card purchases will not
          appear until they finish pending at your bank.
        </p>
      )}

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
        <>
          {/* Degraded, not broken: the banks below are real and complete, only
              their status is missing. Said plainly so an unknown badge is not
              mistaken for a diagnosis. */}
          {health.status === 'error' && (
            <div
              className="card p-3 mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              role="status"
            >
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Connection status could not be checked. Your banks are still connected.
              </p>
              <button
                type="button"
                onClick={health.reload}
                className="shrink-0 min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg"
                style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--fg)', border: '1px solid var(--line)' }}
              >
                Check again
              </button>
            </div>
          )}

          <ul className="card overflow-hidden">
            {connections.items.map(item => (
              <ConnectionCard
                key={item.id}
                item={item}
                // Joined on Fintrack's own id. Never on institution name: it is
                // nullable and falls back to "Bank" when Plaid's lookup fails,
                // so two connections can share it.
                health={health.byItemId.get(item.id)}
                healthLoading={health.status === 'loading'}
                disconnecting={connections.disconnectingId === item.id}
                onDisconnect={() => { void connections.disconnect(item); }}
                // Appears only after this connection's Disconnect has failed
                // against Plaid, so the path that cannot confirm anything is
                // never the first one offered.
                onRemoveAnyway={connections.unremovableIds.includes(item.id)
                  ? () => { void connections.removeLocally(item); }
                  : undefined}
                removing={connections.forceRemovingId === item.id}
                // Offered only when Plaid says a sign-in will fix it. A healthy
                // bank gets no Reconnect, and neither does one that is merely
                // unreachable or slow.
                onReconnect={isRepairable(health.byItemId.get(item.id))
                  ? () => connections.startRepair(item)
                  : undefined}
                reconnecting={connections.repairingId === item.id}
              />
            ))}
          </ul>
        </>
      )}

      {/* Troubleshooting: the safe half of recovery. Shown only when there is
          a connection to act on — offering to rebuild history from no banks
          is a button that can only disappoint. */}
      {hasItems && (
        <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
          <p className="label mb-2">Troubleshooting</p>
          <p className="text-xs text-muted mb-3 max-w-prose">
            If transactions are still missing after a sync, rebuild your history.
            Fintrack asks your banks for their transaction history again; anything you
            already have is matched rather than duplicated, the categories you filed are
            kept, and nothing is deleted.
          </p>
          <button
            onClick={() => { void startRebuild(); }}
            disabled={busy}
            aria-busy={rebuild.busy}
            className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
            style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--fg)', border: '1px solid var(--line)' }}
          >
            {rebuild.busy ? 'Rebuilding…' : 'Rebuild bank history'}
          </button>

          <ProgressBanner state={rebuild} onCheckStatus={health.reload} />
        </div>
      )}

      {/* Danger Zone: restrained, but genuinely separated. The distinction
          from Rebuild above is stated in terms of what each one keeps, which
          is the only difference a person actually needs. */}
      {hasItems && (
        <div
          className="mt-6 pt-4"
          style={{ borderTop: '1px solid oklch(70% 0.17 25 / 0.25)' }}
          role="group"
          aria-labelledby="settings-danger-zone"
        >
          <p className="label mb-2" id="settings-danger-zone" style={{ color: 'var(--neg)' }}>
            Danger Zone
          </p>
          <p className="text-xs text-muted mb-3 max-w-prose">
            Reset deletes every transaction imported from your banks and disconnects them
            all. Unlike rebuilding, it does not keep your imported history or the
            categories you filed against it. Transactions you added yourself are not
            affected.
          </p>

          {/* Not a toast. A stopped Reset deleted nothing, and that sentence
              has to still be there when the user looks back at the screen. */}
          {connections.resetPhase === 'failed' && connections.resetError && (
            <div className="card p-3 mb-3" role="alert">
              <p className="text-xs font-medium" style={{ color: 'var(--neg)' }}>
                {connections.resetError}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
                If a bank cannot be disconnected at all, use Remove from Fintrack anyway on
                that connection above, then try again.
              </p>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => { void connections.reset(); }}
                  disabled={connections.resetting}
                  className="min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg"
                  style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--fg)', border: '1px solid var(--line)' }}
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={connections.dismissReset}
                  className="min-h-[44px] px-2 py-1.5 text-xs font-semibold rounded-lg"
                  style={{ color: 'var(--dim)' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => { void connections.reset(); }}
            disabled={connections.resetting}
            aria-busy={connections.resetting}
            className="min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
            style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.08)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}
          >
            {connections.resetting ? 'Clearing…' : 'Reset & Start Fresh'}
          </button>
        </div>
      )}
    </section>
  );
};

export default ConnectionsSection;
