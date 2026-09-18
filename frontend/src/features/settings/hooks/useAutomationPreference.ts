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

/**
 * The alert switches ride on the same request. They are plain server
 * preferences with no kill-switch, so they need none of the automation
 * switch's extra states — but they share its loading and error state, since
 * one answer covers them all.
 */
export type AlertKind = 'bill_reminders_enabled' | 'budget_alerts_enabled' | 'low_balance_alerts_enabled';

export interface AlertSettings {
  bill_reminders_enabled: boolean;
  budget_alerts_enabled: boolean;
  low_balance_alerts_enabled: boolean;
  /** Decimal string, as the server sends it. */
  low_balance_threshold: string;
}

export const ALERT_DEFAULTS: AlertSettings = {
  bill_reminders_enabled: true,
  budget_alerts_enabled: true,
  low_balance_alerts_enabled: false,
  low_balance_threshold: '100.00',
};

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
  alerts: AlertSettings;
  toggleAlert: (kind: AlertKind) => Promise<void>;
  /** Saves a new low-balance threshold; resolves to an error message or null. */
  setThreshold: (value: string) => Promise<string | null>;
}

interface PreferencesPayload {
  automatic_categorization_enabled?: boolean;
  automatic_categorization_effective?: boolean;
  bill_reminders_enabled?: boolean;
  budget_alerts_enabled?: boolean;
  low_balance_alerts_enabled?: boolean;
  low_balance_threshold?: string | number;
}

const ALERT_LABELS: Record<AlertKind, string> = {
  bill_reminders_enabled: 'Bill reminders',
  budget_alerts_enabled: 'Budget alerts',
  low_balance_alerts_enabled: 'Low balance alerts',
};

export function useAutomationPreference(): UseAutomationPreference {
  const toast = useToast();
  const [state, setState] = useState<AutomationState>('loading');
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState<AlertSettings>(ALERT_DEFAULTS);

  const apply = useCallback((data: PreferencesPayload) => {
    // An older server without the alert fields is not claiming they are off.
    setAlerts({
      bill_reminders_enabled: data.bill_reminders_enabled ?? ALERT_DEFAULTS.bill_reminders_enabled,
      budget_alerts_enabled: data.budget_alerts_enabled ?? ALERT_DEFAULTS.budget_alerts_enabled,
      low_balance_alerts_enabled: data.low_balance_alerts_enabled ?? ALERT_DEFAULTS.low_balance_alerts_enabled,
      low_balance_threshold: data.low_balance_threshold != null ? String(data.low_balance_threshold) : ALERT_DEFAULTS.low_balance_threshold,
    });
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

  const toggleAlert = useCallback(async (kind: AlertKind) => {
    const next = !alerts[kind];
    setBusy(true);
    try {
      const response = await updatePreferences({ [kind]: next });
      apply(response.data ?? {});
      toast.success(`${ALERT_LABELS[kind]} ${next ? 'on' : 'off'}`);
    } catch {
      toast.error('Could not save that setting');
    } finally {
      setBusy(false);
    }
  }, [alerts, apply, toast]);

  const setThreshold = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return 'Enter an amount like 150 or 150.00';
    setBusy(true);
    try {
      // Sent as the string the user typed: money never goes through a float.
      const response = await updatePreferences({ low_balance_threshold: trimmed });
      apply(response.data ?? {});
      toast.success('Threshold saved');
      return null;
    } catch {
      return 'Could not save the threshold';
    } finally {
      setBusy(false);
    }
  }, [apply, toast]);

  return {
    state,
    enabled,
    busy,
    unavailable,
    toggle,
    reload: () => { void load(); },
    alerts,
    toggleAlert,
    setThreshold,
  };
}
