import { useCallback, useEffect, useState } from 'react';
import {
  plaidDeleteItem,
  plaidExchangeToken,
  plaidGetItems,
  plaidReset,
} from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import type { AsyncCollection, LoadStatus, PlaidItemSummary } from '../types';

/**
 * Connected banks, and the actions that change them.
 *
 * Sync Now deliberately does *not* live here. It needs a baseline, a bounded
 * poll and a settled outcome — a state machine rather than a request, see
 * `useManualSync`. Keeping a second, simpler `syncNow` alongside it would
 * invite the old bug back, where a POST returning was mistaken for a sync
 * finishing.
 */

/**
 * What "Reset & Start Fresh" actually does, in the user's terms.
 *
 * The wording before Phase 6.0 promised only that manual transactions were
 * safe, which is true but incomplete: it also destroys every category the user
 * filed against an imported transaction, and it cannot be undone. The endpoint
 * is unchanged — `backend/tests/test_plaid_reset.py` pins what it does today,
 * and 6C owns fixing it — so the copy has to carry the whole truth on its own.
 */
export const RESET_CONFIRMATION =
  'This deletes every transaction imported from your banks, disconnects all connected banks, '
  + 'and loses the categories you filed against those transactions. Transactions you added '
  + 'yourself are not affected. This cannot be undone.';

export interface UsePlaidConnections extends AsyncCollection<PlaidItemSummary> {
  resetting: boolean;
  disconnectingId: number | null;
  /** Which Link flow is open, if any. Null means the launcher is unmounted. */
  linkFlow: { mode: 'connect' | 'update'; itemId?: number } | null;
  /** The Item currently being repaired, for the card's busy state. */
  repairingId: number | null;
  startRepair: (item: PlaidItemSummary) => void;
  onRepaired: (itemId: number) => Promise<void>;
  /**
   * Bumped when a repair succeeds, so the section can re-read health and run an
   * ordinary sync. A signal rather than a callback because the launcher lives
   * on the page while the sync machinery lives in the section, and threading a
   * function between them would couple the two.
   */
  repairCompletedAt: number | null;
  reset: () => Promise<void>;
  disconnect: (item: PlaidItemSummary) => Promise<void>;
  startConnect: () => void;
  onConnected: (publicToken: string, institutionName?: string) => Promise<void>;
  onConnectCancelled: () => void;
  onConnectError: (message: string) => void;
}

export function usePlaidConnections(): UsePlaidConnections {
  const toast = useToast();
  const [items, setItems] = useState<PlaidItemSummary[]>([]);
  // Was a bare `catch {}` on the page, so a failed request rendered as "no
  // connected banks" — the one answer a user must not be given wrongly.
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [resetting, setResetting] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null);
  const [linkFlow, setLinkFlow] = useState<{ mode: 'connect' | 'update'; itemId?: number } | null>(null);
  const [repairingId, setRepairingId] = useState<number | null>(null);
  const [repairCompletedAt, setRepairCompletedAt] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await plaidGetItems();
      setItems(Array.isArray(response.data) ? response.data : []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const reset = useCallback(async () => {
    // The app's own confirm, not the browser's: `window.confirm` blocks the
    // event loop and bypasses the focus handling every other destructive
    // action gets.
    const confirmed = await toast.confirm(RESET_CONFIRMATION, { danger: true });
    if (!confirmed) return;
    setResetting(true);
    try {
      const response = await plaidReset();
      toast.success(response.data.message || 'Plaid data cleared');
      setItems([]);
      setStatus('ready');
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Reset failed');
    } finally {
      setResetting(false);
    }
  }, [toast]);

  const disconnect = useCallback(async (item: PlaidItemSummary) => {
    const confirmed = await toast.confirm(
      `Disconnect ${item.institution_name || 'this bank'}? Your existing transactions won't be deleted.`,
    );
    if (!confirmed) return;
    setDisconnectingId(item.id);
    try {
      await plaidDeleteItem(item.id);
      setItems(current => current.filter(entry => entry.id !== item.id));
      toast.success('Bank disconnected');
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnectingId(null);
    }
  }, [toast]);

  const startConnect = useCallback(() => setLinkFlow({ mode: 'connect' }), []);

  const startRepair = useCallback((item: PlaidItemSummary) => {
    setRepairingId(item.id);
    setLinkFlow({ mode: 'update', itemId: item.id });
  }, []);

  /**
   * Link update mode succeeded.
   *
   * **Deliberately does not exchange a public token.** Plaid's documented
   * contract for update mode reuses the existing Item and leaves its access
   * token unchanged, so there is nothing to exchange — and `exchange_token`
   * would reject it anyway, since it refuses a second Item for an institution
   * already connected. Calling it here would break the one flow whose purpose
   * is to rescue a broken connection.
   *
   * Nothing local changes either: same Item, same cursor, same transactions.
   * The caller re-reads health and runs an ordinary sync; Plaid clears the
   * error itself and backfills the missed window on its next webhook.
   */
  const onRepaired = useCallback(async (itemId: number) => {
    sessionStorage.removeItem(`plaid_link_token_update_${itemId}`);
    setLinkFlow(null);
    setRepairingId(null);
    toast.success('Bank reconnected');
    await reload();
    setRepairCompletedAt(Date.now());
  }, [reload, toast]);

  /**
   * A *new* connection succeeded, so the public token must be exchanged — this
   * is the branch update mode must never reach. See `onRepaired`.
   */
  const onConnected = useCallback(async (publicToken: string, institutionName?: string) => {
    try {
      await plaidExchangeToken(publicToken, institutionName);
      toast.success(`${institutionName || 'Bank'} connected! Syncing transactions...`);
      await reload();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to connect bank');
    } finally {
      sessionStorage.removeItem('plaid_link_token_connect');
      setLinkFlow(null);
    }
  }, [reload, toast]);

  /**
   * The user closed Link, in either mode. Not an error and not destructive:
   * a cancelled repair leaves the connection exactly as it was, still needing
   * attention, and Reconnect can simply be pressed again.
   */
  const onConnectCancelled = useCallback(() => {
    setLinkFlow(current => {
      if (current?.mode === 'update' && current.itemId != null) {
        sessionStorage.removeItem(`plaid_link_token_update_${current.itemId}`);
      } else {
        sessionStorage.removeItem('plaid_link_token_connect');
      }
      return null;
    });
    setRepairingId(null);
  }, []);

  const onConnectError = useCallback((message: string) => {
    toast.error(message);
    setLinkFlow(null);
    setRepairingId(null);
  }, [toast]);

  return {
    status,
    items,
    reload: () => { void reload(); },
    resetting,
    disconnectingId,
    linkFlow,
    repairingId,
    reset,
    disconnect,
    startConnect,
    startRepair,
    onRepaired,
    repairCompletedAt,
    onConnected,
    onConnectCancelled,
    onConnectError,
  };
}
