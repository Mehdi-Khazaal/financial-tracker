import { expect } from '@playwright/test';
import { test, loginViaUi } from './fixtures';

/**
 * Page headers clear the fixed top bar.
 *
 * Search, privacy and the account menu float over the top-right corner, and
 * every page header reserves room for them (`.topbar-safe`). The reserve was a
 * fixed 10rem; once the bar's buttons grew to the 44px hit size it fell 4px
 * short, and on Transactions the "Add" button ran under the search button.
 * This measures the real layout at a desktop and a phone width.
 */

const PAGES = ['/', '/transactions', '/recurring', '/accounts', '/portfolio', '/settings'];
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1707, height: 900 },
  { width: 390, height: 844 },
];

test('page header controls never sit under the top bar', async ({ page, registeredUser }) => {
  test.setTimeout(120_000);
  await loginViaUi(page, registeredUser.email, registeredUser.password);

  const overlaps: string[] = [];
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const path of PAGES) {
      await page.goto(path);
      await page.locator('.app-topbar').waitFor();
      await page.locator('.topbar-safe').first().waitFor();
      const found = await page.evaluate(() => {
        const bar = document.querySelector('.app-topbar')!.getBoundingClientRect();
        const hits: string[] = [];
        document.querySelectorAll('.topbar-safe').forEach(header => {
          header.querySelectorAll('button, a, input').forEach(control => {
            const r = control.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            const sameRow = r.bottom > bar.top && r.top < bar.bottom;
            if (sameRow && r.right > bar.left - 4) {
              hits.push(`${(control.textContent || control.getAttribute('aria-label') || control.tagName).trim().slice(0, 20)} ends at ${Math.round(r.right)}, bar starts at ${Math.round(bar.left)}`);
            }
          });
        });
        return hits;
      });
      overlaps.push(...found.map(hit => `${size.width}px ${path}: ${hit}`));
    }
  }

  expect(overlaps).toEqual([]);
});
