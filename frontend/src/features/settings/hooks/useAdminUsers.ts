import { useCallback, useEffect, useState } from 'react';
import { adminGetUsers, adminResetPassword } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import type { AdminUserSummary, AsyncCollection, LoadStatus } from '../types';

export interface UseAdminUsers extends AsyncCollection<AdminUserSummary> {
  resettingId: number | null;
  requestReset: (user: AdminUserSummary) => Promise<void>;
}

/**
 * The admin user list, loaded only for admins.
 *
 * `enabled` gates the request rather than the render: a non-admin should not
 * issue a call that will 403, and the endpoint is guarded server-side by
 * `require_admin` regardless of what the client believes.
 *
 * The previous implementation had no `catch` at all, so a rejected request left
 * an empty list that looked exactly like "no users exist".
 */
export function useAdminUsers(enabled: boolean): UseAdminUsers {
  const toast = useToast();
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [resettingId, setResettingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    try {
      const response = await adminGetUsers();
      setItems(Array.isArray(response.data) ? response.data : []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [enabled]);

  useEffect(() => { void reload(); }, [reload]);

  const requestReset = useCallback(async (user: AdminUserSummary) => {
    // Wording matters and is asserted by test: this sends an email. An admin
    // never sets, sees or chooses a password here.
    const confirmed = await toast.confirm(`Send a password reset email to ${user.email}?`);
    if (!confirmed) return;
    setResettingId(user.id);
    try {
      await adminResetPassword(user.id);
      toast.success(`Reset email sent to ${user.email}`);
    } catch {
      toast.error('Failed to send reset email');
    } finally {
      setResettingId(null);
    }
  }, [toast]);

  return { status, items, reload: () => { void reload(); }, resettingId, requestReset };
}
