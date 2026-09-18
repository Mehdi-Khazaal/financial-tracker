import React from 'react';
import type { UseAdminUsers } from '../hooks/useAdminUsers';
import type { UseAdminUsage } from '../hooks/useAdminUsage';
import {
  Avatar,
  EmptyBlock,
  LoadingBlock,
  SectionErrorBlock,
  SectionHeading,
  SettingsRow,
} from '../components/SettingsPrimitives';

/**
 * Admin: list users, send one a password reset email, and see what the
 * assistant is costing per person.
 *
 * A section rather than a route. A handful of endpoints do not justify a new
 * entry in `lib/routes.tsx` and a role-aware guard built solely for them, and
 * the app has no nested routing anywhere; `?tab=admin` gives it an address
 * without either. Hiding it from non-admins is presentation only —
 * `require_admin` rejects every endpoint server-side no matter what the
 * client renders.
 *
 * "Reset PW" sends an email. It does not set a password, and it does not sign
 * the target out: `session_version` moves only when the *user* completes the
 * reset, so an admin cannot revoke someone's sessions unilaterally.
 */

interface Props {
  admin: UseAdminUsers;
  usage: UseAdminUsage;
}

const money = (value: string | number) => `$${Number(value).toFixed(2)}`;

const UsagePanel: React.FC<{ usage: UseAdminUsage }> = ({ usage }) => {
  if (usage.status === 'loading') return <LoadingBlock label="Loading usage" />;
  if (usage.status === 'error' || !usage.summary) {
    return <SectionErrorBlock message="Assistant usage could not be loaded." onRetry={usage.reload} />;
  }
  const { summary } = usage;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="label" style={{ color: 'var(--muted)' }}>Last {summary.days} days</p>
        <p className="label" style={{ color: 'var(--dim)' }}>
          Caps · {summary.turn_cap || '∞'} msgs · {summary.cost_cap_usd && Number(summary.cost_cap_usd) > 0 ? money(summary.cost_cap_usd) : '∞'} / day
        </p>
      </div>
      {summary.users.length === 0 ? (
        <EmptyBlock>No assistant usage yet</EmptyBlock>
      ) : (
        <table className="w-full text-sm" aria-label="Assistant usage per user">
          <thead>
            <tr className="label" style={{ color: 'var(--dim)' }}>
              <th className="text-left font-normal px-4 py-2">User</th>
              <th className="text-right font-normal px-4 py-2">Messages</th>
              <th className="text-right font-normal px-4 py-2">Cost</th>
            </tr>
          </thead>
          <tbody>
            {summary.users.map(row => (
              <tr key={row.user_id} style={{ borderTop: '1px solid var(--line)' }}>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-text truncate">{row.username}</p>
                  <p className="text-xs text-muted truncate">{row.email}</p>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>{row.turns}</td>
                <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>{money(row.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const AdminSection: React.FC<Props> = ({ admin, usage }) => (
  <div className="space-y-8">
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

    <section aria-labelledby="settings-usage-heading">
      <SectionHeading title="Assistant usage" />
      <h2 className="sr-only" id="settings-usage-heading">Assistant usage</h2>
      <UsagePanel usage={usage} />
    </section>
  </div>
);

export default AdminSection;
