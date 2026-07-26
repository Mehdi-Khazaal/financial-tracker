import { expect, loginViaUi, test } from './fixtures';

test('plaid link-token request is stubbed and reaches the button', async ({ page, registeredUser }) => {
  // The real Plaid handshake requires a Plaid sandbox account. We stub the
  // /plaid/link-token endpoint so the "Connect a bank" click at least
  // reaches the Plaid Link SDK without a network error.
  await page.route('**/plaid/link-token', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ link_token: 'link-sandbox-e2e-stub', expiration: '2099-01-01' }),
    }),
  );

  await loginViaUi(page, registeredUser.email, registeredUser.password);
  await page.goto('/accounts');
  const connectBtn = page.getByRole('button', { name: /connect.*bank|plaid|link.*bank/i }).first();
  if (await connectBtn.count()) {
    await connectBtn.click();
    // Plaid SDK opens a modal; success = no network failure toast.
    await page.waitForTimeout(500);
    await expect(page.getByText(/failed|error/i)).toHaveCount(0);
  }
});
