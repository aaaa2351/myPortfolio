const { asyncRouter } = require('../http/async-router');
const cookies = require('../http/cookies');
const { ApiError } = require('../errors');

const ERROR_CODES = new Set(['not_authorised', 'login_expired', 'login_failed', 'admin_disabled', 'not_configured', 'login_cancelled']);

function createAuthRouter({ config, problems, auth, audit, limiter, features }) {
  const router = asyncRouter();
  const loginLimit = limiter.middleware({ name: 'auth-login', windowSeconds: 600, max: 20 });
  const callbackLimit = limiter.middleware({ name: 'auth-callback', windowSeconds: 600, max: 30 });
  const failure = (res, code) => res.redirect(302, `/admin/?auth_error=${ERROR_CODES.has(code) ? code : 'login_failed'}`);

  router.get('/login', loginLimit, (req, res) => {
    if (!config.admin.enabled) return failure(res, 'admin_disabled');
    if (problems.auth.length) return failure(res, 'not_configured');
    const { url, cookie } = auth.startLogin();
    cookies.append(res, cookie);
    res.redirect(302, url);
  });

  router.get('/callback', callbackLimit, async (req, res, next) => {
    try {
      if (!config.admin.enabled) return failure(res, 'admin_disabled');
      if (problems.auth.length) return failure(res, 'not_configured');
      if (typeof req.query.error === 'string') {
        await audit(req, 'auth.login', { outcome: 'failure', actor: { email: null, id: null }, details: { reason: 'provider_error' } });
        return failure(res, 'login_cancelled');
      }
      const admin = await auth.completeLogin(req, res);
      await audit(req, 'auth.login', { actor: admin });
      return res.redirect(302, '/admin/');
    } catch (error) {
      if (!(error instanceof ApiError)) return next(error);
      await audit(req, error.code === 'not_authorised' ? 'auth.denied' : 'auth.login', {
        outcome: error.code === 'not_authorised' ? 'denied' : 'failure',
        actor: { email: error.email || null, id: null },
        details: { reason: error.reason || error.code }
      });
      return failure(res, error.code);
    }
  });

  router.get('/session', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!config.admin.enabled) return res.json({ authenticated: false, reason: 'admin_disabled' });
    if (problems.auth.length) return res.json({ authenticated: false, reason: 'not_configured' });
    try {
      const admin = await auth.authenticate(req, res);
      return res.json({
        authenticated: true,
        user: { email: admin.email, name: admin.name, avatarUrl: admin.avatarUrl },
        csrfToken: admin.csrfToken,
        expiresAt: admin.expiresAt,
        limits: { maxUploadBytes: config.maxUploadBytes },
        environment: config.vercelEnv || (config.production ? 'production' : 'local'),
        features: features()
      });
    } catch (error) {
      if (error.code === 'not_authorised') {
        await audit(req, 'auth.denied', { outcome: 'denied', actor: { email: error.email, id: null }, details: { reason: error.reason } });
        return res.json({ authenticated: false, reason: 'not_authorised' });
      }
      if (error.status === 401) return res.json({ authenticated: false, reason: error.code });
      return next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const fetchSite = req.headers['sec-fetch-site'];
      if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new ApiError(403, 'bad_origin', 'This request did not come from the CMS.');
      const result = await auth.logout(req, res);
      if (result.hadSession) await audit(req, 'auth.logout', { actor: { email: null, id: null } });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAuthRouter };
