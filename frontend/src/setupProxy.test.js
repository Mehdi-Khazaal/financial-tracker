jest.mock('http-proxy-middleware', () => ({ createProxyMiddleware: jest.fn() }));

const { rewriteApiPath } = require('./setupProxy');


describe('development API proxy', () => {
  it('canonicalizes FastAPI collection routes without changing item routes', () => {
    expect(rewriteApiPath('/api/accounts')).toBe('/accounts/');
    expect(rewriteApiPath('/api/transactions?limit=25')).toBe('/transactions/?limit=25');
    expect(rewriteApiPath('/api/accounts/')).toBe('/accounts/');
    expect(rewriteApiPath('/api/accounts/42')).toBe('/accounts/42');
    expect(rewriteApiPath('/api/auth/me')).toBe('/auth/me');
  });
});