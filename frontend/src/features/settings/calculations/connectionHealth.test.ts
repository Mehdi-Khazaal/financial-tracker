import type { PlaidHealthRow } from '../types';
import {
  DELIVERY_DELAY_MINUTES,
  assessConnection,
  isDeliveryDelayed,
  lastSyncSummary,
  relativeTime,
} from './connectionHealth';

/**
 * The rules that turn Plaid diagnostics into something a person can act on.
 *
 * Two properties matter more than any individual state, and both are asserted
 * repeatedly below:
 *
 *   • **Silence is not failure.** These columns were added long after the
 *     connections they describe, so a null means "not recorded", never "never
 *     happened". No null may push a connection toward an alarming state.
 *   • **Quiet is not broken.** A dormant account and a dead one look identical
 *     in transaction counts, which is why counts are not consulted at all.
 */

const NOW = Date.parse('2026-08-20T18:00:00Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

const row = (over: Partial<PlaidHealthRow> = {}): PlaidHealthRow => ({
  id: 1,
  institution_name: 'Capital One',
  connected_at: '2026-05-31T00:00:00Z',
  cursor_initialized: true,
  fintrack_last_webhook_at: minutesAgo(10),
  fintrack_last_webhook_code: 'SYNC_UPDATES_AVAILABLE',
  last_sync_at: minutesAgo(9),
  last_sync_source: 'webhook',
  last_sync_ok: true,
  last_sync_error: null,
  last_added_count: 3,
  last_modified_count: 0,
  last_removed_count: 0,
  reachable: true,
  item_error_code: null,
  item_error_type: null,
  login_repair_required: false,
  consent_expiration_time: null,
  plaid_last_successful_update: minutesAgo(11),
  plaid_last_failed_update: null,
  plaid_last_webhook_sent_at: minutesAgo(10),
  plaid_last_webhook_code: 'SYNC_UPDATES_AVAILABLE',
  ...over,
});

describe('assessConnection', () => {
  it('reports a working connection as healthy', () => {
    const result = assessConnection(row(), NOW);
    expect(result.status).toBe('healthy');
    expect(result.actionable).toBe(false);
  });

  it('puts re-authentication above everything else', () => {
    // Deliberately also unreachable and sync-failing: an Item needing a login
    // is the only thing the user can fix, and the other two are usually
    // consequences of it rather than separate problems.
    const result = assessConnection(
      row({ login_repair_required: true, reachable: false, last_sync_ok: false }),
      NOW,
    );
    expect(result.status).toBe('needs-attention');
    expect(result.actionable).toBe(true);
    expect(result.detail).toMatch(/sign in again/i);
  });

  it('treats ITEM_LOGIN_REQUIRED as needing attention even without the flag', () => {
    const result = assessConnection(
      row({ login_repair_required: false, item_error_code: 'ITEM_LOGIN_REQUIRED' }),
      NOW,
    );
    expect(result.status).toBe('needs-attention');
  });

  it('reports an unreadable item as unavailable, not broken', () => {
    const result = assessConnection(row({ reachable: false }), NOW);
    expect(result.status).toBe('unavailable');
    expect(result.actionable).toBe(false);
    expect(result.detail).toMatch(/temporary/i);
  });

  it('flags any other bank-reported error as needing attention', () => {
    const result = assessConnection(row({ item_error_code: 'INSTITUTION_DOWN' }), NOW);
    expect(result.status).toBe('needs-attention');
    expect(result.actionable).toBe(true);
  });

  it('reports a failed sync as a sync issue, and says it retries', () => {
    const result = assessConnection(row({ last_sync_ok: false }), NOW);
    expect(result.status).toBe('sync-issue');
    expect(result.actionable).toBe(false);
    expect(result.detail).toMatch(/try again automatically/i);
  });

  it('reports a brand new connection as not synced yet', () => {
    const result = assessConnection(
      row({ cursor_initialized: false, last_sync_at: null, last_sync_ok: null }),
      NOW,
    );
    expect(result.status).toBe('not-synced-yet');
  });

  it('reports unknown when there is no health row at all', () => {
    const result = assessConnection(undefined, NOW);
    expect(result.status).toBe('unknown');
    expect(result.actionable).toBe(false);
  });

  // --- Silence is not failure ------------------------------------------------

  it('does not call a legacy connection unhealthy for having no sync record', () => {
    // Connected long before the health columns existed: cursor is established,
    // so it has plainly been working, but nothing was ever recorded about it.
    const result = assessConnection(
      row({
        cursor_initialized: true,
        last_sync_at: null,
        last_sync_ok: null,
        last_sync_source: null,
        fintrack_last_webhook_at: null,
        fintrack_last_webhook_code: null,
        last_added_count: null,
        last_modified_count: null,
        last_removed_count: null,
      }),
      NOW,
    );
    expect(result.status).toBe('healthy');
    expect(result.actionable).toBe(false);
  });

  it('does not treat a quiet account as a broken one', () => {
    const result = assessConnection(
      row({ last_added_count: 0, last_modified_count: 0, last_removed_count: 0 }),
      NOW,
    );
    expect(result.status).toBe('healthy');
  });

  it('never invents a syncing state', () => {
    // The backend exposes no in-flight marker, so this must not be derivable.
    const statuses = [
      assessConnection(row(), NOW).status,
      assessConnection(row({ last_sync_ok: null }), NOW).status,
      assessConnection(undefined, NOW).status,
    ];
    expect(statuses).not.toContain('syncing');
  });
});

describe('isDeliveryDelayed', () => {
  it('is false when Fintrack recorded receiving the update', () => {
    expect(isDeliveryDelayed(row(), NOW)).toBe(false);
  });

  it('is false for a recent send that simply has not arrived yet', () => {
    // Well inside the threshold — retries and cold starts make this ordinary.
    expect(isDeliveryDelayed(
      row({ plaid_last_webhook_sent_at: minutesAgo(5), fintrack_last_webhook_at: null, last_sync_at: null }),
      NOW,
    )).toBe(false);
  });

  it('is true when a send is well past the threshold and nothing arrived', () => {
    expect(isDeliveryDelayed(
      row({
        plaid_last_webhook_sent_at: minutesAgo(DELIVERY_DELAY_MINUTES + 30),
        fintrack_last_webhook_at: null,
        last_sync_at: null,
      }),
      NOW,
    )).toBe(true);
  });

  it('is false when a sync ran after the send, because the data arrived anyway', () => {
    // The webhook was missed, but Sync Now collected the same transactions —
    // so nothing is actually delayed and saying so would be a false alarm.
    expect(isDeliveryDelayed(
      row({
        plaid_last_webhook_sent_at: minutesAgo(120),
        fintrack_last_webhook_at: null,
        last_sync_at: minutesAgo(5),
      }),
      NOW,
    )).toBe(false);
  });

  it('is false when the receipt is newer than the send', () => {
    expect(isDeliveryDelayed(
      row({
        plaid_last_webhook_sent_at: minutesAgo(120),
        fintrack_last_webhook_at: minutesAgo(119),
        last_sync_at: null,
      }),
      NOW,
    )).toBe(false);
  });

  it('ignores a send older than a day', () => {
    expect(isDeliveryDelayed(
      row({
        plaid_last_webhook_sent_at: minutesAgo(60 * 30),
        fintrack_last_webhook_at: null,
        last_sync_at: null,
      }),
      NOW,
    )).toBe(false);
  });

  it('is false when Plaid reports no send at all', () => {
    expect(isDeliveryDelayed(
      row({ plaid_last_webhook_sent_at: null, fintrack_last_webhook_at: null }),
      NOW,
    )).toBe(false);
  });

  it('never turns a delay into a status of its own', () => {
    const result = assessConnection(
      row({
        plaid_last_webhook_sent_at: minutesAgo(DELIVERY_DELAY_MINUTES + 30),
        fintrack_last_webhook_at: null,
        last_sync_at: null,
      }),
      NOW,
    );
    expect(result.deliveryDelayed).toBe(true);
    expect(result.status).toBe('healthy');
  });
});

describe('relativeTime', () => {
  it('returns null for a missing value, so callers can say "not recorded"', () => {
    expect(relativeTime(null)).toBeNull();
    expect(relativeTime(undefined)).toBeNull();
    expect(relativeTime('')).toBeNull();
  });

  it('returns null rather than a wrong answer for an unparseable value', () => {
    expect(relativeTime('not-a-date')).toBeNull();
  });

  it.each([
    [30 / 60, 'just now'],
    [8, '8 minutes ago'],
    [1, '1 minute ago'],
    [90, '2 hours ago'],
    [60 * 24, 'yesterday'],
    [60 * 24 * 3, '3 days ago'],
  ])('renders %p minutes ago as %p', (mins, expected) => {
    expect(relativeTime(minutesAgo(mins as number), NOW)).toBe(expected);
  });

  it('does not report a future timestamp as negative', () => {
    expect(relativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });
});

describe('lastSyncSummary', () => {
  it('says when it last synced', () => {
    expect(lastSyncSummary(row({ last_sync_at: minutesAgo(8) }), NOW))
      .toBe('Last synced 8 minutes ago');
  });

  it('says so when the last attempt failed', () => {
    expect(lastSyncSummary(row({ last_sync_at: minutesAgo(8), last_sync_ok: false }), NOW))
      .toBe('Last sync failed 8 minutes ago');
  });

  it('says "not recorded yet" rather than "never"', () => {
    // "Never synced" would be an accusation the data cannot support: these
    // columns postdate the connections they describe.
    expect(lastSyncSummary(row({ last_sync_at: null }), NOW))
      .toBe('Last sync not recorded yet');
    expect(lastSyncSummary(undefined, NOW)).toBe('Last sync not recorded yet');
  });
});
