import { expect } from '@playwright/test';
import { test, loginViaUi } from './fixtures';

/**
 * Settings visual capture, Phase 6A.
 *
 * Not an assertion suite — its job is to photograph the new control centre at
 * the widths that decide whether it works, so the layout can be reviewed rather
 * than described. The two it exists to prove:
 *
 *   • 390px — the Settings home is now a short section list. Before 6A the
 *     category list alone ran ~800px and pushed Connections and Admin far below
 *     the fold.
 *   • 1440px — two panes. Before 6A this was a 672px column centred in 1440,
 *     leaving more than half the viewport empty.
 *
 * Run on demand:
 *   npx playwright test settings-screenshots --project=chromium
 *
 * Output lands in `e2e/__screenshots__/`.
 */

const API = 'http://127.0.0.1:8000';

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

test('capture Settings across breakpoints', async ({ page, request, registeredUser }) => {
  test.setTimeout(180_000);

  const seedHeaders = { Origin: API };
  const login = await request.post(`${API}/auth/login`, {
    data: { identifier: registeredUser.email, password: registeredUser.password },
    headers: seedHeaders,
  });
  if (!login.ok()) throw new Error(`login ${login.status()}: ${await login.text()}`);

  const post = async (path: string, data: Record<string, unknown>) => {
    const res = await request.post(`${API}${path}`, { data, headers: seedHeaders });
    if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
    return res.json();
  };

  // Signup already seeds ~19 default expense categories, which is exactly the
  // long list that made the old single-column page unusable on a phone — so
  // nothing needs adding to reproduce the problem 6A solves. Two custom ones go
  // in only to photograph a row that *does* carry Edit and Delete beside the
  // default rows that correctly do not.
  await post('/categories', { name: 'Bullion', type: 'investment', color: '#f59e0b' });
  await post('/categories', { name: 'Espresso Machine Fund', type: 'expense', color: '#6366f1' });

  await loginViaUi(page, registeredUser.email, registeredUser.password);

  // ── Mobile: the section list, then two sections ─────────────────────────────
  await page.setViewportSize(MOBILE);
  await page.goto('/settings');
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-01-phone-390-home.png', fullPage: true });

  await page.getByRole('button', { name: /^Categories/ }).click();
  await expect(page.getByText('Espresso Machine Fund')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-02-phone-390-categories.png', fullPage: true });

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Connections/ }).click();
  await expect(page.getByRole('button', { name: /connect bank/i })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-03-phone-390-connections.png', fullPage: true });

  // 320px is the narrowest supported width; the list must not overflow it.
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/settings');
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-04-phone-320-home.png', fullPage: true });

  // ── Tablet: the breakpoint where the two-pane layout takes over ─────────────
  for (const [name, width] of [['05-tablet-768', 768], ['06-laptop-1024', 1024]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/settings');
    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `e2e/__screenshots__/settings-${name}.png`, fullPage: true });
  }

  // ── Desktop: rail plus section ──────────────────────────────────────────────
  await page.setViewportSize(DESKTOP);
  await page.goto('/settings');
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-07-desktop-1440-account.png', fullPage: false });

  await page.getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Categories' }).click();
  await expect(page.getByText('Espresso Machine Fund')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-08-desktop-1440-categories.png', fullPage: false });

  await page.getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Connections' }).click();
  await expect(page.getByRole('button', { name: /connect bank/i })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-09-desktop-1440-connections.png', fullPage: false });

  // Ultrawide: the page must not stretch its content across the whole width.
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-10-ultrawide-1920.png', fullPage: false });

  // --- Category Manager, Phase 6B --------------------------------------------
  // The surface 6B rebuilt: type tabs with totals, search, one "New" button and
  // compact rows behind an overflow menu, instead of an always-open create form
  // above twenty rows carrying two 44px buttons each.

  const openCategories = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.goto('/settings');
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    if (width >= 1024) {
      await nav.getByRole('button', { name: 'Categories' }).click();
    } else {
      await page.getByRole('button', { name: /^Categories/ }).click();
    }
    await expect(page.getByLabel('Search categories')).toBeVisible({ timeout: 10_000 });
  };

  // Phone: list, search results, and both sheets.
  await openCategories(390, 844);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-11-phone-390-category-manager.png', fullPage: true });

  await page.getByLabel('Search categories').fill('e');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-12-phone-390-category-search.png', fullPage: true });

  await page.getByLabel('Search categories').fill('zzzznomatch');
  await expect(page.getByText(/No expense categories match/)).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-13-phone-390-category-no-results.png', fullPage: true });
  await page.getByLabel('Search categories').fill('');

  await page.getByRole('button', { name: '+ New' }).click();
  await expect(page.getByText('New expense category')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-14-phone-390-category-create.png', fullPage: false });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Espresso Machine Fund actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.getByText('Edit expense category')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-15-phone-390-category-edit.png', fullPage: false });
  await page.keyboard.press('Escape');

  // The overflow menu itself, which is what replaced the permanent buttons.
  await page.getByRole('button', { name: 'Espresso Machine Fund actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-16-phone-390-category-row-menu.png', fullPage: false });
  await page.keyboard.press('Escape');

  // Desktop: manager, search state, create modal.
  await openCategories(1440, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-17-desktop-1440-category-manager.png', fullPage: false });

  await page.getByLabel('Search categories').fill('e');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-18-desktop-1440-category-search.png', fullPage: false });
  await page.getByLabel('Search categories').fill('');

  await page.getByRole('button', { name: '+ New' }).click();
  await expect(page.getByText('New expense category')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-19-desktop-1440-category-create.png', fullPage: false });
  await page.keyboard.press('Escape');

  // The manager must not overflow the narrowest supported width either.
  await openCategories(320, 900);
  const managerOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(managerOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'e2e/__screenshots__/settings-20-phone-320-category-manager.png', fullPage: true });

  // ── No horizontal overflow at the narrowest width ───────────────────────────
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/settings');
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
