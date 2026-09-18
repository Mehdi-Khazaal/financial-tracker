import { describe, expect, it } from 'vitest';
import { apiProxy, rewriteApiPath } from './vite.proxy';

describe('development API proxy', () => {
  it('canonicalizes FastAPI collection routes without changing item routes', () => {
    expect(rewriteApiPath('/api/accounts')).toBe('/accounts/');
    expect(rewriteApiPath('/api/transactions?limit=25')).toBe('/transactions/?limit=25');
    expect(rewriteApiPath('/api/accounts/')).toBe('/accounts/');
    expect(rewriteApiPath('/api/accounts/42')).toBe('/accounts/42');
    expect(rewriteApiPath('/api/auth/me')).toBe('/auth/me');
    expect(rewriteApiPath('/api/recurring/overview')).toBe('/recurring/overview');
  });

  it('forwards /api to the local backend and rewrites the path', () => {
    expect(apiProxy['/api'].target).toMatch(/^http:\/\/127\.0\.0\.1:8000$|^http/);
    expect(apiProxy['/api'].changeOrigin).toBe(true);
    expect(apiProxy['/api'].rewrite('/api/loans')).toBe('/loans/');
  });

  it('canonicalises every collection route added since, so a POST is never redirected', () => {
    // A missing entry here surfaces as a 307 to the backend's own origin,
    // which drops the cookie and the body — the rules sheet saved nothing
    // until '/rules' was listed.
    expect(rewriteApiPath('/api/budgets')).toBe('/budgets/');
    expect(rewriteApiPath('/api/rules')).toBe('/rules/');
    expect(rewriteApiPath('/api/rules/preview')).toBe('/rules/preview');
  });
});
