import React, { useEffect, useState } from 'react';
import {
  usePlaidLink,
  PlaidLinkOnSuccessMetadata,
  PlaidLinkOnEventMetadata,
  PlaidLinkStableEvent,
  PlaidLinkOnExitMetadata,
  PlaidLinkError,
} from 'react-plaid-link';
import { plaidCreateLinkToken } from '../../../utils/api';

/**
 * Lazy Plaid Link launcher — only mounted while the user is actively connecting
 * a bank. Loading `usePlaidLink` at page mount pulls in Plaid's CDN script and
 * injects a persistent preload iframe, which on iOS/Android PWAs has been
 * observed to break subsequent page rendering (the app snaps back to the
 * pre-redesign styles until the PWA is closed and reopened). Keeping this
 * hook out of the Settings render tree by default eliminates that side effect.
 *
 * This is why the component renders `null` and exists purely for its effects,
 * and why the parent must mount it conditionally rather than rendering it
 * always and gating `open()`. Mounting it eagerly reintroduces the bug even if
 * Link is never opened, because the cost is in the hook, not in the call.
 * `Settings.test.tsx` asserts the mount is conditional.
 */
export type PlaidLauncherProps = {
  onSuccess: (public_token: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit: (err: PlaidLinkError | null, metadata: PlaidLinkOnExitMetadata) => void;
  onEvent?: (eventName: PlaidLinkStableEvent | string, metadata: PlaidLinkOnEventMetadata) => void;
  onError: (message: string) => void;
};

const PlaidLinkLauncher: React.FC<PlaidLauncherProps> = ({
  onSuccess, onExit, onEvent, onError,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    plaidCreateLinkToken()
      .then(r => { if (!cancelled) setToken(r.data.link_token); })
      .catch(() => { if (!cancelled) onError('Could not start bank connection. Try again.'); });
    return () => { cancelled = true; };
  }, [onError]);

  useEffect(() => {
    if (token) sessionStorage.setItem('plaid_link_token', token);
  }, [token]);

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
