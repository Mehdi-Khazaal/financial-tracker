import React, { useEffect, useState } from 'react';
import {
  usePlaidLink,
  PlaidLinkOnSuccessMetadata,
  PlaidLinkOnEventMetadata,
  PlaidLinkStableEvent,
  PlaidLinkOnExitMetadata,
  PlaidLinkError,
} from 'react-plaid-link';
import { plaidCreateLinkToken, plaidCreateUpdateLinkToken } from '../../../utils/api';

/**
 * Lazy Plaid Link launcher — only mounted while the user is actively connecting
 * or repairing a bank. Loading `usePlaidLink` at page mount pulls in Plaid's CDN
 * script and injects a persistent preload iframe, which on iOS/Android PWAs has
 * been observed to break subsequent page rendering (the app snaps back to the
 * pre-redesign styles until the PWA is closed and reopened). Keeping this hook
 * out of the Settings render tree by default eliminates that side effect.
 *
 * This is why the component renders `null` and exists purely for its effects,
 * and why the parent must mount it conditionally rather than rendering it
 * always and gating `open()`. Mounting it eagerly reintroduces the bug even if
 * Link is never opened, because the cost is in the hook, not in the call.
 * `Settings.test.tsx` asserts the mount is conditional in **both** modes.
 *
 * ── The two modes ──────────────────────────────────────────────────────────
 *
 * `connect` creates a *new* Item and its success must be followed by a public
 * token exchange. `update` repairs an Item Fintrack already holds, and per
 * Plaid's documented contract its success must **not** be exchanged: the Item
 * is reused and its access token is unchanged. Getting that backwards would
 * send the repair flow into `exchange_token`, which rejects a second Item for
 * the same institution — failing the one flow whose job is to rescue a broken
 * connection.
 *
 * The mode therefore selects the token source here, and the *caller* owns the
 * matching success branch. See `usePlaidConnections.onConnected` (exchange) and
 * `onRepaired` (no exchange).
 */

export type PlaidLinkMode = 'connect' | 'update';

/**
 * Where a Link token is parked while Link is open.
 *
 * Scoped per mode and per Item so a stale token from one bank can never be used
 * to repair another, and so a repair in progress cannot clobber the key a
 * normal connection is using.
 */
export const linkTokenStorageKey = (mode: PlaidLinkMode, itemId?: number): string =>
  mode === 'update' ? `plaid_link_token_update_${itemId}` : 'plaid_link_token_connect';

export type PlaidLauncherProps = {
  /** Defaults to `connect` so existing call sites are unchanged. */
  mode?: PlaidLinkMode;
  /** Fintrack's own `PlaidItem.id`. Required for `update`, ignored otherwise. */
  itemId?: number;
  onSuccess: (public_token: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit: (err: PlaidLinkError | null, metadata: PlaidLinkOnExitMetadata) => void;
  onEvent?: (eventName: PlaidLinkStableEvent | string, metadata: PlaidLinkOnEventMetadata) => void;
  onError: (message: string) => void;
};

const PlaidLinkLauncher: React.FC<PlaidLauncherProps> = ({
  mode = 'connect', itemId, onSuccess, onExit, onEvent, onError,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // An update with no Item to update is a programming error, not something to
    // paper over by silently opening a new-connection flow — that would create
    // the duplicate Item this mode exists to avoid.
    if (mode === 'update' && itemId == null) {
      onError('Could not start reconnection. Try again.');
      return () => { cancelled = true; };
    }

    const request = mode === 'update'
      ? plaidCreateUpdateLinkToken(itemId as number)
      : plaidCreateLinkToken();

    request
      .then(r => { if (!cancelled) setToken(r.data.link_token); })
      .catch(() => {
        if (!cancelled) {
          onError(mode === 'update'
            ? 'Could not start reconnection. Try again.'
            : 'Could not start bank connection. Try again.');
        }
      });
    return () => { cancelled = true; };
  }, [mode, itemId, onError]);

  useEffect(() => {
    if (token) sessionStorage.setItem(linkTokenStorageKey(mode, itemId), token);
  }, [token, mode, itemId]);

  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri: undefined,
    onSuccess,
    onExit,
    onEvent,
  });

  useEffect(() => {
    if (ready && token && !opened) {
      setOpened(true);
      open();
    }
  }, [ready, token, opened, open]);

  return null;
};

export default PlaidLinkLauncher;
