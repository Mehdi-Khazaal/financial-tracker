import { useCallback, useEffect, useState } from 'react';
import {
  plaidDeleteItem,
  plaidExchangeToken,
  plaidGetItems,
  plaidReset,
  plaidSyncAll,
} from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import type { AsyncCollection, LoadStatus, PlaidItemSummary } from '../types';

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
  syncing: boolean;
  resetting: boolean;
  disconnectingId: number | null;
  launching: boolean;
  syncNow: () => Promise<void>;
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
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null);
  const [launching, setLaunching] = useState(false);

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

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await plaidSyncAll();
      toast.success("Sync started — you'll get a notification when done");
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [toast]);

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

  const startConnect = useCallback(() => setLaunching(true), []);

  const onConnected = useCallback(async (publicToken: string, institutionName?: string) => {
    try {
      await plaidExchangeToken(publicToken, institutionName);
      toast.success(`${institutionName || 'Bank'} connected! Syncing transactions...`);
      await reload();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Failed to connect bank');
    } finally {
      sessionStorage.removeItem('plaid_link_token');
      setLaunching(false);
    }
  }, [reload, toast]);

  const onConnectCancelled = useCallback(() => {
    sessionStorage.removeItem('plaid_link_token');
    setLaunching(false);
  }, []);

  const onConnectError = useCallback((message: string) => {
    toast.error(message);
    setLaunching(false);
  }, [toast]);

  return {
    status,
    items,
    reload: () => { void reload(); },
    syncing,
    resetting,
    disconnectingId,
    launching,
    syncNow,
    reset,
    disconnect,
    startConnect,
    onConnected,
    onConnectCancelled,
    onConnectError,
  };
}
