/**
 * Service-worker registration with a real "new version" signal.
 *
 * `public/sw.js` is hand-written and activates immediately (`skipWaiting` +
 * `clients.claim`). That keeps the cache honest, but it also means a deploy
 * that lands while the app is open leaves the page running the *previous*
 * bundle: lazily loaded routes then ask for chunk hashes that no longer
 * exist. Two things fix that here:
 *
 * 1. When a new worker finishes installing while a page is already
 *    controlled, `UPDATE_EVENT` is dispatched on `window`. `UpdatePrompt`
 *    listens and offers a reload.
 * 2. If a dynamic import fails anyway (Vite's `vite:preloadError`), the page
 *    reloads once. A session flag stops a broken deploy from looping.
 *
 * Everything is a plain function so the logic is testable without a browser.
 */

export const UPDATE_EVENT = 'fintrack:sw-update';
const PRELOAD_RELOAD_FLAG = 'fintrack:preload-reloaded';
// How often an open tab asks the browser to look for a newer worker. Browsers
// only check on navigation by themselves, and a PWA can stay open for days.
const UPDATE_CHECK_MS = 30 * 60 * 1000;

export function notifyUpdateAvailable(target: EventTarget = window): void {
  target.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

/** Wire `updatefound` on a registration and report a fresh worker once installed. */
export function watchForUpdates(
  registration: ServiceWorkerRegistration,
  container: Pick<ServiceWorkerContainer, 'controller'> = navigator.serviceWorker,
  notify: () => void = () => notifyUpdateAvailable(),
): void {
  // A worker already waiting means a deploy landed while the app was closed
  // and the browser fetched it on this navigation.
  if (registration.waiting && container.controller) notify();

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      // `installed` with an existing controller means "there was an old
      // worker and this is a new one" — a first install never prompts.
      if (worker.state === 'installed' && container.controller) notify();
    });
  });
}

/** Reload once when a lazily loaded chunk 404s after a deploy. */
export function installPreloadErrorRecovery(win: Window = window): void {
  win.addEventListener('vite:preloadError', event => {
    let alreadyReloaded = false;
    try {
      alreadyReloaded = win.sessionStorage.getItem(PRELOAD_RELOAD_FLAG) === '1';
      if (!alreadyReloaded) win.sessionStorage.setItem(PRELOAD_RELOAD_FLAG, '1');
    } catch {
      // Storage can be unavailable (private mode); a single reload is still safe.
    }
    if (alreadyReloaded) return; // let the error surface rather than loop
    event.preventDefault();
    win.location.reload();
  });
  // A successful load clears the flag so the *next* deploy can recover too.
  try {
    win.sessionStorage.removeItem(PRELOAD_RELOAD_FLAG);
  } catch {
    /* ignore */
  }
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(registration => {
        watchForUpdates(registration);
        const check = () => {
          registration.update().catch(() => {});
        };
        window.setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
      })
      .catch(err => console.warn('SW registration failed:', err));
  });
}
