import { expect } from '@playwright/test';
import { test, loginViaUi } from './fixtures';

/**
 * Connection-health visual capture, Phase 6C-2.
 *
 * The e2e backend has no Plaid connection and no Plaid credentials, so the
 * health states cannot be produced end-to-end. Both endpoints are therefore
 * stubbed **at the network layer** and the real components render the real
 * response shapes — no component is mocked, and nothing here touches Plaid.
 *
 * Stubbing rather than seeding is also the only honest option: creating a
 * `PlaidItem` requires exchanging a public token with the live Plaid API, which
 * this phase must not do.
 *
 * Run on demand:
 *   npx playwright test connections-health --project=chromium
 */

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const ITEMS = [
  { id: 5, institution_name: 'Capital One', created_at: '2026-05-31T00:00:00Z' },
  { id: 6, institution_name: 'PNC', created_at: '2026-05-31T00:00:00Z' },
  { id: 7, institution_name: 'Chase', created_at: '2026-07-14T00:00:00Z' },
];

const baseHealth = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  institution_name: ITEMS.find(i => i.id === id)?.institution_name ?? null,
  connected_at: '2026-05-31T00:00:00Z',
  cursor_initialized: true,
  fintrack_last_webhook_at: minutesAgo(10),
  fintrack_last_webhook_code: 'SYNC_UPDATES_AVAILABLE',
  last_sync_at: minutesAgo(8),
  last_sync_source: 'webhook',
  last_sync_ok: true,
  last_sync_error: null,
  last_added_count: 3,
  last_modified_count: 0,
  last_removed_count: 0,
  reachable: true,
  item_error_code: null,
  item_error_type: null,
  login_repair_required: false,
  consent_expiration_time: null,
  plaid_last_successful_update: minutesAgo(11),
  plaid_last_failed_update: null,
  plaid_last_webhook_sent_at: minutesAgo(10),
  plaid_last_webhook_code: 'SYNC_UPDATES_AVAILABLE',
  ...over,
});

const HEALTH = {
  items: [
    baseHealth(5),
    // The one state that warrants prominence.
    baseHealth(6, { login_repair_required: true, item_error_code: 'ITEM_LOGIN_REQUIRED' }),
    // A legacy connection: cursor established, but nothing ever recorded.
    baseHealth(7, {
      last_sync_at: null,
      last_sync_ok: null,
      last_sync_source: null,
      fintrack_last_webhook_at: null,
      last_added_count: null,
    }),
  ],
};

test('capture Connections health states', async ({ page, registeredUser }) => {
  test.setTimeout(120_000);

  await page.route('**/plaid/items', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ITEMS) }));
  await page.route('**/plaid/sync-health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HEALTH) }));

  await loginViaUi(page, registeredUser.email, registeredUser.password);

  const openConnections = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.goto('/settings');
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    if (width >= 1024) {
      await nav.getByRole('button', { name: 'Connections' }).click();
    } else {
      await page.getByRole('button', { name: /^Connections/ }).click();
    }
    // Two of the three are healthy — the legacy connection included.
    await expect(page.getByText('Healthy').first()).toBeVisible({ timeout: 10_000 });
  };

  // --- Mobile ---------------------------------------------------------------
  await openConnections(390, 844);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/connections-01-phone-390-health.png', fullPage: true });

  await page.getByRole('button', { name: /details/i }).first().click();
  await expect(page.getByText('Last update from your bank').first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/__screenshots__/connections-02-phone-390-details.png', fullPage: true });

  // --- Desktop --------------------------------------------------------------
  await openConnections(1440, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/connections-03-desktop-1440-health.png', fullPage: false });

  await page.getByRole('button', { name: /details/i }).first().click();
  await expect(page.getByText('Last update from your bank').first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/__screenshots__/connections-04-desktop-1440-details.png', fullPage: false });

  // --- The dock must not cover the last thing on the page --------------------
  // Asserted rather than eyeballed: a `fullPage` capture stitches scroll
  // positions and paints fixed elements at their viewport offset, so the dock
  // *appears* to overlap mid-page in those images even when it does not. The
  // only honest check is geometry at the real scroll position.
  await openConnections(390, 844);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  const resetBox = await page.getByRole('button', { name: /reset & start fresh/i }).boundingBox();
  const dockBox = await page.locator('.mobile-dock-shell').first().boundingBox();
  expect(resetBox).not.toBeNull();
  if (resetBox && dockBox) {
    // The bottom of the last control sits above the top of the dock.
    expect(resetBox.y + resetBox.height).toBeLessThanOrEqual(dockBox.y + 1);
  }
  await page.screenshot({ path: 'e2e/__screenshots__/connections-07-phone-390-bottom.png', fullPage: false });

  // --- Degraded: diagnostics unavailable, banks still listed ----------------
  await page.route('**/plaid/sync-health', route => route.fulfill({ status: 502, body: '{}' }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings');
  await page.getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Connections' }).click();
  await expect(page.getByText(/status could not be checked/i)).toBeVisible({ timeout: 10_000 });
  // The banks must still be listed — a failed diagnostic may never hide them.
  await expect(page.getByText('Capital One').first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/__screenshots__/connections-05-desktop-1440-degraded.png', fullPage: false });

  // --- Narrowest supported width --------------------------------------------
  await page.unroute('**/plaid/sync-health');
  await page.route('**/plaid/sync-health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HEALTH) }));
  await openConnections(320, 900);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'e2e/__screenshots__/connections-06-phone-320-health.png', fullPage: true });
});
