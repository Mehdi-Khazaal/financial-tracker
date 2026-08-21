import { expect } from '@playwright/test';
import { test, loginViaUi, ensureCategory } from './fixtures';

/**
 * Dashboard visual capture.
 *
 * Not an assertion suite — its job is to seed a realistic account and
 * photograph the Overview tab at the widths that matter, so a layout change can
 * be reviewed rather than described. Seeded through the API so the data is
 * deterministic: the same shapes every run, dated relative to today so the
 * month-to-date figures are always mid-month.
 *
 * Run on demand:
 *   npx playwright test dashboard-screenshots --project=chromium
 *
 * Output lands in `e2e/__screenshots__/`.
 */

const API = 'http://127.0.0.1:8000';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** `daysAgo(3)` → an ISO date three days before today, local. */
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

/** First day of the month `n` months back. */
const monthsBack = (n: number, day = 5) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(day);
  return iso(d);
};

const VIEWPORTS = [
  { name: '01-desktop-1440', width: 1440, height: 1200 },
  { name: '02-laptop-1024', width: 1024, height: 1100 },
  { name: '03-tablet-768', width: 768, height: 1200 },
  { name: '04-phone-390', width: 390, height: 1400 },
  { name: '05-phone-320', width: 320, height: 1500 },
];

test('capture the dashboard across breakpoints', async ({ page, request, registeredUser }) => {
  test.setTimeout(180_000);

  // ── Authenticate against the API for seeding ────────────────────────────────
  // `/auth/login` sets httpOnly cookies rather than returning a token, and the
  // Playwright request context keeps its own cookie jar, so every seeding call
  // below is authenticated by virtue of this one succeeding.
  // `BrowserOriginMiddleware` rejects cookie-authenticated state changes from
  // an untrusted origin, and always trusts the API's own. Sending that keeps
  // the seeding independent of whatever CORS list the environment is using.
  const seedHeaders = { Origin: API };

  const login = await request.post(`${API}/auth/login`, {
    data: { identifier: registeredUser.email, password: registeredUser.password },
    headers: seedHeaders,
  });
  if (!login.ok()) {
    throw new Error(`login ${login.status()}: ${await login.text()}`);
  }

  const post = async (path: string, data: Record<string, unknown>) => {
    const res = await request.post(`${API}${path}`, { data, headers: seedHeaders });
    if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
    return res.json();
  };

  // ── Accounts ────────────────────────────────────────────────────────────────
  const checking = await post('/accounts', { name: 'Everyday Checking', type: 'checking', balance: 6482.19 });
  const savings = await post('/accounts', { name: 'Emergency Fund', type: 'savings', balance: 12400 });
  const card = await post('/accounts', { name: 'Venture Card', type: 'credit_card', balance: -213.37, credit_limit: 6000 });
  await post('/accounts', { name: 'Cash', type: 'cash', balance: 180 });

  // ── Categories ──────────────────────────────────────────────────────────────
  const groceries = await ensureCategory(request, seedHeaders, { name: 'Groceries', type: 'expense', color: '#22C55E' });
  const rent = await ensureCategory(request, seedHeaders, { name: 'Rent', type: 'expense', color: '#F97316' });
  const dining = await ensureCategory(request, seedHeaders, { name: 'Dining', type: 'expense', color: '#3B82F6' });
  const transport = await ensureCategory(request, seedHeaders, { name: 'Transport', type: 'expense', color: '#a855f7' });
  const salary = await ensureCategory(request, seedHeaders, { name: 'Salary', type: 'income', color: '#22C55E' });

  // ── Four completed months, so pace and projection have a baseline ───────────
  for (let m = 1; m <= 4; m += 1) {
    await post('/transactions', { account_id: checking.id, category_id: salary.id, amount: 5200, description: 'ACME PAYROLL', transaction_date: monthsBack(m, 1) });
    await post('/transactions', { account_id: checking.id, category_id: rent.id, amount: -1850, description: 'Landlord', transaction_date: monthsBack(m, 2) });
    await post('/transactions', { account_id: card.id, category_id: groceries.id, amount: -430 - m * 12, description: 'WHOLE FOODS MKT', transaction_date: monthsBack(m, 9) });
    await post('/transactions', { account_id: card.id, category_id: dining.id, amount: -180 - m * 8, description: 'Various restaurants', transaction_date: monthsBack(m, 14) });
    await post('/transactions', { account_id: checking.id, category_id: transport.id, amount: -120, description: 'SHELL OIL', transaction_date: monthsBack(m, 18) });
    await post('/transactions', { account_id: card.id, category_id: groceries.id, amount: 34.2, description: 'WHOLE FOODS MKT REFUND', transaction_date: monthsBack(m, 21) });
  }

  // ── This month, including the last week ─────────────────────────────────────
  await post('/transactions', { account_id: checking.id, category_id: salary.id, amount: 5200, description: 'ACME PAYROLL', transaction_date: daysAgo(2) });
  await post('/transactions', { account_id: checking.id, category_id: rent.id, amount: -1850, description: 'Landlord', transaction_date: daysAgo(9) });
  await post('/transactions', { account_id: card.id, category_id: groceries.id, amount: -164.22, description: 'WHOLE FOODS MKT', transaction_date: daysAgo(4) });
  await post('/transactions', { account_id: card.id, category_id: dining.id, amount: -86.4, description: 'SQ *THE LONG NAMED COFFEE ROASTERY', transaction_date: daysAgo(3) });
  await post('/transactions', { account_id: card.id, category_id: null, amount: -41.9, description: 'AMZN Mktp US*A12BC', transaction_date: daysAgo(1) });
  await post('/transactions', { account_id: checking.id, category_id: transport.id, amount: -412.5, description: 'CITY GARAGE SERVICE', transaction_date: daysAgo(5) });
  await post('/transactions', { account_id: card.id, category_id: null, amount: -15.99, description: 'NETFLIX.COM', transaction_date: daysAgo(6) });
  await post('/transactions', { account_id: checking.id, category_id: null, amount: 300, description: 'Payment to Venture Card', transaction_date: daysAgo(7) });

  // ── Commitments and goals ───────────────────────────────────────────────────
  await post('/recurring', { account_id: card.id, category_id: null, amount: -15.99, description: 'NETFLIX.COM', period: 'monthly', next_date: daysAgo(-3), is_variable: false });
  await post('/recurring', { account_id: checking.id, category_id: rent.id, amount: -1850, description: 'Landlord', period: 'monthly', next_date: daysAgo(-21), is_variable: false });
  await post('/recurring', { account_id: checking.id, category_id: salary.id, amount: 5200, description: 'ACME PAYROLL', period: 'monthly', next_date: daysAgo(-28), is_variable: false });

  await post('/savings-goals', { name: 'Summer 2027', target_amount: 20000, account_id: savings.id, deadline: '2027-06-01' });
  await post('/savings-goals', { name: 'Education', target_amount: 8000, account_id: savings.id });

  await post('/assets', { name: 'Gold (1oz)', type: 'gold', asset_class: 'investment', quantity: 3, value_per_unit: 2380, total_value: 7140, currency: 'USD' });
  await post('/assets', { name: 'Vanguard ETF (VTI)', type: 'etf', asset_class: 'investment', quantity: 40, value_per_unit: 268.4, total_value: 10736, currency: 'USD' });
  await post('/assets', { name: 'Toyota Corolla', type: 'vehicle', asset_class: 'physical', total_value: 14200, currency: 'USD' });

  // ── Capture ─────────────────────────────────────────────────────────────────
  await loginViaUi(page, registeredUser.email, registeredUser.password);
  await page.goto('/');
  await expect(page.locator('#overview-net-worth-label')).toBeVisible({ timeout: 20_000 });

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Let the count-up and sparkline settle so the capture is not mid-animation.
    await page.waitForTimeout(1600);
    await page.screenshot({
      path: `e2e/__screenshots__/dashboard-${vp.name}.png`,
      fullPage: true,
    });
  }

  // Viewport-only shot of the top of the page. A full-page capture stitches
  // scroll positions and drops `position: sticky` elements, so the desktop
  // Overview/Analytics switcher is absent from every fullPage image above even
  // though it renders correctly. This is the honest view of it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'e2e/__screenshots__/dashboard-07-desktop-top-viewport.png', fullPage: false });

  // ── Accounts, the Phase B surface ───────────────────────────────────────────
  for (const vp of [
    { name: '08-accounts-desktop-1440', width: 1440, height: 1100 },
    { name: '09-accounts-phone-390', width: 390, height: 1200 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/accounts');
    await expect(page.getByText('Net worth').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `e2e/__screenshots__/dashboard-${vp.name}.png`, fullPage: true });
  }

  // Cards tab, where two implementations became one.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/accounts');
  await page.getByRole('button', { name: /^Cards$/ }).first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'e2e/__screenshots__/dashboard-10-accounts-cards-1440.png', fullPage: true });

  // ── Portfolio, the Phase C surface ──────────────────────────────────────────
  for (const [name, tab] of [['11-portfolio-investments', 'Investments'], ['12-portfolio-savings', 'Savings']] as const) {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/portfolio');
    await expect(page.getByText('Net worth over time')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: new RegExp(`^${tab}$`) }).first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `e2e/__screenshots__/dashboard-${name}-1440.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 1400 });
  await page.goto('/portfolio');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/__screenshots__/dashboard-13-portfolio-phone-390.png', fullPage: true });

  await page.goto('/');
  // Landscape, the tightest vertical case on mobile.
  await page.setViewportSize({ width: 740, height: 360 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'e2e/__screenshots__/dashboard-06-landscape-740x360.png', fullPage: false });
});
