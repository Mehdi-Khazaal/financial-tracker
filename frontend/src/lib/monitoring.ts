/**
 * Optional browser error reporting. Inert unless `VITE_SENTRY_DSN` is set.
 *
 * The SDK is loaded with a dynamic import so it is a separate chunk that is
 * never even fetched for a build without a DSN — the bundle budget for the
 * entry does not move. PII is off: nothing about the user or their ledger is
 * attached to a report beyond the error itself and the route it happened on.
 */

type SentryModule = typeof import('@sentry/browser');

let loading: Promise<SentryModule | null> | null = null;

export function monitoringEnabled(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): boolean {
  return Boolean((env.VITE_SENTRY_DSN || '').trim());
}

export function initMonitoring(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
  load: () => Promise<SentryModule> = () => import('@sentry/browser'),
): Promise<SentryModule | null> {
  if (!monitoringEnabled(env)) return Promise.resolve(null);
  if (loading) return loading;
  loading = load()
    .then(sentry => {
      sentry.init({
        dsn: env.VITE_SENTRY_DSN,
        environment: env.MODE || 'production',
        release: env.VITE_GIT_COMMIT || undefined,
        sendDefaultPii: false,
        tracesSampleRate: 0,
      });
      return sentry;
    })
    .catch(() => null);
  return loading;
}

/** Test seam: forget a previous initialisation. */
export function resetMonitoringForTests(): void {
  loading = null;
}
