import { expect } from '@playwright/test';
import { test, loginViaUi, ensureCategory } from './fixtures';

/**
 * Recurring page visual capture.
 *
 * Seeds charge history that the server should recognise as recurring — a fixed
 * subscription, a utility whose amount swings, a quarterly insurance premium and
 * a biweekly paycheck — photographs the suggestions, tracks some of them, and
 * photographs the organised result plus the Overview tile.
 *
 * Run on demand:
 *   npx playwright test recurring-screenshots --project=chromium
 *
 * Output lands in `e2e/__screenshots__/`.
 */

const API = 'http://127.0.0.1:8000';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

test('capture the recurring page', async ({ page, request, registeredUser }) => {
  test.setTimeout(180_000);
  const headers = { Origin: API };

  const login = await request.post(`${API}/auth/login`, {
    data: { identifier: registeredUser.email, password: registeredUser.password },
    headers,
  });
  if (!login.ok()) throw new Error(`login ${login.status()}: ${await login.text()}`);

  const post = async (path: string, data: Record<string, unknown>) => {
    const res = await request.post(`${API}${path}`, { data, headers });
    if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
    return res.status() === 204 ? null : res.json();
  };

  const checking = await post('/accounts', { name: 'Everyday Checking', type: 'checking', balance: 6482.19 });
  const card = await post('/accounts', { name: 'Venture Card', type: 'credit_card', balance: -213.37, credit_limit: 6000 });
  const utilities = await ensureCategory(request, headers, { name: 'Utilities', type: 'expense', color: '#F59E0B' });
  const rent = await ensureCategory(request, headers, { name: 'Rent', type: 'expense', color: '#F97316' });
  const salary = await ensureCategory(request, headers, { name: 'Salary', type: 'income', color: '#22C55E' });

  // Monthly history, oldest first, dated a few days before today each month.
  const power = [-84.1, -131.62, -102.4];
  for (let m = 3; m >= 1; m -= 1) {
    const offset = m * 30 + 4;
    await post('/transactions', { account_id: card.id, amount: -15.49, description: 'NETFLIX.COM', transaction_date: daysAgo(offset) });
    await post('/transactions', { account_id: card.id, amount: -11.99, description: 'SPOTIFY USA', transaction_date: daysAgo(offset - 2) });
    await post('/transactions', { account_id: checking.id, category_id: utilities.id, amount: power[3 - m], description: 'CITY POWER & LIGHT', transaction_date: daysAgo(offset - 6) });
    await post('/transactions', { account_id: checking.id, amount: -85, description: 'VERIZON WIRELESS', transaction_date: daysAgo(offset - 9) });
    await post('/transactions', { account_id: checking.id, category_id: rent.id, amount: -1850, description: 'Landlord', transaction_date: daysAgo(offset - 3) });
  }
  // Quarterly insurance: two premiums three months apart.
  await post('/transactions', { account_id: checking.id, amount: -412, description: 'GEICO AUTO', transaction_date: daysAgo(100) });
  await post('/transactions', { account_id: checking.id, amount: -412, description: 'GEICO AUTO', transaction_date: daysAgo(9) });
  // Biweekly pay.
  for (const n of [42, 28, 14]) {
    await post('/transactions', { account_id: checking.id, category_id: salary.id, amount: 2600, description: 'ACME PAYROLL', transaction_date: daysAgo(n) });
  }
  // A shop visited monthly at varying amounts — must not be suggested.
  for (const [n, amount] of [[95, -38.2], [63, -91.4], [33, -22.75]] as const) {
    await post('/transactions', { account_id: card.id, amount, description: 'CORNER BISTRO', transaction_date: daysAgo(n) });
  }

  // Rent is tracked by hand and due in two days, so "Needs attention" has content.
  await post('/recurring', { account_id: checking.id, category_id: rent.id, amount: -1850, description: 'Rent', period: 'monthly', next_date: daysAgo(-2), is_variable: false });

  await loginViaUi(page, registeredUser.email, registeredUser.password);

  // ── Before: suggestions ─────────────────────────────────────────────────────
  for (const vp of [
    { name: '01-suggestions-desktop-1280', width: 1280, height: 1600 },
    { name: '02-suggestions-phone-390', width: 390, height: 2200 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/recurring');
    await expect(page.getByText('Found in your transactions')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `e2e/__screenshots__/recurring-${vp.name}.png`, fullPage: true });
  }

  // ── Track most suggestions through the API, as the Track button does ───────
  const overview = await (await request.get(`${API}/recurring/overview`, { headers })).json();
  const names: string[] = overview.suggestions.map((s: { name: string }) => s.name);
  expect(names.join(' ')).not.toMatch(/bistro/i);
  for (const s of overview.suggestions.filter((x: { name: string }) => !/spotify/i.test(x.name))) {
    await post('/recurring/suggestions/confirm', { identity: s.identity });
  }

  // ── After: organised ────────────────────────────────────────────────────────
  for (const vp of [
    { name: '03-tracked-desktop-1280', width: 1280, height: 1800 },
    { name: '04-tracked-phone-390', width: 390, height: 2600 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/recurring');
    await expect(page.getByText(/Recurring in /)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `e2e/__screenshots__/recurring-${vp.name}.png`, fullPage: true });
  }

  // Move sheet.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('button', { name: /Verizon.*actions/i }).first().click();
  await page.getByRole('menuitem', { name: /Move to group/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/__screenshots__/recurring-05-move-sheet-phone-390.png' });
  await page.keyboard.press('Escape');

  // ── Overview tile ───────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/');
  await expect(page.getByText('Bills this month')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/__screenshots__/recurring-06-overview-1280.png', fullPage: true });
});
