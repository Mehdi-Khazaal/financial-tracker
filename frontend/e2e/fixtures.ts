import { APIRequestContext, Page, expect, test as base } from '@playwright/test';

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
  // The login form does not associate <label> to <input> via `for`/`id`,
  // so target the inputs by placeholder (email + password) instead of label.
  await page.getByPlaceholder(/you@example\.com|email|username/i).first().fill(identifier);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /log in|sign in|continue/i }).first().click();
  await expect(page).toHaveURL(/dashboard|accounts|transactions|portfolio|assistant|settings|localhost:3000\/?($|\?)/, { timeout: 10_000 });
}

/**
 * Create a category, or reuse the one that already exists.
 *
 * Signup seeds eighteen default categories, and several names a realistic
 * fixture wants — "Groceries", "Salary" — are among them. Since Phase 6B those
 * names are unique per `(user, type)`, so a plain POST returns 409 and the seed
 * fails. Reusing is the correct behaviour rather than a workaround: the spec
 * needs *a* category with that name, and it does not care whether the user
 * arrived with one.
 *
 * `type` matters as well as name — an expense "Other" and an income "Other" are
 * different categories and both may legitimately exist.
 */
export async function ensureCategory(
  request: APIRequestContext,
  headers: Record<string, string>,
  data: { name: string; type: string; color: string },
): Promise<{ id: number; name: string; type: string }> {
  const created = await request.post('http://127.0.0.1:8000/categories', { data, headers });
  if (created.ok()) return created.json();

  if (created.status() !== 409) {
    throw new Error(`/categories → ${created.status()} ${await created.text()}`);
  }

  const listed = await request.get('http://127.0.0.1:8000/categories', { headers });
  if (!listed.ok()) {
    throw new Error(`/categories (list) → ${listed.status()} ${await listed.text()}`);
  }
  const existing: { id: number; name: string; type: string }[] = await listed.json();
  const match = existing.find(
    category =>
      category.type === data.type
      && category.name.trim().toLowerCase() === data.name.trim().toLowerCase(),
  );
  if (!match) {
    throw new Error(`category "${data.name}" (${data.type}) collided but was not found`);
  }
  return match;
}

export { expect };
