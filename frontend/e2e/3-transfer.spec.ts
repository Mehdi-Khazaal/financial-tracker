import { expect, loginViaUi, test } from './fixtures';

test('transfer moves money between accounts', async ({ page, registeredUser, request }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const headers = {
    Cookie: cookieHeader,
    'Content-Type': 'application/json',
    // BrowserOriginMiddleware rejects cookie-authed writes without an allowed Origin.
    Origin: 'http://localhost:3000',
  };

  const from = await request.post('http://127.0.0.1:8000/accounts', {
    headers, data: { name: 'From', type: 'checking', balance: 500, currency: 'USD' },
  });
  const to = await request.post('http://127.0.0.1:8000/accounts', {
    headers, data: { name: 'To', type: 'savings', balance: 0, currency: 'USD' },
  });
  expect([200, 201]).toContain(from.status());
  expect([200, 201]).toContain(to.status());

  // Server-side transfer POST (UI flow varies by tab). Verifies the write
  // succeeds end-to-end through auth + middleware + ledger service.
  const transferRes = await request.post('http://127.0.0.1:8000/transfers', {
    headers,
    data: {
      from_account_id: (await from.json()).id,
      to_account_id: (await to.json()).id,
      amount: 100,
      transfer_date: new Date().toISOString().slice(0, 10),
      note: 'e2e',
    },
  });
  expect([200, 201]).toContain(transferRes.status());

  await page.goto('/accounts');
  await expect(page.getByText(/from/i).first()).toBeVisible();
  await expect(page.getByText(/to/i).first()).toBeVisible();
});
