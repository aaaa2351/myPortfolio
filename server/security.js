const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD']);

function createSecurity(config) {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const tokenBuffer = Buffer.from(csrfToken);

  const allowedHosts = () => new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`]);

  function hostGuard(req, res, next) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts().has(host)) {
      res.status(403).type('text/plain').send('Forbidden');
      return;
    }
    next();
  }

  function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (req.path === '/admin' || req.path.startsWith('/admin/')) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self'",
        "frame-src 'self'",
        "form-action 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'"
      ].join('; '));
      res.setHeader('X-Frame-Options', 'DENY');
    } else if (!req.path.startsWith('/api')) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "form-action 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'"
      ].join('; '));
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    next();
  }

  function apiGuard(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      res.status(403).json({ error: 'Cross-site requests are not allowed.', code: 'cross_site' });
      return;
    }
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins().has(origin)) {
        res.status(403).json({ error: 'Requests must come from the local admin page.', code: 'bad_origin' });
        return;
      }
    }
    next();
  }

  function csrfGuard(req, res, next) {
    const supplied = Buffer.from(String(req.headers['x-csrf-token'] || ''));
    if (supplied.length !== tokenBuffer.length || !crypto.timingSafeEqual(supplied, tokenBuffer)) {
      res.status(403).json({ error: 'Security token is missing or expired. Reload the admin page.', code: 'csrf' });
      return;
    }
    next();
  }

  return { csrfToken, hostGuard, securityHeaders, apiGuard, csrfGuard };
}

module.exports = { createSecurity };
