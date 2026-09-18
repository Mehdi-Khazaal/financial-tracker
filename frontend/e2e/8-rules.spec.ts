import { ensureCategory, expect, loginViaUi, test } from './fixtures';

/**
 * Rules end to end: from an uncategorised transaction, start a rule, watch the
 * preview count it, save, apply to the past, and see the transaction filed.
 */
test('create a rule from a transaction and apply it to the past', async ({ page, registeredUser, request }) => {
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
  const subscriptions = await ensureCategory(request, headers, { name: 'Subscriptions', type: 'expense', color: '#6366f1' });
  for (const [description, day] of [['NETFLIX.COM 866-579-7172', '01'], ['Netflix', '02']] as const) {
    const res = await request.post('http://127.0.0.1:8000/transactions', {
      headers, data: { account_id: account.id, amount: -15.99, description, transaction_date: `2026-03-${day}` },
    });
    expect([200, 201]).toContain(res.status());
  }

  // Settings → Rules with the new-rule sheet prefilled by the deep link the
  // transaction sheet builds.
  await page.goto(`/settings?tab=rules&pattern=${encodeURIComponent('netflix')}`);
  const form = page.getByRole('form', { name: 'New rule' });
  await expect(form.getByLabel('Text')).toHaveValue('netflix');
  await form.getByLabel('File it under').selectOption({ value: String(subscriptions.id) });
  await expect(form.getByText(/Matches 2 past transactions/)).toBeVisible({ timeout: 10_000 });
  await form.getByRole('button', { name: 'Save rule' }).click();

  await expect(page.getByText('description contains “netflix”')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'description contains “netflix” actions' }).click();
  await page.getByRole('menuitem', { name: 'Apply to past transactions' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/filed 2/)).toBeVisible({ timeout: 10_000 });

  const listed = await request.get('http://127.0.0.1:8000/transactions', { headers });
  const rows: { category_id: number | null; category_source: string | null }[] = await listed.json();
  expect(rows.filter(r => r.category_id === subscriptions.id && r.category_source === 'rule')).toHaveLength(2);
});
