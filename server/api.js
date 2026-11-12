const express = require('express');
const { ApiError } = require('./errors');

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function createApiRouter({ config, storage, images, security }) {
  const router = express.Router();

  router.use(security.apiGuard);
  router.use(express.json({ limit: config.maxBodyBytes, strict: true, type: 'application/json' }));

  router.get('/session', (req, res) => {
    res.json({
      csrfToken: security.csrfToken,
      maxUploadBytes: config.maxUploadBytes,
      origin: `http://${config.host}:${config.port}`
    });
  });

  router.get('/content', wrap(async (req, res) => {
    res.json({ content: await storage.loadContent() });
  }));

  router.put('/content', security.csrfGuard, wrap(async (req, res) => {
    res.json(await storage.saveContent(req.body));
  }));

  router.get('/status', wrap(async (req, res) => {
    res.json(await storage.getStatus());
  }));

  router.get('/images', wrap(async (req, res) => {
    res.json({ images: await images.listImages() });
  }));

  router.post('/images', security.csrfGuard, wrap(async (req, res) => {
    const file = await images.receive(req, res);
    res.status(201).json({ image: await images.saveUpload(file) });
  }));

  router.get('/backups', wrap(async (req, res) => {
    res.json({ backups: await storage.listBackups() });
  }));

  router.get('/backups/:name', wrap(async (req, res) => {
    res.json({ backup: await storage.readBackup(req.params.name) });
  }));

  router.post('/backups/:name/restore', security.csrfGuard, wrap(async (req, res) => {
    res.json(await storage.restoreBackup(req.params.name));
  }));

  router.use((req, res, next) => {
    next(new ApiError(404, 'not_found', 'Unknown API endpoint.'));
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
      return;
    }
    if (error.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'The request body is not valid JSON.', code: 'bad_json' });
      return;
    }
    if (error.type === 'entity.too.large') {
      res.status(413).json({ error: 'The request body is too large.', code: 'too_large' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Something went wrong on the local server. Check the terminal for details.', code: 'server_error' });
  });

  return router;
}

module.exports = { createApiRouter };
