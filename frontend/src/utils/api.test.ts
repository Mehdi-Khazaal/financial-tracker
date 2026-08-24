import api, {
  MAX_TRANSACTION_PAGES,
  PAGE_SIZE,
  fetchAllTransactions,
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


/**
 * Paging the ledger, and admitting when it did not reach the end.
 *
 * The cap is a safety rail against a runaway loop. Deciding silently is the
 * danger: stopping at the cap and returning a bare array made "this is all of
 * it" and "this is as much as I would fetch" indistinguishable, so every total
 * computed from the result could be quietly wrong.
 */
describe('fetchAllTransactions', () => {
  const row = (id: number) => ({ id, amount: -1, description: 'x' });

  /** Serve `total` rows across as many pages as that takes. */
  const serve = (total: number) => {
    const requests: { skip: number; limit: number }[] = [];
    api.defaults.adapter = async config => {
      const skip = Number(config.params?.skip ?? 0);
      const limit = Number(config.params?.limit ?? PAGE_SIZE);
      requests.push({ skip, limit });
      const slice = Array.from(
        { length: Math.max(0, Math.min(limit, total - skip)) },
        (_, i) => row(skip + i),
      );
      return { data: slice, status: 200, statusText: 'OK', headers: {}, config, request: {} };
    };
    return requests;
  };

  let originalAdapter: any;
  beforeEach(() => { originalAdapter = api.defaults.adapter; });
  afterEach(() => { api.defaults.adapter = originalAdapter; });

  it('returns everything when the history fits', async () => {
    serve(1500);

    const page = await fetchAllTransactions();

    expect(page.transactions).toHaveLength(1500);
    expect(page.loaded).toBe(1500);
    expect(page.truncated).toBe(false);
  });

  it('stops after one request when there is less than a page', async () => {
    const requests = serve(10);

    const page = await fetchAllTransactions();

    expect(page.transactions).toHaveLength(10);
    expect(page.truncated).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('is not truncated when the total lands exactly on a page boundary', async () => {
    // The subtle case: a full last page looks like "there may be more" until
    // the next request comes back empty.
    serve(PAGE_SIZE);

    const page = await fetchAllTransactions();

    expect(page.transactions).toHaveLength(PAGE_SIZE);
    expect(page.truncated).toBe(false);
  });

  it('says so when the cap stopped it short', async () => {
    serve(PAGE_SIZE * 3);

    const page = await fetchAllTransactions({}, 2);

    expect(page.transactions).toHaveLength(PAGE_SIZE * 2);
    expect(page.loaded).toBe(PAGE_SIZE * 2);
    expect(page.truncated).toBe(true);
  });

  it('never makes more requests than the cap allows', async () => {
    const requests = serve(PAGE_SIZE * 100);

    await fetchAllTransactions({}, 3);

    expect(requests).toHaveLength(3);
  });

  it('keeps a cap high enough that hitting it means something is wrong', () => {
    // 50,000 transactions is decades of ordinary use.
    expect(MAX_TRANSACTION_PAGES * PAGE_SIZE).toBeGreaterThanOrEqual(50_000);
  });

  it('passes callers\' filters through to every page', async () => {
    const requests: any[] = [];
    api.defaults.adapter = async config => {
      requests.push(config.params);
      const skip = Number(config.params?.skip ?? 0);
      return {
        data: skip === 0 ? Array.from({ length: PAGE_SIZE }, (_, i) => row(i)) : [],
        status: 200, statusText: 'OK', headers: {}, config, request: {},
      };
    };

    await fetchAllTransactions({ account_id: 7 });

    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every(p => p.account_id === 7)).toBe(true);
  });

  it('resolves to a page object, not a bare array', async () => {
    // The shape every caller depends on. Returning an array again would slip
    // past the `Array.isArray` guards at the call sites and render as "no
    // transactions" rather than failing — which is exactly what happened when
    // this function's return type changed.
    serve(5);

    const page = await fetchAllTransactions();

    expect(Array.isArray(page)).toBe(false);
    expect(Array.isArray(page.transactions)).toBe(true);
    expect(typeof page.truncated).toBe('boolean');
    expect(typeof page.loaded).toBe('number');
  });
});
