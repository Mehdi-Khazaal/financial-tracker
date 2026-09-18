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
});
