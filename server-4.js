'use strict';
/* MMart backend – zero npm dependencies. Needs Node 22.5+ (built-in SQLite).
   server.js only boots the HTTP server; the real work lives in  config.js · db.js · lib/ · routes/ · pages.js */
const http = require('http');
const cfg = require('./config');
require('./db');
const A = require('./lib/auth');
const { HttpError, Router, send, readBody } = require('./lib/http');
const pages = require('./pages');

A.seedAdmin();
const router = new Router();
for (const m of ['public', 'auth', 'contact', 'catalog', 'customer', 'seller', 'admin']) require('./routes/' + m)(router);

const clientIp = (req) => (cfg.TRUST_PROXY && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;

async function api(req, res, url, p) {
  const hit = router.match(req.method, p);
  if (!hit) throw new HttpError(404, 'Not found');
  const { r, params } = hit, user = A.sessionUser(req), write = req.method !== 'GET';
  if (write) {
    const o = req.headers.origin;
    if (o) { let ok = false; try { ok = new URL(o).host === req.headers.host; } catch { /* bad origin */ } if (!ok) throw new HttpError(403, 'Bad origin'); }
  }
  if (!r.opts.public) {
    if (!user) throw new HttpError(401, 'Please log in.');
    if (Array.isArray(r.opts.roles) && !r.opts.roles.includes(user.role)) throw new HttpError(403, 'Not allowed.');
  }
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req, r.opts.limit || 100e3) : {};
  const ctx = { req, res, url, params, body, user, ip: clientIp(req), status: 200 };
  const out = await r.fn(ctx);
  send(res, ctx.status, out ?? { ok: true });
}

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    if (p.startsWith('/api/')) return await api(req, res, url, p);
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (pages(req, res, p, A.sessionUser(req))) return;
    res.writeHead(302, { Location: '/' }); res.end();
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e); send(res, 500, { error: 'Server error' });
  }
}).listen(cfg.PORT, () => console.log(`MMart running on http://localhost:${cfg.PORT}   (/  /customer  /seller  /admin)`));
