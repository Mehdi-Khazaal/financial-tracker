import { expect, loginViaUi, test } from './fixtures';

test('PWA shell reloads while offline', async ({ page, context, registeredUser }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);
  await page.goto('/');
  // Wait for the service worker to be installed & active.
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return true;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return !!reg;
  }, undefined, { timeout: 10_000 });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  // At minimum the HTML shell should still resolve — no "This site can't be
  // reached" chrome error page. #root is always present in index.html.
  await expect(page.locator('#root')).toBeAttached();
  await context.setOffline(false);
});
