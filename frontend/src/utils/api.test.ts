import api from './api';

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
      await expect(api.get('/accounts/')).rejects.toThrow('API route returned HTML instead of data');
    } finally {
      api.defaults.adapter = originalAdapter;
    }
  });
});
