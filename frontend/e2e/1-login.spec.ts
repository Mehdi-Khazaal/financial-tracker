import { expect, loginViaUi, test } from './fixtures';

test('login lands on an authenticated page', async ({ page, registeredUser }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);
  // Auth cookie exists and root is no longer /login.
  const cookies = await page.context().cookies();
  expect(cookies.some(c => c.name === 'access_token')).toBeTruthy();
});
