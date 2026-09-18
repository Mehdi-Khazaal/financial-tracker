import { expect, loginViaUi, test } from './fixtures';

/** ⌘K search lands on the timeline with only the matching rows. */
test('search from the command palette filters the timeline', async ({ page, registeredUser, request }) => {
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
  const account = await accountRes.json();
  for (const [description, amount] of [['NETFLIX.COM 866-579-7172', -15.99], ['Corner Bakery', -4.5]] as const) {
    const res = await request.post('http://127.0.0.1:8000/transactions', {
      headers, data: { account_id: account.id, amount, description, transaction_date: '2026-03-02' },
    });
    expect([200, 201]).toContain(res.status());
  }

  await page.goto('/');
  await page.getByRole('button', { name: 'Open command palette' }).click();
  const input = page.getByPlaceholder('Type a command or search…');
  await input.fill('netflix');
  await page.getByRole('button', { name: 'Search transactions for “netflix”' }).click();

  await expect(page).toHaveURL(/\/transactions/);
  await expect(page.getByLabel('Search transactions')).toHaveValue('netflix');
  await expect(page.getByText(/netflix/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Corner Bakery')).toHaveCount(0);
});
