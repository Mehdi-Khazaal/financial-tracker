import { expect, loginViaUi, test } from './fixtures';

// The service worker in public/sw.js intentionally does NOT cache navigation
// (HTML) requests — see the long comment in that file. Caching index.html
// would pin the installed PWA to a stale fingerprinted JS bundle after we
// deploy new code. Because of that, `page.reload()` while offline is
// expected to fail with net::ERR_FAILED. Instead, this smoke test just
// verifies the service worker registers and takes control of the page.
test('service worker registers and controls the page', async ({ page, registeredUser }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);
  await page.goto('/');

  const controlled = await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return !!reg && !!reg.active;
  }, undefined, { timeout: 15_000 });

  expect(await controlled.jsonValue()).toBe(true);
});

