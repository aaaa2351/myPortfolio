const { ApiError } = require('../errors');

function createGuard({ config, problems, auth, codec, security, audit }) {
  async function guard(req, res, next) {
    try {
      if (!config.admin.enabled) throw new ApiError(403, 'admin_disabled', 'The admin area is disabled on this deployment.');
      if (problems.auth.length || problems.data.length) throw new ApiError(503, 'not_configured', 'The CMS is not fully configured on the server.');
      const admin = await auth.authenticate(req, res);
      if (!security.isSafeMethod(req.method)) {
        if (!security.isSameOrigin(req)) throw new ApiError(403, 'bad_origin', 'This request did not come from the CMS.');
        if (!codec.verifyCsrf(admin.sid, req.headers['x-csrf-token'])) throw new ApiError(403, 'csrf', 'Security token is missing or expired. Reload the page.');
      }
      req.admin = admin;
      next();
    } catch (error) {
      if (error.code === 'not_authorised') {
        await audit(req, 'auth.denied', { outcome: 'denied', actor: { email: error.email, id: null }, details: { reason: error.reason } });
      }
      next(error);
    }
  }

  guard.fresh = async function fresh(req, res, next) {
    try {
      await auth.authenticate(req, res, { fresh: true });
      next();
    } catch (error) {
      next(error);
    }
  };

  return guard;
}

module.exports = { createGuard };
