import React from 'react';
import { isPushSupported } from '../../../utils/push';
import type { UsePushPreference } from '../hooks/usePushPreference';
import type { UseAutomationPreference } from '../hooks/useAutomationPreference';

/**
 * Preferences: two switches that are not the same kind of thing.
 *
 * **Automation** is an account setting, stored server-side, and follows the
 * user everywhere. **Notifications** is a subscription held by one browser.
 * They are deliberately in separate blocks with separate wording, because
 * presenting a device subscription as a saved preference is the specific lie
 * this section has always avoided — see `usePushPreference`.
 *
 * Only settings with something real behind them appear here. There is no
 * recurring-detection switch, no budget-alert switch and no per-notification
 * types, because none of that is controllable yet; an inert toggle promises
 * control the backend cannot honour.
 */

interface Props {
  push: UsePushPreference;
  automation: UseAutomationPreference;
}

/** The shared switch. One implementation, so the two rows cannot drift apart. */
const Switch: React.FC<{
  label: string;
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onToggle: () => void;
}> = ({ label, checked, disabled, busy, onToggle }) => (
  <button
    onClick={onToggle}
    disabled={disabled}
    className="relative w-12 h-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    aria-busy={busy}
    style={{ backgroundColor: checked ? 'var(--accent)' : 'var(--line)' }}
  >
    <span
      className="absolute top-3 left-1.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
      style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
    />
  </button>
);

const Row: React.FC<{
  title: string;
  description: React.ReactNode;
  control: React.ReactNode;
}> = ({ title, description, control }) => (
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0">
      <p className="text-sm font-medium text-text">{title}</p>
      <div className="text-xs text-muted mt-0.5">{description}</div>
    </div>
    {control}
  </div>
);

const AUTOMATION_DESCRIPTION =
  'Choose a category for new transactions when you have not picked one, based on how you '
  + 'have filed the same place before.';

const PreferencesSection: React.FC<Props> = ({ push, automation }) => (
  <div className="space-y-4">
    <section className="card p-5" aria-labelledby="settings-automation-heading">
      <h2 className="label mb-4" id="settings-automation-heading">Automation</h2>

      <Row
        title="Automatic categorization"
        description={
          automation.state === 'loading'
            ? 'Checking…'
            : automation.state === 'error'
              ? 'Could not load this setting'
              : automation.unavailable
                // Named as a state rather than shown as OFF: the user's choice
                // is still on, and telling them otherwise would have them flip
                // a switch that is already where they want it.
                ? 'Unavailable — temporarily turned off by Fintrack.'
                : AUTOMATION_DESCRIPTION
        }
        control={(
          <Switch
            label="Automatic categorization"
            checked={automation.enabled}
            disabled={
              automation.busy
              || automation.state === 'loading'
              || automation.state === 'error'
              || automation.unavailable
            }
            busy={automation.busy || automation.state === 'loading'}
            onToggle={() => { void automation.toggle(); }}
          />
        )}
      />

      {/* Announced, so a screen reader hears the outcome of a change without
          the section being re-read; and offered as a retry when the setting
          could not be read at all. */}
      <p className="sr-only" role="status" aria-live="polite">
        {automation.state === 'loading'
          ? 'Loading automatic categorization setting'
          : automation.state === 'error'
            ? 'Automatic categorization setting could not be loaded'
            : automation.unavailable
              ? 'Automatic categorization is unavailable'
              : `Automatic categorization ${automation.enabled ? 'on' : 'off'}`}
      </p>

      {automation.state === 'error' && (
        <button
          type="button"
          onClick={automation.reload}
          className="mt-3 min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg"
          style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--fg)', border: '1px solid var(--line)' }}
        >
          Try again
        </button>
      )}

      {!automation.unavailable && automation.state !== 'error' && (
        <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
          Turning this off leaves new transactions uncategorized — nothing already
          filed changes, and you can still categorize anything yourself.
        </p>
      )}
    </section>

    <section className="card p-5" aria-labelledby="settings-preferences-heading">
      <h2 className="label mb-4" id="settings-preferences-heading">Notifications</h2>

      {!isPushSupported() ? (
        <p className="text-sm text-muted">
          This browser does not support push notifications.
        </p>
      ) : (
        <>
          <Row
            title="Push notifications"
            description={
              push.state === 'checking'
                ? 'Checking this device…'
                : push.state === 'error'
                  ? 'Could not check this device'
                  : 'Bank sync, recurring transactions, savings milestones'
            }
            control={(
              <Switch
                label="Push notifications"
                checked={push.enabled}
                disabled={push.busy || push.state === 'checking'}
                busy={push.state === 'checking' || push.busy}
                onToggle={() => { void push.toggle(); }}
              />
            )}
          />
          <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
            This applies to this device only.
          </p>
        </>
      )}
    </section>
  </div>
);

export default PreferencesSection;
