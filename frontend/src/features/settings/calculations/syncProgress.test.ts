import type { PlaidSyncStatusRow } from '../types';
import {
  evaluateSync,
  hasAdvanced,
  perItemSummary,
  phaseFor,
  summarise,
  totalsFor,
} from './syncProgress';

/**
 * When a manual sync counts as finished.
 *
 * `POST /plaid/sync` returns before Plaid is contacted, so completion has to be
 * inferred from `last_sync_at` advancing past a baseline. The properties that
 * matter most:
 *
 *   • an unmoved timestamp is *not* completion, or a sync that never ran would
 *     look finished;
 *   • one bank finishing does not finish the sync;
 *   • a failure on one bank does not erase what the others imported.
 */

const at = (iso: string) => Date.parse(iso).toString() && iso;

const row = (over: Partial<PlaidSyncStatusRow> = {}): PlaidSyncStatusRow => ({
  id: 1,
  institution_name: 'Capital One',
  last_sync_at: at('2026-08-20T18:05:00Z'),
  last_sync_ok: true,
  last_sync_error: null,
  last_sync_source: 'manual',
  last_added_count: 2,
  last_modified_count: 0,
  last_removed_count: 0,
  ...over,
});

describe('hasAdvanced', () => {
  it('is true when the timestamp moved forward', () => {
    expect(hasAdvanced(row(), '2026-08-20T18:00:00Z')).toBe(true);
  });

  it('is false when the timestamp is unchanged', () => {
    // The load-bearing case: an unmoved timestamp means no sync has been
    // recorded, and treating it as done would fake completion instantly.
    expect(hasAdvanced(row(), '2026-08-20T18:05:00Z')).toBe(false);
  });

  it('is false when the timestamp is older than the baseline', () => {
    expect(hasAdvanced(row(), '2026-08-20T19:00:00Z')).toBe(false);
  });

  it('accepts any timestamp when there was no baseline to beat', () => {
    // A connection that had never recorded a sync, or predates the column.
    expect(hasAdvanced(row(), null)).toBe(true);
  });

  it('is false when the row still has no timestamp at all', () => {
    expect(hasAdvanced(row({ last_sync_at: null }), null)).toBe(false);
  });
});

describe('evaluateSync', () => {
  const baseline = new Map<number, string | null>([
    [1, '2026-08-20T18:00:00Z'],
    [2, '2026-08-20T18:00:00Z'],
  ]);

  it('is not settled while one bank has not reported', () => {
    const outcome = evaluateSync(baseline, [
      row({ id: 1 }),
      row({ id: 2, last_sync_at: '2026-08-20T18:00:00Z' }),
    ]);
    expect(outcome.settled).toBe(false);
    expect(outcome.pending).toEqual([2]);
    expect(outcome.advanced.map(r => r.id)).toEqual([1]);
  });

  it('settles once every bank has reported', () => {
    const outcome = evaluateSync(baseline, [row({ id: 1 }), row({ id: 2 })]);
    expect(outcome.settled).toBe(true);
    expect(phaseFor(outcome)).toBe('completed');
  });

  it('reports a partial failure without discarding the successes', () => {
    const outcome = evaluateSync(baseline, [
      row({ id: 1, last_added_count: 3 }),
      row({ id: 2, institution_name: 'PNC', last_sync_ok: false, last_sync_error: 'boom' }),
    ]);
    expect(outcome.settled).toBe(true);
    expect(phaseFor(outcome)).toBe('partial_failure');
    expect(outcome.advanced).toHaveLength(2);
    expect(outcome.failed.map(r => r.institution_name)).toEqual(['PNC']);
  });

  it('treats a bank that disappeared mid-sync as vanished, not pending', () => {
    // Disconnected while polling: it can never report, so waiting for it would
    // hang until the timeout for no reason.
    const outcome = evaluateSync(baseline, [row({ id: 1 })]);
    expect(outcome.vanished).toEqual([2]);
    expect(outcome.settled).toBe(true);
  });

  it('ignores a bank connected after the sync was requested', () => {
    // It was never part of this sync's contract, so its absence of movement
    // must not hold the outcome open.
    const outcome = evaluateSync(baseline, [row({ id: 1 }), row({ id: 2 }), row({ id: 99 })]);
    expect(outcome.settled).toBe(true);
    expect(outcome.advanced.map(r => r.id).sort()).toEqual([1, 2]);
  });

  it('settles immediately when nothing was expected', () => {
    expect(evaluateSync(new Map(), []).settled).toBe(true);
  });
});

describe('totalsFor', () => {
  it('adds counts across banks', () => {
    expect(totalsFor([
      row({ id: 1, last_added_count: 2, last_modified_count: 1 }),
      row({ id: 2, last_added_count: 1, last_modified_count: 0, last_removed_count: 3 }),
    ])).toEqual({ added: 3, modified: 1, removed: 3 });
  });

  it('treats null counts as zero rather than NaN', () => {
    expect(totalsFor([row({ last_added_count: null, last_modified_count: null, last_removed_count: null })]))
      .toEqual({ added: 0, modified: 0, removed: 0 });
  });
});

describe('summarise', () => {
  const baseline = new Map<number, string | null>([[1, '2026-08-20T18:00:00Z']]);

  it('reports what actually arrived', () => {
    expect(summarise(evaluateSync(baseline, [row({ last_added_count: 3 })])))
      .toBe('Sync complete · 3 new');
  });

  it('counts modifications separately from new transactions', () => {
    // A revised transaction is not a new one, and folding them together would
    // inflate the only number most people check.
    expect(summarise(evaluateSync(baseline, [row({ last_added_count: 2, last_modified_count: 1 })])))
      .toBe('Sync complete · 2 new · 1 updated');
  });

  it('says "no new posted transactions", not "nothing new"', () => {
    // A pending card purchase is legitimately absent from an up-to-date sync,
    // so the wording must not imply the banking app and Fintrack now match.
    expect(summarise(evaluateSync(baseline, [row({ last_added_count: 0, last_modified_count: 0 })])))
      .toBe('Sync complete · no new posted transactions');
  });

  it('names the bank that had trouble', () => {
    const outcome = evaluateSync(
      new Map([[1, null], [2, null]]),
      [row({ id: 1 }), row({ id: 2, institution_name: 'PNC', last_sync_ok: false })],
    );
    expect(summarise(outcome)).toBe('Sync finished with an issue on PNC.');
  });

  it('does not claim a count it cannot support', () => {
    expect(summarise(evaluateSync(baseline, [row({ last_added_count: null, last_modified_count: null })])))
      .toBe('Sync complete · no new posted transactions');
  });
});

describe('perItemSummary', () => {
  it('describes each bank that reported', () => {
    const outcome = evaluateSync(
      new Map([[1, null], [2, null]]),
      [
        row({ id: 1, last_added_count: 2, last_modified_count: 1 }),
        row({ id: 2, institution_name: 'PNC', last_added_count: 1, last_modified_count: 0 }),
      ],
    );
    expect(perItemSummary(outcome)).toEqual([
      { name: 'Capital One', detail: '2 new · 1 updated' },
      { name: 'PNC', detail: '1 new' },
    ]);
  });

  it('says so plainly when a bank had nothing to add', () => {
    const outcome = evaluateSync(new Map([[1, null]]), [row({ last_added_count: 0, last_modified_count: 0 })]);
    expect(perItemSummary(outcome)).toEqual([{ name: 'Capital One', detail: 'nothing new' }]);
  });

  it('marks the one that failed without hiding the others', () => {
    const outcome = evaluateSync(
      new Map([[1, null], [2, null]]),
      [row({ id: 1, last_added_count: 4 }), row({ id: 2, institution_name: 'PNC', last_sync_ok: false })],
    );
    expect(perItemSummary(outcome)).toEqual([
      { name: 'Capital One', detail: '4 new' },
      { name: 'PNC', detail: 'could not finish' },
    ]);
  });

  it('falls back to a name when the institution is unknown', () => {
    const outcome = evaluateSync(new Map([[1, null]]), [row({ institution_name: null })]);
    expect(perItemSummary(outcome)[0].name).toBe('Bank');
  });
});
