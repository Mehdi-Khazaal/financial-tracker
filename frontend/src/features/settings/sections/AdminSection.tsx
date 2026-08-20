import React from 'react';
import type { UseAdminUsers } from '../hooks/useAdminUsers';
import {
  Avatar,
  EmptyBlock,
  LoadingBlock,
  SectionErrorBlock,
  SectionHeading,
  SettingsRow,
} from '../components/SettingsPrimitives';

/**
 * Admin: list users, and send one a password reset email.
 *
 * A section rather than a route. Two endpoints do not justify a new entry in
 * `lib/routes.tsx` and a role-aware guard built solely for them, and the app
 * has no nested routing anywhere; `?tab=admin` gives it an address without
 * either. Hiding it from non-admins is presentation only — `require_admin`
 * rejects both endpoints server-side no matter what the client renders.
 *
 * "Reset PW" sends an email. It does not set a password, and it does not sign
 * the target out: `session_version` moves only when the *user* completes the
 * reset, so an admin cannot revoke someone's sessions unilaterally.
 */

interface Props {
  admin: UseAdminUsers;
}

const AdminSection: React.FC<Props> = ({ admin }) => (
  <section aria-labelledby="settings-admin-heading">
    <SectionHeading
      title="Admin — All Users"
      badge={(
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
          style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.12)', color: 'var(--accent)' }}
        >
          ADMIN
        </span>
      )}
    />
    <h2 className="sr-only" id="settings-admin-heading">Admin — All Users</h2>

    {admin.status === 'loading' ? (
      <LoadingBlock label="Loading users" />
    ) : admin.status === 'error' ? (
      <SectionErrorBlock
        message="The user list could not be loaded."
        onRetry={admin.reload}
      />
    ) : admin.items.length === 0 ? (
      <EmptyBlock>No users found</EmptyBlock>
    ) : (
      <div className="card overflow-hidden">
        {admin.items.map((user, index) => (
          <SettingsRow
            key={user.id}
            isLast={index === admin.items.length - 1}
            action={(
              <button
                onClick={() => { void admin.requestReset(user); }}
                disabled={admin.resettingId === user.id}
                className="shrink-0 min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40"
                style={{ backgroundColor: 'rgba(245,158,11,.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,.2)' }}
              >
                {admin.resettingId === user.id ? '…' : 'Reset PW'}
              </button>
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Avatar label={user.username} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text truncate">{user.username}</p>
                  {user.is_admin && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.12)', color: 'var(--accent)' }}
                    >
                      admin
                    </span>
                  )}
                  {user.is_verified && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.12)', color: 'var(--pos)' }}
                    >
                      verified
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted truncate">{user.email}</p>
              </div>
            </div>
          </SettingsRow>
        ))}
      </div>
    )}
  </section>
);

export default AdminSection;
