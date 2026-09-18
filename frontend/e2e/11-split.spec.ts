import { ensureCategory, expect, loginViaUi, test } from './fixtures';

/** Split one shop across two categories from the transaction sheet. */
test('split a transaction across two categories', async ({ page, registeredUser, request }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);

  const cookies = await page.context().cookies();
  const headers = {
    Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
  };
  const account = await (await request.post('http://127.0.0.1:8000/accounts', {
    headers, data: { name: 'Checking', type: 'checking', balance: 1000, currency: 'USD' },
  })).json();
  const groceries = await ensureCategory(request, headers, { name: 'Groceries', type: 'expense', color: '#f5a623' });
  const household = await ensureCategory(request, headers, { name: 'Household', type: 'expense', color: '#6366f1' });
  const created = await request.post('http://127.0.0.1:8000/transactions', {
    headers, data: { account_id: account.id, category_id: groceries.id, amount: -100, description: 'WAREHOUSE CLUB', transaction_date: '2026-03-02' },
  });
  expect([200, 201]).toContain(created.status());
  const tx = await created.json();

  await page.goto('/transactions?tab=list');
  await page.getByText('WAREHOUSE CLUB').first().click();
  await page.getByRole('button', { name: 'Split', exact: true }).click();

  const editor = page.getByLabel('Split transaction');
  await editor.getByLabel('Part 2 category').selectOption({ label: 'Household' });
  await editor.getByLabel('Part 2 amount').fill('40');
  await expect(editor.getByLabel('Part 1 amount')).toHaveValue('60.00');
  await expect(editor.getByRole('status')).toHaveText('Adds up');
  await editor.getByRole('button', { name: 'Save split' }).click();

  await expect(page.getByText(/Split · 2/).first()).toBeVisible({ timeout: 10_000 });
  const saved = await (await request.get(`http://127.0.0.1:8000/transactions/${tx.id}`, { headers })).json();
  expect(saved.splits.map((s: { category_id: number; amount: string }) => [s.category_id, s.amount])).toEqual([
    [groceries.id, '-60.00'], [household.id, '-40.00'],
  ]);
  const accountAfter = await (await request.get(`http://127.0.0.1:8000/accounts/${account.id}`, { headers })).json();
  expect(Number(accountAfter.balance)).toBeCloseTo(900, 2); // the split moved no money
});
