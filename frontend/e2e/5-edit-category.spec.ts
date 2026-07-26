import { expect, loginViaUi, test } from './fixtures';

test('edit an existing category name', async ({ page, registeredUser, request }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const headers = { Cookie: cookieHeader, 'Content-Type': 'application/json' };
  const createRes = await request.post('http://127.0.0.1:8000/categories', {
    headers, data: { name: 'Coffee', type: 'expense', color: '#f59e0b' },
  });
  expect([200, 201]).toContain(createRes.status());
  const cat = await createRes.json();

  const updateRes = await request.put(`http://127.0.0.1:8000/categories/${cat.id}`, {
    headers, data: { name: 'Espresso', color: '#8b5cf6' },
  });
  expect([200, 204]).toContain(updateRes.status());

  await page.goto('/transactions');
  await expect(page.getByText(/espresso/i).first()).toBeVisible({ timeout: 10_000 });
});
