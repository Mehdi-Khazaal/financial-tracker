import type { PlaidSyncStatusRow } from '../types';

/**
 * Deciding when a manual sync has actually finished.
 *
 * `POST /plaid/sync` queues background work and returns before any Plaid call
 * happens, so its 200 means "requested" and nothing more. Treating it as
 * completion is the bug this module exists to prevent: the old button cleared
 * its spinner within milliseconds and read as "done" while the sync had not
 * started.
 *
 * Completion is therefore inferred from evidence rather than from the
 * response. Before requesting, we record each connected Item's `last_sync_at`
 * as a baseline; a sync has run for an Item once that timestamp *advances*.
 * The evidence comes from `/plaid/sync-status`, which reads local columns and
 * makes no Plaid call, so polling it is cheap.
 *
 * The subtlety that shapes everything here: `record_sync_health` deliberately
 * swallows its own failures, because observability must never be able to break
 * the sync it observes. So a real, successful sync can complete while
 * `last_sync_at` never moves. **Absence of evidence is not evidence of
 * failure**, which is why running out of time is its own outcome and is never
 * reported as an error.
 */

export type SyncPhase =
  | 'idle'
  | 'requesting'
  | 'waiting'
  | 'completed'
  | 'partial_failure'
  | 'timed_out'
  | 'request_failed';

/** One Item's `last_sync_at` at the moment the sync was requested. */
export type SyncBaseline = Map<number, string | null>;

export interface SyncOutcome {
  /** Items that reported a newer `last_sync_at` than their baseline. */
  advanced: PlaidSyncStatusRow[];
  /** Of those, the ones that reported failure. */
  failed: PlaidSyncStatusRow[];
  /** Expected ids with no fresh evidence yet. */
  pending: number[];
  /** Expected ids no longer present at all — disconnected mid-flight. */
  vanished: number[];
  /** True once every expected Item has either reported or vanished. */
  settled: boolean;
}

const time = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Whether this row's sync timestamp is newer than the baseline taken for it.
 *
 * A baseline of null — an Item that had never recorded a sync, or predates the
 * column — is satisfied by any timestamp at all. Equal timestamps do *not*
 * count: the row has to move, or a sync that never ran would look finished.
 */
export function hasAdvanced(row: PlaidSyncStatusRow, baseline: string | null | undefined): boolean {
  const now = time(row.last_sync_at);
  if (now == null) return false;
  const before = time(baseline ?? null);
  return before == null ? true : now > before;
}

/**
 * Compare a poll result against the baseline.
 *
 * Only Items present when the sync was requested are part of its completion
 * contract. A bank connected *during* the poll is not something this sync was
 * ever going to touch, so waiting for it would hang forever; a bank
 * disconnected during the poll can never report, so it is counted as vanished
 * rather than pending.
 */
export function evaluateSync(
  baseline: SyncBaseline,
  rows: PlaidSyncStatusRow[],
): SyncOutcome {
  const byId = new Map(rows.map(row => [row.id, row]));
  const advanced: PlaidSyncStatusRow[] = [];
  const failed: PlaidSyncStatusRow[] = [];
  const pending: number[] = [];
  const vanished: number[] = [];

  baseline.forEach((before, id) => {
    const row = byId.get(id);
    if (!row) {
      vanished.push(id);
      return;
    }
    if (hasAdvanced(row, before)) {
      advanced.push(row);
      if (row.last_sync_ok === false) failed.push(row);
    } else {
      pending.push(id);
    }
  });

  return { advanced, failed, pending, vanished, settled: pending.length === 0 };
}

/** The phase a settled outcome lands in. Only ever called once settled. */
export function phaseFor(outcome: SyncOutcome): SyncPhase {
  return outcome.failed.length > 0 ? 'partial_failure' : 'completed';
}

export interface SyncTotals {
  added: number;
  modified: number;
  removed: number;
}

/**
 * What the completed Items actually imported.
 *
 * Modified and removed are counted separately and never folded into "new".
 * A revised transaction is not a new one, and saying otherwise would inflate
 * the only number the user is likely to check.
 */
export function totalsFor(rows: PlaidSyncStatusRow[]): SyncTotals {
  return rows.reduce<SyncTotals>(
    (totals, row) => ({
      added: totals.added + (row.last_added_count ?? 0),
      modified: totals.modified + (row.last_modified_count ?? 0),
      removed: totals.removed + (row.last_removed_count ?? 0),
    }),
    { added: 0, modified: 0, removed: 0 },
  );
}

/**
 * The one-line result.
 *
 * "no new posted transactions" rather than "nothing new": a pending card
 * purchase is legitimately absent from an up-to-date sync, and the wording
 * should not imply that everything visible in the banking app is now here.
 */
export function summarise(outcome: SyncOutcome): string {
  const totals = totalsFor(outcome.advanced);

  if (outcome.failed.length > 0) {
    const names = outcome.failed
      .map(row => row.institution_name || 'a bank')
      .join(', ');
    return `Sync finished with an issue on ${names}.`;
  }

  if (totals.added === 0 && totals.modified === 0) {
    return 'Sync complete · no new posted transactions';
  }

  const parts: string[] = [];
  if (totals.added > 0) parts.push(`${totals.added} new`);
  if (totals.modified > 0) parts.push(`${totals.modified} updated`);
  return `Sync complete · ${parts.join(' · ')}`;
}

/** Per-institution detail, for the connections that actually reported. */
export function perItemSummary(outcome: SyncOutcome): { name: string; detail: string }[] {
  return outcome.advanced.map(row => {
    const name = row.institution_name || 'Bank';
    if (row.last_sync_ok === false) return { name, detail: 'could not finish' };
    const parts: string[] = [];
    if ((row.last_added_count ?? 0) > 0) parts.push(`${row.last_added_count} new`);
    if ((row.last_modified_count ?? 0) > 0) parts.push(`${row.last_modified_count} updated`);
    return { name, detail: parts.length > 0 ? parts.join(' · ') : 'nothing new' };
  });
}
