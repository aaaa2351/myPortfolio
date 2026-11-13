const express = require('express');

function wrap(handler) {
  if (typeof handler !== 'function' || handler.length >= 4) return handler;
  const wrapped = function wrapped(req, res, next) {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(next);
    } catch (error) {
      next(error);
    }
  };
  Object.defineProperty(wrapped, 'name', { value: handler.name });
  return wrapped;
}

function asyncRouter() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(wrap));
  }
  return router;
}

module.exports = { asyncRouter };
