const { createProxyMiddleware } = require('http-proxy-middleware');

const COLLECTION_PATHS = new Set([
  '/accounts',
  '/categories',
  '/transactions',
  '/transfers',
  '/assets',
  '/savings-goals',
  '/recurring',
  '/loans',
]);

const rewriteApiPath = path => {
  const rewritten = path.replace(/^\/api/, '');
  const queryIndex = rewritten.indexOf('?');
  const pathname = queryIndex === -1 ? rewritten : rewritten.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : rewritten.slice(queryIndex);
  return COLLECTION_PATHS.has(pathname) ? `${pathname}/${query}` : rewritten;
};

module.exports = function configureProxy(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://127.0.0.1:8000',
      changeOrigin: true,
      pathRewrite: rewriteApiPath,
    }),
  );
};

module.exports.rewriteApiPath = rewriteApiPath;
