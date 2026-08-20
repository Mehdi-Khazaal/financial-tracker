import React from 'react';
import { isPushSupported } from '../../../utils/push';
import type { UsePushPreference } from '../hooks/usePushPreference';

/**
 * Preferences: one switch, honestly described.
 *
 * There is no preference storage in the app — `users` carries nothing beyond
 * `timezone`, and there is no preferences table — so this is a *device*
 * subscription rather than a saved setting, and it says so. Per-notification
 * types do not exist either; inventing switches for them would promise control
 * the backend cannot honour.
 *
 * Three notification kinds actually send today: bank sync completion, recurring
 * transactions, and savings milestones. The subtitle names all three.
 */

interface Props {
  push: UsePushPreference;
}

const PreferencesSection: React.FC<Props> = ({ push }) => {
  if (!isPushSupported()) {
    return (
      <section className="card p-5" aria-labelledby="settings-preferences-heading">
        <h2 className="label mb-2" id="settings-preferences-heading">Notifications</h2>
        <p className="text-sm text-muted">
          This browser does not support push notifications.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-5" aria-labelledby="settings-preferences-heading">
      <h2 className="label mb-4" id="settings-preferences-heading">Notifications</h2>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">Push notifications</p>
          <p className="text-xs text-muted mt-0.5">
            {push.state === 'checking'
              ? 'Checking this device…'
              : push.state === 'error'
                ? 'Could not check this device'
                : 'Bank sync, recurring transactions, savings milestones'}
          </p>
        </div>
        <button
          onClick={() => { void push.toggle(); }}
          disabled={push.busy || push.state === 'checking'}
          className="relative w-12 h-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50"
          role="switch"
          aria-checked={push.enabled}
          aria-label="Push notifications"
          aria-busy={push.state === 'checking' || push.busy}
          style={{ backgroundColor: push.enabled ? 'var(--accent)' : 'var(--line)' }}
        >
          <span
            className="absolute top-3 left-1.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
            style={{ transform: push.enabled ? 'translateX(20px)' : 'translateX(0)' }}
          />
        </button>
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
        This applies to this device only.
      </p>
    </section>
  );
};

export default PreferencesSection;
