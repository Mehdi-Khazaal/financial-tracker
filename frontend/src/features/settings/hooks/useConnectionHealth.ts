import { useCallback, useEffect, useState } from 'react';
import { plaidSyncHealth } from '../../../utils/api';
import type { LoadStatus, PlaidHealthRow } from '../types';

/**
 * Per-connection diagnostics, fetched only when they are going to be shown.
 *
 * `/plaid/sync-health` makes one live Plaid `/item/get` per connected Item,
 * serially, so it must never run on a page load that happens to include
 * Settings. This hook is mounted by `ConnectionsSection`, and Settings renders
 * exactly one section at a time — so mounting *is* the lazy load, with no
 * separate "has the user opened it" flag to keep in sync with the truth.
 *
 * Health is deliberately **not** required to render the section. The connected
 * bank list comes from `/plaid/items`, which is a plain database read; if these
 * diagnostics fail, the banks still appear and their status reads as unknown.
 * A failed diagnostic must never be able to hide a connection the user has.
 */
export interface UseConnectionHealth {
  status: LoadStatus;
  /** Keyed by Fintrack's `PlaidItem.id` — never by institution name. */
  byItemId: Map<number, PlaidHealthRow>;
  reload: () => void;
}

export function useConnectionHealth(): UseConnectionHealth {
  const [byItemId, setByItemId] = useState<Map<number, PlaidHealthRow>>(new Map());
  const [status, setStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await plaidSyncHealth();
      const rows: PlaidHealthRow[] = Array.isArray(response.data?.items)
        ? response.data.items
        : [];
      // A row without an id cannot be joined to anything, so it is dropped
      // rather than guessed at from its institution name.
      setByItemId(new Map(
        rows.filter(row => typeof row.id === 'number').map(row => [row.id, row]),
      ));
      setStatus('ready');
    } catch {
      setByItemId(new Map());
      setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { status, byItemId, reload: () => { void load(); } };
}
