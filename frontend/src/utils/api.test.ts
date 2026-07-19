import api, {
  getAccounts,
  getAssets,
  getCategories,
  getLoans,
  getRecurring,
  getSavingsGoals,
  getTransactions,
  getTransfers,
} from './api';

describe('API client', () => {
  it('uses the same-origin API proxy for cookie authentication', () => {
    expect(api.defaults.baseURL).toBe('/api');
    expect(api.defaults.withCredentials).toBe(true);
  });

  it('rejects an HTML shell returned for an API route', async () => {
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = async config => ({
      data: '<!doctype html><html></html>',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      config,
      request: {},
    });

    try {
      await expect(api.get('/accounts')).rejects.toThrow('API route returned HTML instead of data');
    } finally {
      api.defaults.adapter = originalAdapter;
    }
  });

  it('uses Vercel rewrite paths for collection endpoints', async () => {
    const urls: string[] = [];
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = async config => {
      urls.push(config.url || '');
      return {
        data: [],
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        config,
        request: {},
      };
    };

    try {
      await Promise.all([
        getAccounts(),
        getCategories(),
        getTransactions(),
        getTransfers(),
        getAssets(),
        getSavingsGoals(),
        getRecurring(),
        getLoans(),
      ]);
    } finally {
      api.defaults.adapter = originalAdapter;
    }

    expect(urls).toEqual([
      '/accounts',
      '/categories',
      '/transactions',
      '/transfers',
      '/assets',
      '/savings-goals',
      '/recurring',
      '/loans',
    ]);
  });

  it('proxies both current and cached collection URL forms in production', () => {
    const { rewrites } = require('../../vercel.json');
    const sources = new Set(rewrites.map((rewrite: { source: string }) => rewrite.source));
    const collectionPaths = [
      'accounts',
      'categories',
      'transactions',
      'transfers',
      'assets',
      'savings-goals',
      'recurring',
      'loans',
    ];

    collectionPaths.forEach(path => {
      expect(sources.has(`/api/${path}`)).toBe(true);
      expect(sources.has(`/api/${path}/`)).toBe(true);
    });
  });
});
