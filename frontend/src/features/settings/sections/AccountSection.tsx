import React from 'react';
import { Avatar } from '../components/SettingsPrimitives';
import PasswordSection from './PasswordSection';

/**
 * Account: who you are signed in as, your password, and the way out.
 *
 * Deliberately contains only what exists. There is no endpoint to change a
 * username or an email, no session list, no 2FA and no account deletion, so
 * none of those appear here — a control that cannot work is worse than its
 * absence, which is the same rule that removed Edit and Delete from system
 * categories in 6.0.
 */

interface Props {
  username: string;
  email: string;
  onSignOut: () => void;
}

const AccountSection: React.FC<Props> = ({ username, email, onSignOut }) => (
  <div className="space-y-6">
    <section className="card p-5" aria-labelledby="settings-profile-heading">
      <h2 className="label mb-4" id="settings-profile-heading">Profile</h2>
      <div className="flex items-center gap-4">
        <Avatar label={username} size="lg" />
        <div className="min-w-0">
          <p className="font-semibold text-text">{username}</p>
          <p className="text-sm text-muted break-all">{email}</p>
        </div>
      </div>
      <button
        onClick={onSignOut}
        className="mt-4 w-full min-h-[44px] py-2.5 text-sm font-semibold rounded-xl transition-all"
        style={{
          backgroundColor: 'oklch(70% 0.17 25 / 0.08)',
          color: 'var(--neg)',
          border: '1px solid oklch(70% 0.17 25 / 0.15)',
        }}
      >
        Sign out
      </button>
    </section>

    <PasswordSection />
  </div>
);

export default AccountSection;
