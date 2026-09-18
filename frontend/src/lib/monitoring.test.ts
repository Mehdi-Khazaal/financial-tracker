import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initMonitoring, monitoringEnabled, resetMonitoringForTests } from './monitoring';

describe('monitoring', () => {
  beforeEach(() => resetMonitoringForTests());

  it('is off without a DSN and never loads the SDK', async () => {
    const load = vi.fn();
    expect(monitoringEnabled({})).toBe(false);
    expect(await initMonitoring({ VITE_SENTRY_DSN: '  ' }, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('initialises once with PII off when a DSN is present', async () => {
    const init = vi.fn();
    const load = vi.fn().mockResolvedValue({ init });
    const env = { VITE_SENTRY_DSN: 'https://k@o.ingest.sentry.io/1', MODE: 'production' };

    await initMonitoring(env, load);
    await initMonitoring(env, load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: env.VITE_SENTRY_DSN,
      environment: 'production',
      sendDefaultPii: false,
      tracesSampleRate: 0,
    }));
  });

  it('swallows a failed SDK load', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await initMonitoring({ VITE_SENTRY_DSN: 'https://k@o/1' }, load)).toBeNull();
  });
});
