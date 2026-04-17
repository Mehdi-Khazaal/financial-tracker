const https = require('https');
const http  = require('http');

const RENDER_HOST = 'financial-tracker-api-1osn.onrender.com';

// Disable Vercel's body parser so we forward the raw bytes unchanged
module.exports.config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function proxyRequest(options, body) {
  return new Promise((resolve, reject) => {
    const mod = options.hostname === 'localhost' ? http : https;
    const req = mod.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status:  res.statusCode,
        headers: res.headers,
        body:    Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  const parts    = req.query.path || [];
  const path     = Array.isArray(parts) ? parts.join('/') : parts;
  const qs       = { ...req.query };
  delete qs.path;
  const queryStr = Object.keys(qs).length ? '?' + new URLSearchParams(qs).toString() : '';
  const urlPath  = `/${path}${queryStr}`;

  // Read raw body bytes
  const rawBody = await readRaw(req);

  // Build forwarded headers from original request
  const fwdHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    fwdHeaders[k] = v;
  }
  fwdHeaders.host = RENDER_HOST;
  delete fwdHeaders['transfer-encoding'];
  if (rawBody.length > 0) {
    fwdHeaders['content-length'] = String(rawBody.length);
  } else {
    delete fwdHeaders['content-length'];
  }

  let upstream;
  try {
    upstream = await proxyRequest({
      hostname: RENDER_HOST,
      path:     urlPath,
      method:   req.method,
      headers:  fwdHeaders,
    }, rawBody);
  } catch (err) {
    return res.status(502).json({ error: 'upstream_error', message: String(err) });
  }

  // Forward response headers — Node preserves Set-Cookie as array automatically
  for (const [k, v] of Object.entries(upstream.headers)) {
    const lower = k.toLowerCase();
    if (['transfer-encoding', 'content-encoding', 'connection'].includes(lower)) continue;
    res.setHeader(k, v);
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  res.status(upstream.status).send(upstream.body);
};
