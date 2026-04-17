const RENDER = 'https://financial-tracker-api-1osn.onrender.com';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  const parts = req.query.path || [];
  const path  = Array.isArray(parts) ? parts.join('/') : parts;

  const qs = { ...req.query };
  delete qs.path;
  const queryStr = Object.keys(qs).length ? '?' + new URLSearchParams(qs).toString() : '';

  const url = `${RENDER}/${path}${queryStr}`;

  const headers = { ...req.headers };
  headers.host = 'financial-tracker-api-1osn.onrender.com';
  delete headers['content-length'];
  delete headers['transfer-encoding'];

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let body;
  if (hasBody && req.body) {
    body = JSON.stringify(req.body);
    headers['content-type'] = 'application/json';
  }

  let upstream;
  try {
    upstream = await fetch(url, { method: req.method, headers, body });
  } catch (err) {
    res.status(502).json({ error: 'upstream_error', message: String(err) });
    return;
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  for (const [k, v] of upstream.headers.entries()) {
    const lower = k.toLowerCase();
    if (['transfer-encoding', 'content-encoding', 'content-length', 'connection'].includes(lower)) continue;
    res.setHeader(k, v);
  }

  const buf = await upstream.arrayBuffer();
  res.status(upstream.status).send(Buffer.from(buf));
}
