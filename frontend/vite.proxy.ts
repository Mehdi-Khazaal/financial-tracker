/**
 * Development API proxy rules, shared by `vite.config.ts` and its test.
 *
 * The browser calls `/api/...` on the dev origin exactly as it does in
 * production behind Vercel. Vite forwards those to the FastAPI server and
 * strips the prefix. One wrinkle carried over from the CRA-era
 * `setupProxy.js`: FastAPI's collection routes are declared with a trailing
 * slash (`/accounts/`), and a request without it would be answered with a
 * 307 redirect that loses the POST body. The rewrite canonicalises the
 * collection paths — and only those — so the redirect never happens.
 */

export const COLLECTION_PATHS = new Set([
  '/accounts',
  '/categories',
  '/transactions',
  '/transfers',
  '/assets',
  '/savings-goals',
  '/recurring',
  '/loans',
]);

export function rewriteApiPath(path: string): string {
  const rewritten = path.replace(/^\/api/, '');
  const queryIndex = rewritten.indexOf('?');
  const pathname = queryIndex === -1 ? rewritten : rewritten.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : rewritten.slice(queryIndex);
  return COLLECTION_PATHS.has(pathname) ? `${pathname}/${query}` : rewritten;
}

export const API_PROXY_TARGET = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8000';

/** The `server.proxy` / `preview.proxy` entry Vite consumes. */
export const apiProxy = {
  '/api': {
    target: API_PROXY_TARGET,
    changeOrigin: true,
    rewrite: rewriteApiPath,
  },
};
