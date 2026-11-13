const { ApiError } = require('../errors');

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

function jsonBody({ limitBytes }) {
  return async function parseJson(req, res, next) {
    try {
      if (!UNSAFE.has(req.method)) return next();
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        if (req.body === undefined) req.body = {};
        return next();
      }
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > limitBytes) throw new ApiError(413, 'too_large', 'The request body is too large.');

      const descriptor = Object.getOwnPropertyDescriptor(req, 'body');
      if (descriptor) {
        let preParsed;
        try {
          preParsed = req.body;
        } catch {
          throw new ApiError(400, 'bad_json', 'The request body is not valid JSON.');
        }
        if (isContainer(preParsed)) return next();
      }

      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limitBytes) throw new ApiError(413, 'too_large', 'The request body is too large.');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        req.body = {};
        return next();
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ApiError(400, 'bad_json', 'The request body is not valid JSON.');
      }
      if (!isContainer(parsed)) throw new ApiError(400, 'bad_json', 'The request body must be a JSON object.');
      req.body = parsed;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { jsonBody };
