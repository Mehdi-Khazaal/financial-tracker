import { Page, expect, test as base } from '@playwright/test';

/**
 * Playwright fixture that provisions a fresh authenticated user before each
 * test. We hit /auth/signup directly on the backend so tests skip the sign-up
 * UI (which is not part of the smoke set).
 */
type Fixtures = {
  registeredUser: { email: string; username: string; password: string };
};

let counter = 0;

export const test = base.extend<Fixtures>({
  registeredUser: async ({ request }, use) => {
    counter += 1;
    const stamp = `${Date.now()}${counter}`;
    const user = {
      email: `e2e${stamp}@example.com`,
      username: `e2e${stamp}`,
      password: 'CorrectHorse!Battery9',
    };
    const res = await request.post('http://127.0.0.1:8000/auth/signup', { data: user });
    if (![200, 201].includes(res.status())) {
      throw new Error(`signup failed: ${res.status()} ${await res.text()}`);
    }
    await use(user);
  },
});

export async function loginViaUi(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/email|username/i).first().fill(identifier);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /log in|sign in/i }).click();
  await expect(page).toHaveURL(/dashboard|accounts|transactions|\/$/);
}

export { expect };
