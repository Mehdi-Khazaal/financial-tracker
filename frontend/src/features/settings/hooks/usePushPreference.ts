import { useCallback, useEffect, useState } from 'react';
import { hasPushSubscription, subscribeToPush, unsubscribeFromPush } from '../../../utils/push';
import { useToast } from '../../../context/ToastContext';

/**
 * Whether *this device* holds a push subscription.
 *
 * `'checking'` until the PushManager answers. This used to initialise from
 * `Notification.permission`, which is a different question — permission
 * outlives unsubscribing, so turning notifications off and reloading showed the
 * switch ON with no subscription behind it. Rendering an unknown state as OFF
 * would be a smaller version of the same lie, so it renders as neither until
 * the answer arrives.
 */
export type PushState = 'checking' | 'on' | 'off' | 'error';

export interface UsePushPreference {
  state: PushState;
  enabled: boolean;
  busy: boolean;
  toggle: () => Promise<void>;
}

export function usePushPreference(): UsePushPreference {
  const toast = useToast();
  const [state, setState] = useState<PushState>('checking');
  const [busy, setBusy] = useState(false);
  const enabled = state === 'on';

  useEffect(() => {
    let cancelled = false;
    hasPushSubscription()
      .then(subscribed => { if (!cancelled) setState(subscribed ? 'on' : 'off'); })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      if (enabled) {
        await unsubscribeFromPush();
        setState('off');
        toast.success('Notifications disabled');
      } else {
        const ok = await subscribeToPush();
        setState(ok ? 'on' : 'off');
        if (ok) toast.success('Notifications enabled');
        else toast.error('Could not enable notifications — check browser permissions');
      }
    } catch {
      // Visible, but the switch keeps whatever the last known truth was rather
      // than inventing one.
      toast.error('Could not change notification settings');
    } finally {
      setBusy(false);
    }
  }, [enabled, toast]);

  return { state, enabled, busy, toggle };
}
