import { expect, loginViaUi, test } from './fixtures';

test('add a transaction from the transactions page', async ({ page, registeredUser, request }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);

  // Seed an account via API so the modal has something to write to.
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const accountRes = await request.post('http://127.0.0.1:8000/accounts', {
    headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
    data: { name: 'Checking', type: 'checking', balance: 1000, currency: 'USD' },
  });
  expect([200, 201]).toContain(accountRes.status());

  await page.goto('/transactions');
  await page.getByRole('button', { name: /add|record|new.*transaction/i }).first().click();
  await page.getByLabel(/amount/i).first().fill('12.50');
  const desc = page.getByLabel(/description|memo|note/i).first();
  if (await desc.count()) await desc.fill('Playwright coffee');
  await page.getByRole('button', { name: /save|add|record/i }).last().click();

  await expect(page.getByText(/12\.50|playwright coffee/i).first()).toBeVisible({ timeout: 10_000 });
});
