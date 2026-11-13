const { clientIp } = require('./http/client-ip');

function createAudit({ repo, trustProxy, log = console }) {
  return async function record(req, action, options = {}) {
    const { target = null, outcome = 'success', details = {}, actor } = options;
    const admin = actor || req.admin || null;
    try {
      await repo.audit({
        actorEmail: admin ? admin.email : null,
        actorId: admin ? admin.id : null,
        action,
        target,
        outcome,
        ip: clientIp(req, trustProxy),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        details
      });
    } catch (error) {
      log.error(JSON.stringify({ level: 'error', msg: 'audit_write_failed', action, outcome, error: error.message }));
    }
  };
}

module.exports = { createAudit };
