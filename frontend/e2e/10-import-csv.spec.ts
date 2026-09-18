import { expect, loginViaUi, test } from './fixtures';

/** A bank CSV goes in through the sheet; the rows land on the timeline; undo removes them. */
test('import a CSV, see the rows, undo the batch', async ({ page, registeredUser, request }) => {
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

  await page.goto('/transactions?tab=list&import=1');
  const sheet = page.getByRole('dialog').filter({ hasText: 'Import CSV' });
  await sheet.locator('#import-file').setInputFiles({
    name: 'bank.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Description,Amount\n2026-03-01,PLAYWRIGHT MARKET,-42.10\n2026-03-02,Payroll,1500.00\n'),
  });
  await sheet.getByLabel('Into account').selectOption({ label: 'Checking' });
  await expect(sheet.getByText('PLAYWRIGHT MARKET')).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole('button', { name: 'Import 2 transactions' }).click();
  await expect(sheet.getByRole('status')).toContainText('2 imported', { timeout: 10_000 });

  const listed = await request.get('http://127.0.0.1:8000/transactions', { headers });
  const rows: { description: string | null; amount: string }[] = await listed.json();
  expect(rows.map(r => r.description).sort()).toEqual(['PLAYWRIGHT MARKET', 'Payroll']);
  const account = await (await request.get(`http://127.0.0.1:8000/accounts/${(await accountRes.json()).id}`, { headers })).json();
  expect(Number(account.balance)).toBeCloseTo(1000 - 42.10 + 1500, 2);

  await sheet.getByRole('button', { name: 'Undo this import' }).click();
  // Back to the form, re-previewed against the ledger as it now stands.
  await expect(sheet.getByRole('button', { name: 'Import 2 transactions' })).toBeVisible({ timeout: 10_000 });
  const after = await (await request.get('http://127.0.0.1:8000/transactions', { headers })).json();
  expect(after).toHaveLength(0);
});
