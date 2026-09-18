import { ensureCategory, expect, loginViaUi, test } from './fixtures';

/**
 * Budgets end to end: set one from the Overview card, see it in the sheet
 * with this month's spend against it, then remove it.
 */
test('set, see and remove a budget from the dashboard', async ({ page, registeredUser, request }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);

  const cookies = await page.context().cookies();
  const headers = {
    Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
  };
  const accountRes = await request.post('http://127.0.0.1:8000/accounts', {
    headers, data: { name: 'Checking', type: 'checking', balance: 1000, currency: 'USD' },
  });
  expect([200, 201]).toContain(accountRes.status());
  const account = await accountRes.json();
  const groceries = await ensureCategory(request, headers, { name: 'Groceries', type: 'expense', color: '#f5a623' });
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const txRes = await request.post('http://127.0.0.1:8000/transactions', {
    headers, data: { account_id: account.id, category_id: groceries.id, amount: -60, description: 'Market', transaction_date: iso },
  });
  expect([200, 201]).toContain(txRes.status());

  await page.goto('/');
  await page.getByRole('button', { name: 'Set a budget →' }).first().click();

  const sheet = page.getByRole('dialog').filter({ hasText: 'New budget' });
  await sheet.getByLabel('Category').selectOption({ label: 'Groceries' });
  await sheet.getByLabel('Monthly amount').fill('400');
  await sheet.getByRole('button', { name: 'Set budget' }).click();

  await expect(sheet.getByText('$60.00 of $400.00')).toBeVisible({ timeout: 10_000 });

  await sheet.getByRole('button', { name: 'Remove Groceries budget' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.getByText('No budgets yet. Pick a category above.')).toBeVisible({ timeout: 10_000 });
});
