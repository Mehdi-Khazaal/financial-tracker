import type { PlaidHealthRow } from '../types';

/**
 * What a bank connection's diagnostics mean, in the user's terms.
 *
 * `/plaid/sync-health` returns two views merged into one row: Fintrack's own
 * record of what it received and did, and Plaid's `/item/get` view of the Item.
 * Neither is a status a person can act on, so this module is the single place
 * that turns them into one. Kept pure and separate from the JSX so the rules
 * can be read, tested and argued with in one place rather than inferred from
 * scattered conditionals.
 *
 * Two rules shape everything below.
 *
 * **Silence is not failure.** The health columns were added long after these
 * Items were connected, so a null `last_sync_at` frequently means "we did not
 * used to record this", not "this has never worked". Nulls therefore never
 * push a connection toward an alarming state on their own.
 *
 * **No activity is not a broken connection.** A quiet account and a dead one
 * look identical in transaction counts, so counts are not consulted at all.
 */

export type ConnectionStatus =
  | 'healthy'
  | 'needs-attention'
  | 'sync-issue'
  | 'unavailable'
  | 'not-synced-yet'
  | 'unknown';

export interface ConnectionAssessment {
  status: ConnectionStatus;
  /** Short user-facing label. Always paired with text, never colour alone. */
  label: string;
  /** One sentence explaining what the label means and what to do, if anything. */
  detail: string;
  /** True when the user has to act — the only state that warrants prominence. */
  actionable: boolean;
  /**
   * Plaid reports sending an update that Fintrack has no record of receiving.
   * Advisory, never a status of its own: delivery retries and cold starts make
   * a short gap ordinary.
   */
  deliveryDelayed: boolean;
}

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  healthy: 'Healthy',
  'needs-attention': 'Needs attention',
  'sync-issue': 'Sync issue',
  unavailable: 'Status unavailable',
  'not-synced-yet': 'Not synced yet',
  unknown: 'Status unknown',
};

/**
 * How far behind Fintrack's webhook receipt may fall before it is worth
 * mentioning. Generous on purpose: Plaid retries deliveries, and this app
 * sleeps on a free tier, so a cold start alone can account for several
 * minutes. An hour without arrival is no longer ordinary.
 */
export const DELIVERY_DELAY_MINUTES = 60;

const parse = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Whether Plaid says it sent something Fintrack never recorded receiving.
 *
 * Deliberately conservative — three conditions must all hold:
 *
 *   1. Plaid sent an update recently enough to still matter;
 *   2. Fintrack either never recorded a receipt, or recorded one meaningfully
 *      older than that send;
 *   3. no sync has run since the send either — because a manual sync will have
 *      collected the same data, which makes the missed webhook harmless.
 *
 * Condition 3 is what stops this firing at anyone who simply presses Sync Now.
 */
export function isDeliveryDelayed(row: PlaidHealthRow, now: number = Date.now()): boolean {
  const sent = parse(row.plaid_last_webhook_sent_at);
  if (sent == null) return false;

  const ageMinutes = (now - sent) / 60_000;
  // A send in the future, or older than a day, tells us nothing useful.
  if (ageMinutes < DELIVERY_DELAY_MINUTES || ageMinutes > 60 * 24) return false;

  const received = parse(row.fintrack_last_webhook_at);
  const receivedAfterSend = received != null && received >= sent;
  if (receivedAfterSend) return false;

  const synced = parse(row.last_sync_at);
  if (synced != null && synced >= sent) return false;

  return true;
}

/**
 * The connection's state, from the first rule that matches.
 *
 * Order matters: an Item needing re-authentication is the only thing the user
 * can actually fix, so it outranks every other signal — including an
 * unreachable read, which is often a *consequence* of that same error.
 */
export function assessConnection(
  row: PlaidHealthRow | undefined,
  now: number = Date.now(),
): ConnectionAssessment {
  const deliveryDelayed = row ? isDeliveryDelayed(row, now) : false;

  const build = (
    status: ConnectionStatus,
    detail: string,
    actionable = false,
  ): ConnectionAssessment => ({
    status,
    label: STATUS_LABEL[status],
    detail,
    actionable,
    deliveryDelayed,
  });

  // No health row at all: the list came from `/plaid/items` and the diagnostic
  // call has not landed or has failed. Absence of information, not bad news.
  if (!row) {
    return build('unknown', 'Connection status could not be checked right now.');
  }

  if (row.login_repair_required || row.item_error_code === 'ITEM_LOGIN_REQUIRED') {
    return build(
      'needs-attention',
      'Your bank needs you to sign in again before it will share new transactions.',
      true,
    );
  }

  if (row.reachable === false) {
    return build(
      'unavailable',
      'Fintrack could not reach your bank to check this connection. This is usually temporary.',
    );
  }

  if (row.item_error_code) {
    return build(
      'needs-attention',
      'Your bank reported a problem with this connection.',
      true,
    );
  }

  if (row.last_sync_ok === false) {
    return build(
      'sync-issue',
      'The last attempt to import transactions did not finish. Fintrack will try again automatically.',
    );
  }

  // Genuinely new: nothing imported and no cursor established yet. Distinct
  // from a legacy connection whose history simply predates these columns.
  if (!row.cursor_initialized && row.last_sync_at == null) {
    return build('not-synced-yet', 'This connection has not imported anything yet.');
  }

  if (row.reachable === true) {
    return build('healthy', 'This connection is working normally.');
  }

  return build('unknown', 'Connection status could not be checked right now.');
}

/**
 * Whether Link update mode can actually repair this connection.
 *
 * Deliberately narrow: only when Plaid says the Item needs the user to sign in
 * again. Update mode fixes an authentication problem — it does not fix an
 * unreachable API, a failed sync, a delayed webhook, or a quiet account, and
 * offering it for those would send someone through a bank login that changes
 * nothing and teaches them the button is noise.
 *
 * `PENDING_EXPIRATION` is the other case Plaid documents as update-mode
 * repairable. It is deliberately excluded for now: it is a consent-expiry
 * concept that is largely EU/UK, `consent_expiration_time` is null for the US
 * institutions here, and adding a branch that cannot be exercised is worse
 * than adding it when there is something to test it against.
 */
export function isRepairable(row: PlaidHealthRow | undefined): boolean {
  if (!row) return false;
  return row.login_repair_required === true || row.item_error_code === 'ITEM_LOGIN_REQUIRED';
}

/**
 * A timestamp as a person would say it.
 *
 * Returns null for a missing value so callers can render "Not recorded yet"
 * rather than "Never" — these columns postdate the connections they describe,
 * and "never synced" would be an accusation the data cannot support.
 */
export function relativeTime(value: string | null | undefined, now: number = Date.now()): string | null {
  const at = parse(value);
  if (at == null) return null;

  const seconds = Math.round((now - at) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/** Exact local timestamp, for a `title` attribute beside the relative one. */
export function exactTime(value: string | null | undefined): string | null {
  const at = parse(value);
  if (at == null) return null;
  return new Date(at).toLocaleString();
}

/** `"Last synced 8 minutes ago"`, or the honest absence of a record. */
export function lastSyncSummary(row: PlaidHealthRow | undefined, now: number = Date.now()): string {
  const relative = relativeTime(row?.last_sync_at, now);
  if (!relative) return 'Last sync not recorded yet';
  return row?.last_sync_ok === false
    ? `Last sync failed ${relative}`
    : `Last synced ${relative}`;
}
