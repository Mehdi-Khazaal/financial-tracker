const https = require('https');

const RENDER_HOST = 'financial-tracker-api-1osn.onrender.com';
const HOP_BY_HOP_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function upstreamPath(req) {
  const incoming = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const path = incoming.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  return `${path}${incoming.search}`;
}

function forwardHeaders(req, bodyLength) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) {
      headers[name] = value;
    }
  }
  headers.host = RENDER_HOST;
  if (bodyLength > 0) headers['content-length'] = String(bodyLength);
  return headers;
}

function proxyRequest(req, body) {
  return new Promise((resolve, reject) => {
    const upstream = https.request(
      {
        hostname: RENDER_HOST,
        method: req.method,
        path: upstreamPath(req),
        headers: forwardHeaders(req, body.length),
        timeout: 25_000,
      },
      response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode || 502,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }));
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream request timed out')));
    upstream.on('error', reject);
    if (body.length > 0) upstream.write(body);
    upstream.end();
  });
}

async function handler(req, res) {
  try {
    const body = await readRawBody(req);
    const upstream = await proxyRequest(req, body);

    for (const [name, value] of Object.entries(upstream.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) {
        res.setHeader(name, value);
      }
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(upstream.status).send(upstream.body);
  } catch {
    res.status(502).json({ detail: 'API is temporarily unavailable' });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.upstreamPath = upstreamPath;
