import { useCallback, useEffect, useState } from 'react';
import { adminGetUsage, type AdminUsageSummary } from '../../../utils/api';
import type { LoadStatus } from '../types';

export interface UseAdminUsage {
  status: LoadStatus;
  summary: AdminUsageSummary | null;
  reload: () => void;
}

/** Assistant usage per user for the admin view. Loaded only for admins. */
export function useAdminUsage(enabled: boolean, days = 30): UseAdminUsage {
  const [summary, setSummary] = useState<AdminUsageSummary | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const reload = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    try {
      const res = await adminGetUsage(days);
      setSummary(res.data);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [enabled, days]);

  useEffect(() => { void reload(); }, [reload]);

  return { status, summary, reload: () => { void reload(); } };
}
