import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { ensureCategory, expect, loginViaUi, test } from './fixtures';

/**
 * Automated accessibility pass: every main page, signed out and signed in,
 * at a phone width and a desktop width, checked by axe against WCAG 2.2 A/AA.
 *
 * It fails on `serious` and `critical` findings. `moderate`/`minor` ones are
 * printed so they stay visible without blocking. Automated checks catch
 * roughly a third of real problems — labels, names, contrast, landmarks — so
 * this is a floor, not a certificate.
 */

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const SIGNED_OUT = ['/', '/login', '/signup', '/privacy'];
const SIGNED_IN = [
  '/',
  '/?tab=analytics',
  '/transactions?tab=list',
  '/transactions?tab=transactions',
  '/accounts',
  '/portfolio',
  '/recurring',
  '/settings?tab=account',
  '/settings?tab=preferences',
  '/settings?tab=rules',
  '/settings?tab=categories',
  '/assistant',
];

type Finding = { page: string; width: string; id: string; impact: string; help: string; targets: string[] };

async function scan(page: Page, path: string, width: string): Promise<Finding[]> {
  await page.goto(path);
  await expect(page.locator('main, [role="main"], form').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(700); // let lazy chunks and first fetches settle
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  // Reflow (WCAG 1.4.10): nothing may push the page sideways at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const reflow: Finding[] = overflow > 0
    ? [{ page: path, width, id: 'horizontal-overflow', impact: 'serious', help: `Page is ${overflow}px wider than the viewport`, targets: [] }]
    : [];
  return [...reflow, ...results.violations.map(v => ({
    page: path,
    width,
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    targets: v.nodes.slice(0, 4).map(n => `${n.target.join(' ')}${v.id === 'color-contrast' ? ` — ${(n.any[0]?.message ?? '').replace(/\s+/g, ' ')}` : ''}`),
  }))];
}

function report(findings: Finding[]) {
  for (const f of findings) {
    console.log(`[a11y] ${f.impact.padEnd(8)} ${f.id} @ ${f.page} (${f.width}): ${f.help}\n        ${f.targets.join('\n        ')}`);
  }
  return findings.filter(f => f.impact === 'serious' || f.impact === 'critical');
}

test('signed-out pages meet WCAG 2.2 AA (serious and critical)', async ({ page }) => {
  test.setTimeout(120_000);
  const findings: Finding[] = [];
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const path of SIGNED_OUT) findings.push(...await scan(page, path, size.name));
  }
  expect(report(findings)).toEqual([]);
});

test('signed-in pages meet WCAG 2.2 AA (serious and critical)', async ({ page, registeredUser, request }) => {
  test.setTimeout(240_000);
  await loginViaUi(page, registeredUser.email, registeredUser.password);
  const cookies = await page.context().cookies();
  const headers = {
    Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
  };
  // Enough data that every page renders its real content, not only empty states.
  const account = await (await request.post('http://127.0.0.1:8000/accounts', {
    headers, data: { name: 'Checking', type: 'checking', balance: 2400, currency: 'USD' },
  })).json();
  const groceries = await ensureCategory(request, headers, { name: 'Groceries', type: 'expense', color: '#f5a623' });
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (const [description, amount, category] of [['Market', -64.2, groceries.id], ['Payroll', 3200, null], ['NETFLIX.COM', -15.99, null]] as const) {
    await request.post('http://127.0.0.1:8000/transactions', {
      headers, data: { account_id: account.id, category_id: category, amount, description, transaction_date: iso(today) },
    });
  }
  await request.post('http://127.0.0.1:8000/budgets', { headers, data: { category_id: groceries.id, amount: '300' } });
  await request.post('http://127.0.0.1:8000/rules', { headers, data: { category_id: groceries.id, pattern: 'market' } });

  const findings: Finding[] = [];
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const path of SIGNED_IN) findings.push(...await scan(page, path, size.name));
  }
  expect(report(findings)).toEqual([]);
});

test('sheets and dialogs added in Phase 4 meet WCAG 2.2 AA, and look right', async ({ page, registeredUser, request }) => {
  test.setTimeout(240_000);
  await loginViaUi(page, registeredUser.email, registeredUser.password);
  const cookies = await page.context().cookies();
  const headers = {
    Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
  };
  const account = await (await request.post('http://127.0.0.1:8000/accounts', {
    headers, data: { name: 'Checking', type: 'checking', balance: 2400, currency: 'USD' },
  })).json();
  const groceries = await ensureCategory(request, headers, { name: 'Groceries', type: 'expense', color: '#f5a623' });
  await ensureCategory(request, headers, { name: 'Household', type: 'expense', color: '#6366f1' });
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await request.post('http://127.0.0.1:8000/transactions', {
    headers, data: { account_id: account.id, category_id: groceries.id, amount: -100, description: 'WAREHOUSE CLUB', transaction_date: iso },
  });
  await request.post('http://127.0.0.1:8000/budgets', { headers, data: { category_id: groceries.id, amount: '300' } });

  const shot = async (name: string) => {
    await page.screenshot({ path: `e2e/__screenshots__/phase5/${name}.png`, fullPage: false });
  };
  const findings: Finding[] = [];
  const check = async (label: string, width: string) => {
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    findings.push(...results.violations.map(v => ({
      page: label, width, id: v.id, impact: v.impact ?? 'unknown', help: v.help,
      targets: v.nodes.slice(0, 4).map(n => `${n.target.join(' ')}${v.id === 'color-contrast' ? ` — ${(n.any[0]?.message ?? '').replace(/\s+/g, ' ')}` : ''}`),
    })));
    await shot(`${label}-${width}`);
  };

  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });

    await page.goto('/');
    await expect(page.getByText('Budgets').first()).toBeVisible({ timeout: 10_000 });
    await check('overview', size.name);
    await page.getByRole('button', { name: 'Manage →' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await check('budgets-sheet', size.name);
    await page.keyboard.press('Escape');

    await page.goto('/transactions?tab=list&import=1');
    await expect(page.getByRole('dialog').filter({ hasText: 'Import CSV' })).toBeVisible({ timeout: 10_000 });
    await check('import-sheet', size.name);
    await page.keyboard.press('Escape');

    await page.goto('/transactions?tab=list');
    await page.getByText('WAREHOUSE CLUB').first().click();
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(page.getByLabel('Split transaction')).toBeVisible();
    await check('split-editor', size.name);
    await page.keyboard.press('Escape');

    await page.goto('/settings?tab=rules&pattern=warehouse');
    await expect(page.getByRole('form', { name: 'New rule' })).toBeVisible({ timeout: 10_000 });
    await check('rule-sheet', size.name);
    await page.keyboard.press('Escape');

    await page.goto('/settings?tab=account');
    await page.getByRole('button', { name: 'Set up two-factor' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await check('two-factor-setup', size.name);

    await page.goto('/settings?tab=preferences');
    await expect(page.getByRole('switch', { name: 'Low balance alerts' })).toBeVisible({ timeout: 10_000 });
    await check('preferences-alerts', size.name);

    await page.goto('/');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Control+k'); // the shortcut works at every width
    await page.getByPlaceholder('Type a command or search…').fill('netf');
    await check('command-palette', size.name);
    await page.keyboard.press('Escape');
  }
  expect(report(findings)).toEqual([]);
});
