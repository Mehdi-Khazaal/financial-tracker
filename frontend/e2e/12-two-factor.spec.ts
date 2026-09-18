import { createHmac } from 'node:crypto';
import { expect, test } from './fixtures';

/** RFC 6238 TOTP, six digits, 30 s steps — the same maths the server uses. */
function totp(secret: string, step: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/\s+/g, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

test('an account with two-factor asks for a code after the password', async ({ page, registeredUser, request }) => {
  const origin = { Origin: 'http://localhost:3000' };
  // The request context holds the session cookies from sign-up.
  const setup = await request.post('http://127.0.0.1:8000/auth/2fa/setup', { headers: origin, data: { password: registeredUser.password } });
  expect(setup.status()).toBe(200);
  const { secret } = await setup.json();
  const step = Math.floor(Date.now() / 1000 / 30);
  const enable = await request.post('http://127.0.0.1:8000/auth/2fa/enable', { headers: origin, data: { code: totp(secret, step) } });
  expect(enable.status()).toBe(200);
  expect((await enable.json()).recovery_codes).toHaveLength(10);

  await page.goto('/login');
  await page.getByLabel('Email or Username').fill(registeredUser.email);
  await page.getByLabel('Password', { exact: true }).fill(registeredUser.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  const code = page.getByLabel('Code from your authenticator app');
  await expect(code).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // The enrolment code's step is spent (no replays); the next step is inside the window.
  await code.fill(totp(secret, step + 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/localhost:3000\/?($|\?)/, { timeout: 10_000 });
  const cookies = await page.context().cookies();
  expect(cookies.some(c => c.name === 'access_token')).toBeTruthy();
});
