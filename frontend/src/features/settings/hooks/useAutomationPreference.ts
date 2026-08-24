import { useCallback, useEffect, useState } from 'react';
import { getPreferences, updatePreferences } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';

/**
 * Automatic categorization, as a saved account setting.
 *
 * Unlike the push switch beside it, this is a *server* preference: it belongs
 * to the account and follows the user to every device. The two are kept apart
 * deliberately — see `usePushPreference`, which reports what one browser has
 * subscribed to and nothing more.
 *
 * Three states, not two. `'unavailable'` is the case that earns its own name:
 * the user's setting is on, but a deployment-level switch has the feature
 * turned off for everyone. Rendering that as OFF would be a lie the user could
 * act on — they would flip a switch that was already where they wanted it.
 *
 * Loading is not optimistic. The switch shows nothing until the server answers,
 * and a failed write puts the previous value straight back, because a setting
 * that appears to save and did not is worse than one that visibly refused.
 */
export type AutomationState = 'loading' | 'on' | 'off' | 'unavailable' | 'error';

export interface UseAutomationPreference {
  state: AutomationState;
  /** What the user has chosen, regardless of whether it currently applies. */
  enabled: boolean;
  /** True while a write is in flight. */
  busy: boolean;
  /** The feature is switched off for everyone, so the control is inert. */
  unavailable: boolean;
  toggle: () => Promise<void>;
  reload: () => void;
}

interface PreferencesPayload {
  automatic_categorization_enabled?: boolean;
  automatic_categorization_effective?: boolean;
}

export function useAutomationPreference(): UseAutomationPreference {
  const toast = useToast();
  const [state, setState] = useState<AutomationState>('loading');
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((data: PreferencesPayload) => {
    const stored = data.automatic_categorization_enabled === true;
    // Absent rather than false: an older server that does not send the
    // effective field is not claiming the feature is off.
    const effective = data.automatic_categorization_effective !== false;
    setEnabled(stored);
    setUnavailable(!effective && stored);
    setState(!effective && stored ? 'unavailable' : stored ? 'on' : 'off');
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await getPreferences();
      apply(response.data ?? {});
    } catch {
      // Unknown, and said so. Showing OFF here would invite someone to turn on
      // a setting that may already be on.
      setState('error');
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Deliberately not optimistic.
   *
   * The switch moves when the server says it moved, matching the push toggle
   * beside it. Nothing needs rolling back on failure because nothing was
   * changed in the first place — the busy state is the only thing the click
   * produces until an answer arrives.
   */
  const toggle = useCallback(async () => {
    const next = !enabled;
    setBusy(true);
    try {
      const response = await updatePreferences({ automatic_categorization_enabled: next });
      // The server's answer wins, not the value we sent — it is the only thing
      // that knows whether the kill-switch is in the way.
      apply(response.data ?? {});
      toast.success(next ? 'Automatic categorization on' : 'Automatic categorization off');
    } catch {
      toast.error('Could not save that setting');
    } finally {
      setBusy(false);
    }
  }, [apply, enabled, toast]);

  return {
    state,
    enabled,
    busy,
    unavailable,
    toggle,
    reload: () => { void load(); },
  };
}
