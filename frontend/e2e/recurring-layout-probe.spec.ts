import { expect } from '@playwright/test';
import { test, loginViaUi, ensureCategory } from './fixtures';

/**
 * Recurring layout probe, at a wide desktop.
 *
 * Measures what screenshots alone argue about: whether the Timeline / Review /
 * Recurring switcher stays in the same place when moving between Transactions
 * and Recurring, whether either page scrolls sideways, and whether a bill's
 * action menu is clipped by its card.
 *
 * Run on demand:
 *   npx playwright test recurring-layout-probe --project=chromium
 */

const API = 'http://127.0.0.1:8000';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

test('recurring layout at desktop width', async ({ page, request, registeredUser }) => {
  test.setTimeout(180_000);
  const headers = { Origin: API };
  const login = await request.post(`${API}/auth/login`, {
    data: { identifier: registeredUser.email, password: registeredUser.password },
    headers,
  });
  expect(login.ok()).toBeTruthy();
  const post = async (path: string, data: Record<string, unknown>) => {
    const res = await request.post(`${API}${path}`, { data, headers });
    if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
    return res.status() === 204 ? null : res.json();
  };

  const checking = await post('/accounts', { name: 'Everyday Checking', type: 'checking', balance: 4200 });
  const names = ['Healthcare', 'Motorcycle', 'Utilities', 'Gas', 'Whish', 'Subscriptions', 'Car Maintenance', 'Gifts', 'Shopping', 'Insurance'];
  const cats: Record<string, { id: number }> = {};
  for (const name of names) {
    cats[name] = await ensureCategory(request, headers, { name, type: 'expense', color: '#F97316' });
  }
  for (const [i, name] of names.entries()) {
    await post('/transactions', { account_id: checking.id, category_id: cats[name].id, amount: -(20 + i * 13), description: `${name} shop ${i}`, transaction_date: daysAgo(1 + (i % 10)) });
  }
  const bills: [string, number, string, number][] = [
    ['Water', -123.3, 'Utilities', 13], ['Duquesne Light Company', -232.04, 'Utilities', 3],
    ['Geico', -75.17, 'Insurance', -12], ['Spotify', -7.48, 'Subscriptions', 7], ['VCO', -377, 'Healthcare', 7],
  ];
  for (const [description, amount, cat, due] of bills) {
    await post('/recurring', { account_id: checking.id, category_id: cats[cat].id, amount, description, period: 'monthly', next_date: daysAgo(-due), is_variable: false });
  }

  await loginViaUi(page, registeredUser.email, registeredUser.password);
  await page.setViewportSize({ width: 1800, height: 820 });

  // The visible Timeline / Review / Recurring switcher, wherever the page puts it.
  const measure = () => page.evaluate(() => {
    const timeline = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Timeline' && (b as HTMLElement).offsetParent !== null);
    const r = timeline?.parentElement?.getBoundingClientRect();
    return {
      tabsLeft: r ? Math.round(r.left) : null,
      tabsTop: r ? Math.round(r.top) : null,
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Review$/ }).first().click();
  await page.waitForTimeout(1200);
  const review = await measure();
  await page.screenshot({ path: 'e2e/__screenshots__/probe-01-review-1800.png' });

  await page.getByRole('button', { name: /^Recurring$/ }).first().click();
  await expect(page).toHaveURL(/\/recurring/);
  await expect(page.getByText(/Recurring in /)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  const recurring = await measure();
  await page.screenshot({ path: 'e2e/__screenshots__/probe-02-recurring-1800.png' });

  // Open the action menu on a bill in the middle of the page.
  const trigger = page.getByRole('button', { name: /Geico actions/i }).last();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('[role="menu"]');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const items = Array.from(m.querySelectorAll('[role="menuitem"]')).map(i => {
      const b = i.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { label: i.textContent?.trim(), visible: !!hit && (hit === i || i.contains(hit)) };
    });
    return { top: Math.round(r.top), height: Math.round(r.height), items };
  });
  await page.screenshot({ path: 'e2e/__screenshots__/probe-03-recurring-menu-1800.png' });

  // ── Every menu action, through the UI ───────────────────────────────────────
  const openMenu = async (bill: RegExp) => {
    const t = page.getByRole('button', { name: bill }).last();
    await t.scrollIntoViewIfNeeded();
    await t.click();
  };

  // Move: Geico → Other.
  await page.getByRole('menuitem', { name: /Move to group/i }).click();
  await page.getByRole('radio', { name: /^Other$/ }).click();
  await expect(page.locator('section[aria-labelledby="recurring-group-other"]').getByText('Geico')).toBeVisible({ timeout: 10_000 });

  // Edit: Spotify amount → 9.99.
  await openMenu(/Spotify actions/i);
  await page.getByRole('menuitem', { name: /^Edit$/ }).click();
  await page.locator('#edit-bill-amount').fill('9.99');
  await page.getByRole('button', { name: /Save changes/i }).click();
  await expect(page.locator('section[aria-labelledby="recurring-group-subscriptions"]').getByText('$9.99').first()).toBeVisible({ timeout: 10_000 });

  // Pause: Water → Paused section.
  await openMenu(/Water actions/i);
  await page.getByRole('menuitem', { name: /^Pause$/ }).click();
  await expect(page.getByRole('button', { name: /Paused · 1/ })).toBeVisible({ timeout: 10_000 });

  // Delete: VCO, confirmed.
  await openMenu(/VCO actions/i);
  await page.getByRole('menuitem', { name: /^Delete$/ }).click();
  await page.getByRole('button', { name: /^Confirm$/ }).click();
  await expect(page.getByRole('button', { name: /VCO actions/i })).toHaveCount(0, { timeout: 10_000 });

  await page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollTo(0, 0));
  await page.screenshot({ path: 'e2e/__screenshots__/probe-04-recurring-after-actions-1800.png' });

  console.log(JSON.stringify({ review, recurring, menu }, null, 2));
});
