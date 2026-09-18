/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiProxy } from './vite.proxy.ts';

/**
 * Build, dev server and unit-test configuration.
 *
 * Deliberate choices:
 * - `/api` is proxied to FastAPI in both `dev` and `preview`, mirroring the
 *   Vercel rewrite in production so the app is same-origin everywhere.
 * - No manual vendor chunks. Recharts, react-markdown and Plaid Link are each
 *   reached only through a lazily loaded route, so the dynamic-import graph
 *   already keeps them out of the entry. A `manualChunks` grouping was tried
 *   and pulled shared helpers into those chunks, which made the entry preload
 *   them — the opposite of the intent. `scripts/check-bundle.mjs` guards the
 *   entry size in CI so a stray eager import is caught.
 * - `public/sw.js` is copied verbatim; it is hand-written and must not be
 *   bundled or renamed, because the registration path is `/sw.js`.
 * - Tests reset mocks between cases, as CRA's Jest preset did
 *   (`resetMocks: true`); several suites rely on a clean mock per test.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 3000,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Vite only warns above this; the real limit is enforced by
    // `scripts/check-bundle.mjs` in CI. Kept close to the budget so the
    // warning and the failure agree.
    chunkSizeWarningLimit: 450,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'vite.proxy.test.ts'],
    css: false,
    mockReset: true,
    clearMocks: true,
  },
});
