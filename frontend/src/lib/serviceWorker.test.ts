import { describe, expect, it, vi } from 'vitest';
import { UPDATE_EVENT, installPreloadErrorRecovery, watchForUpdates } from './serviceWorker';

type Listener = (event?: unknown) => void;

function fakeWorker(): ServiceWorker & { fire: (state: string) => void } {
  const listeners: Listener[] = [];
  const worker = {
    state: 'installing',
    addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
    fire(state: string) {
      (worker as { state: string }).state = state;
      listeners.forEach(fn => fn());
    },
  };
  return worker as unknown as ServiceWorker & { fire: (state: string) => void };
}

function fakeRegistration(opts: { waiting?: boolean } = {}) {
  const listeners: Listener[] = [];
  const reg = {
    waiting: opts.waiting ? ({} as ServiceWorker) : null,
    installing: null as ServiceWorker | null,
    addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
    updateFound(worker: ServiceWorker) {
      reg.installing = worker;
      listeners.forEach(fn => fn());
    },
  };
  return reg;
}

describe('watchForUpdates', () => {
  it('does not prompt on the very first install', () => {
    const notify = vi.fn();
    const reg = fakeRegistration();
    watchForUpdates(reg as unknown as ServiceWorkerRegistration, { controller: null }, notify);

    const worker = fakeWorker();
    reg.updateFound(worker);
    worker.fire('installed');

    expect(notify).not.toHaveBeenCalled();
  });

  it('prompts when a new worker installs over a controlling one', () => {
    const notify = vi.fn();
    const reg = fakeRegistration();
    watchForUpdates(reg as unknown as ServiceWorkerRegistration, { controller: {} as ServiceWorker }, notify);

    const worker = fakeWorker();
    reg.updateFound(worker);
    worker.fire('installing');
    expect(notify).not.toHaveBeenCalled();
    worker.fire('installed');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('prompts immediately when a worker is already waiting', () => {
    const notify = vi.fn();
    const reg = fakeRegistration({ waiting: true });
    watchForUpdates(reg as unknown as ServiceWorkerRegistration, { controller: {} as ServiceWorker }, notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('dispatches the update event on window by default', () => {
    const handler = vi.fn();
    window.addEventListener(UPDATE_EVENT, handler);
    const reg = fakeRegistration({ waiting: true });
    watchForUpdates(reg as unknown as ServiceWorkerRegistration, { controller: {} as ServiceWorker });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(UPDATE_EVENT, handler);
  });
});

describe('installPreloadErrorRecovery', () => {
  function fakeWindow() {
    const store = new Map<string, string>();
    const listeners = new Map<string, Listener[]>();
    const win = {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      location: { reload: vi.fn() },
      addEventListener: (type: string, fn: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      fire(type: string) {
        const event = { preventDefault: vi.fn() };
        (listeners.get(type) ?? []).forEach(fn => fn(event));
        return event;
      },
    };
    return win;
  }

  it('reloads once, then lets a second failure surface', () => {
    const win = fakeWindow();
    installPreloadErrorRecovery(win as unknown as Window);

    const first = win.fire('vite:preloadError');
    expect(first.preventDefault).toHaveBeenCalled();
    expect(win.location.reload).toHaveBeenCalledTimes(1);

    const second = win.fire('vite:preloadError');
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('clears the guard on a clean start so the next deploy can recover', () => {
    const win = fakeWindow();
    win.sessionStorage.setItem('fintrack:preload-reloaded', '1');
    installPreloadErrorRecovery(win as unknown as Window);
    expect(win.sessionStorage.getItem('fintrack:preload-reloaded')).toBeNull();
  });
});
