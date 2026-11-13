const crypto = require('crypto');
const { ApiError } = require('./errors');
const { clientIp } = require('./http/client-ip');

function createRateLimiter({ repo, trustProxy, now = () => Date.now(), log = console }) {
  const local = new Map();

  function localHit(key, windowSeconds, max) {
    const time = now();
    if (local.size > 5000) {
      for (const [entryKey, entry] of local) {
        if (entry.start + entry.windowMs <= time) local.delete(entryKey);
      }
    }
    const windowMs = windowSeconds * 1000;
    let entry = local.get(key);
    if (!entry || entry.start + windowMs <= time) {
      entry = { start: time, hits: 0, windowMs };
      local.set(key, entry);
    }
    entry.hits += 1;
    return {
      allowed: entry.hits <= max,
      hits: entry.hits,
      retryAfter: Math.max(1, Math.ceil((entry.start + windowMs - time) / 1000))
    };
  }

  async function hit(key, windowSeconds, max) {
    try {
      return await repo.rateLimit(key, windowSeconds, max);
    } catch (error) {
      log.error(JSON.stringify({ level: 'warn', msg: 'rate_limit_store_unavailable', error: error.message }));
      return localHit(key, windowSeconds, max);
    }
  }

  function middleware({ name, windowSeconds, max, by = 'ip', memoryOnly = false }) {
    return async function limit(req, res, next) {
      try {
        const subject = by === 'user' && req.admin ? req.admin.id : clientIp(req, trustProxy);
        const key = `${name}:${crypto.createHash('sha256').update(String(subject)).digest('hex').slice(0, 32)}`;
        const result = memoryOnly ? localHit(key, windowSeconds, max) : await hit(key, windowSeconds, max);
        if (!result.allowed) {
          res.setHeader('Retry-After', String(result.retryAfter));
          throw new ApiError(429, 'rate_limited', 'Too many requests. Wait a moment and try again.', { retryAfter: result.retryAfter });
        }
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  return { middleware, hit, localHit };
}

module.exports = { createRateLimiter };
