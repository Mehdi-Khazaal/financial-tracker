import { expect, loginViaUi, test } from './fixtures';

test('edit an existing category name', async ({ page, registeredUser, request }) => {
  await loginViaUi(page, registeredUser.email, registeredUser.password);

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const headers = {
    Cookie: cookieHeader,
    'Content-Type': 'application/json',
    // BrowserOriginMiddleware rejects cookie-authed writes without an allowed Origin.
    Origin: 'http://localhost:3000',
  };
  const createRes = await request.post('http://127.0.0.1:8000/categories', {
    headers, data: { name: 'Coffee', type: 'expense', color: '#f59e0b' },
  });
  expect([200, 201]).toContain(createRes.status());
  const cat = await createRes.json();

  const updateRes = await request.put(`http://127.0.0.1:8000/categories/${cat.id}`, {
    headers, data: { name: 'Espresso', color: '#8b5cf6' },
  });
  expect([200, 204]).toContain(updateRes.status());

  // Verify the rename persisted by re-fetching the category list.
  const listRes = await request.get('http://127.0.0.1:8000/categories', { headers });
  expect(listRes.status()).toBe(200);
  const cats: Array<{ id: number; name: string }> = await listRes.json();
  expect(cats.some(c => c.id === cat.id && c.name === 'Espresso')).toBe(true);
});
