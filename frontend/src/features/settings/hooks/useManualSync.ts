import { useCallback, useEffect, useRef, useState } from 'react';
import { plaidRebuildHistory, plaidSyncAll, plaidSyncStatus } from '../../../utils/api';
import type { PlaidSyncStatusRow } from '../types';
import {
  evaluateSync,
  perItemSummary,
  phaseFor,
  summarise,
  type SyncBaseline,
  type SyncKind,
  type SyncOutcome,
  type SyncPhase,
} from '../calculations/syncProgress';

/**
 * Sync Now, reported honestly.
 *
 * `POST /plaid/sync` queues background work and returns before Plaid is
 * contacted, so its 200 means "requested". The previous button cleared its
 * spinner on that response and read as finished within milliseconds — the sync
 * had not begun.
 *
 * Completion is instead established by evidence: take each connected Item's
 * `last_sync_at` as a baseline, request the sync, then watch
 * `/plaid/sync-status` — which reads local columns and makes **no Plaid call**
 * — until those timestamps advance. `/plaid/sync-health` is deliberately not
 * used for this: it costs one live `/item/get` per Item, so polling it would
 * turn a progress indicator into a rate-limit problem.
 *
 * Running out of time is its own outcome, never an error. `record_sync_health`
 * swallows its own failures by design, so a genuinely successful sync can
 * finish without `last_sync_at` ever moving. Absence of evidence is not
 * evidence of failure.
 */

/** Long enough to be quiet, short enough to feel responsive. */
export const POLL_INTERVAL_MS = 4_000;
/** ~9 polls. Beyond this the honest answer is "still running", not "failed". */
export const POLL_TIMEOUT_MS = 36_000;
/**
 * A rebuild asks every bank for its whole available window rather than the
 * delta since a cursor, so it takes far longer. Same machine, same evidence,
 * same "still running" ending — only the patience differs.
 */
export const REBUILD_TIMEOUT_MS = 180_000;

export interface ManualSyncOptions {
  /**
   * Which operation to run. `rebuild` posts to `/plaid/replay`, which clears
   * every cursor so the next sync re-reads all available history, and waits
   * longer for it.
   *
   * Completion is established the same way for both, and deliberately so:
   * replay records its runs as manual syncs, so `/plaid/sync-status` reports a
   * rebuild exactly as it reports a sync. A second polling implementation
   * would be a second chance to reintroduce the bug this one exists to
   * prevent — treating a queued request as a finished job.
   */
  kind?: SyncKind;
}

export interface UseManualSync {
  phase: SyncPhase;
  /** One-line result, once there is one. */
  message: string | null;
  /** Per-institution detail for a settled sync. */
  perItem: { name: string; detail: string }[];
  /** True whenever a sync is in flight — the button's disabled state. */
  busy: boolean;
  start: () => Promise<void>;
  dismiss: () => void;
}

export function useManualSync(
  onSettled?: () => void,
  { kind = 'sync' }: ManualSyncOptions = {},
): UseManualSync {
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [perItem, setPerItem] = useState<{ name: string; detail: string }[]>([]);

  // Refs, not state: these coordinate an async loop and must never trigger a
  // render or be captured stale by one.
  const activeRef = useRef(false);
  const cancelledRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Stop everything on unmount: a resolved fetch must not call setState on a
  // gone component, and a pending timer must not outlive the section.
  useEffect(() => () => {
    cancelledRef.current = true;
    activeRef.current = false;
    clearTimer();
  }, []);

  const settle = useCallback((outcome: SyncOutcome) => {
    setPhase(phaseFor(outcome));
    setMessage(summarise(outcome, kind));
    setPerItem(perItemSummary(outcome));
    onSettledRef.current?.();
  }, [kind]);

  const readStatus = async (): Promise<PlaidSyncStatusRow[]> => {
    const response = await plaidSyncStatus();
    return Array.isArray(response.data?.items) ? response.data.items : [];
  };

  const start = useCallback(async () => {
    // One sync at a time. A second press while one runs would take a baseline
    // from a half-finished state and report against the wrong evidence.
    if (activeRef.current) return;
    activeRef.current = true;
    cancelledRef.current = false;
    clearTimer();

    setPhase('requesting');
    setMessage(null);
    setPerItem([]);

    let baseline: SyncBaseline = new Map();
    try {
      // Baseline first. A webhook sync landing between this read and the POST
      // only makes the baseline slightly stale, which can at worst end the
      // wait early — never report a failure that did not happen.
      const before = await readStatus();
      baseline = new Map(before.map(row => [row.id, row.last_sync_at]));

      await (kind === 'rebuild' ? plaidRebuildHistory() : plaidSyncAll());
    } catch {
      activeRef.current = false;
      if (!cancelledRef.current) {
        setPhase('request_failed');
        setMessage(
          kind === 'rebuild'
            ? 'Could not start the rebuild. Check your connection and try again.'
            : 'Could not request a sync. Check your connection and try again.',
        );
      }
      return;
    }

    if (cancelledRef.current) { activeRef.current = false; return; }

    // Nothing connected: the POST would have 404'd and been caught above, but
    // an empty baseline would otherwise settle instantly and claim success.
    if (baseline.size === 0) {
      activeRef.current = false;
      setPhase('completed');
      setMessage(
        kind === 'rebuild'
          ? 'Rebuild complete · no connected banks'
          : 'Sync complete · no connected banks',
      );
      return;
    }

    setPhase('waiting');

    const deadline = Date.now() + (kind === 'rebuild' ? REBUILD_TIMEOUT_MS : POLL_TIMEOUT_MS);

    const poll = async () => {
      if (cancelledRef.current) return;
      let rows: PlaidSyncStatusRow[] = [];
      try {
        rows = await readStatus();
      } catch {
        // A single failed poll is not a failed sync; try again until the cap.
        rows = [];
      }
      if (cancelledRef.current) return;

      const outcome = evaluateSync(baseline, rows);
      if (outcome.settled) {
        activeRef.current = false;
        settle(outcome);
        return;
      }

      if (Date.now() >= deadline) {
        activeRef.current = false;
        setPhase('timed_out');
        setMessage(
          kind === 'rebuild'
            ? 'The rebuild is taking longer than expected. Your banks may still be sending history in the background.'
            : 'Sync is taking longer than expected. Your banks may still be updating in the background.',
        );
        setPerItem(perItemSummary(outcome));
        return;
      }

      timerRef.current = window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    };

    timerRef.current = window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
  }, [kind, settle]);

  const dismiss = useCallback(() => {
    setPhase('idle');
    setMessage(null);
    setPerItem([]);
  }, []);

  return {
    phase,
    message,
    perItem,
    busy: phase === 'requesting' || phase === 'waiting',
    start,
    dismiss,
  };
}
