const https = require('https');
const http  = require('http');

const RENDER_HOST = 'financial-tracker-api-1osn.onrender.com';

export const config = { api: { bodyParser: true } };

function proxyRequest(options, body) {
  return new Promise((resolve, reject) => {
    const mod = options.protocol === 'http:' ? http : https;
    const req = mod.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export default async function handler(req, res) {
  const parts    = req.query.path || [];
  const path     = Array.isArray(parts) ? parts.join('/') : parts;
  const qs       = { ...req.query };
  delete qs.path;
  const queryStr = Object.keys(qs).length ? '?' + new URLSearchParams(qs).toString() : '';
  const urlPath  = `/${path}${queryStr}`;

  const forwardHeaders = { ...req.headers };
  forwardHeaders.host  = RENDER_HOST;
  delete forwardHeaders['content-length'];
  delete forwardHeaders['transfer-encoding'];

  let body;
  if (!['GET', 'HEAD'].includes(req.method) && req.body != null) {
    body = Buffer.from(JSON.stringify(req.body));
    forwardHeaders['content-type']   = 'application/json';
    forwardHeaders['content-length'] = String(body.length);
  }

  let upstream;
  try {
    upstream = await proxyRequest({
      hostname: RENDER_HOST,
      path:     urlPath,
      method:   req.method,
      headers:  forwardHeaders,
    }, body);
  } catch (err) {
    return res.status(502).json({ error: 'upstream_error', message: String(err) });
  }

  // Forward headers — Node's http module preserves multiple Set-Cookie entries as array
  for (const [k, v] of Object.entries(upstream.headers)) {
    if (['transfer-encoding', 'content-encoding', 'connection'].includes(k.toLowerCase())) continue;
    res.setHeader(k, v);
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  res.status(upstream.status).send(upstream.body);
}
