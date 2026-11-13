const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const ADMIN_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ');

const PUBLIC_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  'font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com',
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'"
].join('; ');

const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=()';

function createSecurity(config) {
  function allowedHosts() {
    return new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  }

  function localHostGuard(req, res, next) {
    if (!config.localHostGuard) return next();
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
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    const isAdmin = req.path === '/admin' || req.path.startsWith('/admin/');
    if (isAdmin) {
      res.setHeader('Content-Security-Policy', ADMIN_CSP);
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    } else if (!req.path.startsWith('/api')) {
      res.setHeader('Content-Security-Policy', PUBLIC_CSP);
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    next();
  }

  function isSameOrigin(req) {
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
    const origin = req.headers.origin;
    if (!origin) return false;
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    if (parsed.origin === config.appUrl) return true;
    return parsed.host === String(req.headers.host || '').toLowerCase();
  }

  function isSafeMethod(method) {
    return SAFE_METHODS.has(method);
  }

  return { localHostGuard, securityHeaders, isSameOrigin, isSafeMethod };
}

module.exports = { createSecurity, ADMIN_CSP, PUBLIC_CSP, PERMISSIONS_POLICY };
