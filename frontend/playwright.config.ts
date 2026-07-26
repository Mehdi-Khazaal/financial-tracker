import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke suite for CI. Six flows worth catching before deploy:
 *   1. login (root smoke)
 *   2. add transaction
 *   3. transfer between accounts
 *   4. Plaid mock connect (link token stubbed)
 *   5. edit category
 *   6. PWA offline reload
 *
 * Servers are spun up via `webServer`:
 *   - Backend: FastAPI on :8000 with a scratch SQLite DB.
 *   - Frontend: production build served on :3000 by `serve`.
 * Both are torn down when the run finishes.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command:
        'python -c "import os; [os.remove(f) for f in [\'e2e_test.db\'] if os.path.exists(f)]" && python -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir ../backend',
      port: 8000,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: 'sqlite:///./e2e_test.db',
        SECRET_KEY: 'e2e-test-secret-key-0123456789abcdef',
        ENVIRONMENT: 'test',
        AUTO_PREPARE_DB: 'true',
        RATE_LIMIT_ENABLED: 'false',
      },
    },
    {
      command: 'npx cross-env BROWSER=none npm start',
      port: 3000,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
