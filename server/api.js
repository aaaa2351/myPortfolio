const { asyncRouter } = require('./http/async-router');
const { ApiError } = require('./errors');
const { jsonBody } = require('./http/json-body');
const model = require('./content-model');

function integerParam(value) {
  return /^[0-9]{1,12}$/.test(String(value)) ? Number(value) : NaN;
}

function createAdminRouter({ config, guard, limiter, audit, content, images, deploy, repo, auth }) {
  const router = asyncRouter();
  const writeLimit = limiter.middleware({ name: 'admin-write', windowSeconds: 60, max: 60, by: 'user' });
  const uploadLimit = limiter.middleware({ name: 'admin-upload', windowSeconds: 600, max: 30, by: 'user' });
  const deployLimit = limiter.middleware({ name: 'admin-deploy', windowSeconds: 600, max: 15, by: 'user' });
  const sensitive = [guard.fresh, deployLimit];

  router.use(limiter.middleware({ name: 'admin-ip', windowSeconds: 60, max: 240, memoryOnly: true }));
  router.use(guard);
  router.use(jsonBody({ limitBytes: config.maxBodyBytes }));
  router.use((req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : writeLimit(req, res, next)));

  async function audited(req, action, target, work, describe = () => ({})) {
    try {
      const result = await work();
      await audit(req, action, { target, details: describe(result) });
      return result;
    } catch (error) {
      await audit(req, action, { target, outcome: 'failure', details: { code: error.code || 'error' } });
      throw error;
    }
  }

  router.get('/content', async (req, res) => {
    const draft = await content.loadDraft();
    const latest = await repo.getLatestPublication();
    res.json({
      content: draft.content,
      revision: draft.revision,
      updatedAt: draft.updatedAt,
      published: latest ? { id: latest.id, publishedAt: latest.publishedAt, sourceRevision: latest.sourceRevision, upToDate: model.sameJson(latest.content, draft.content) } : null
    });
  });

  router.put('/content', async (req, res) => {
    const result = await audited(
      req,
      'content.save',
      'draft',
      () => content.saveDraft(req.body.content, req.body.revision, req.admin.email),
      (saved) => ({ revision: saved.revision, unchanged: saved.unchanged })
    );
    res.json({ content: result.content, revision: result.revision, unchanged: result.unchanged, backup: result.backup });
  });

  router.get('/status', async (req, res) => res.json(await content.status()));

  router.get('/images', async (req, res) => res.json({ images: await images.listImages() }));

  router.post('/images', uploadLimit, async (req, res) => {
    const file = await images.receive(req, res);
    const item = await audited(req, 'image.upload', file ? file.originalname : null, () => images.saveUpload(file, req.admin.email), (saved) => ({ name: saved.name, size: saved.size }));
    res.status(201).json({ image: item });
  });

  router.delete('/images/:id', async (req, res) => {
    const removed = await audited(req, 'image.delete', req.params.id, () => images.removeUpload(req.params.id), (asset) => ({ name: asset.name }));
    res.json({ ok: true, name: removed.name });
  });

  router.get('/backups', async (req, res) => res.json({ backups: await content.listBackups() }));

  router.get('/backups/:name', async (req, res) => res.json({ backup: await content.readBackup(req.params.name) }));

  router.post('/backups/:name/restore', async (req, res) => {
    const revision = req.body.revision === undefined ? undefined : Number(req.body.revision);
    const result = await audited(req, 'content.restore', req.params.name, () => content.restoreBackup(req.params.name, revision, req.admin.email), (restored) => ({ revision: restored.revision, unchanged: restored.unchanged }));
    res.json({ content: result.content, revision: result.revision, unchanged: result.unchanged, backup: result.backup, restoredFrom: result.restoredFrom });
  });

  router.get('/publishing', async (req, res) => res.json(await content.publishingState()));

  router.get('/publications/:id', async (req, res) => {
    const id = integerParam(req.params.id);
    res.json(await content.readPublication(id));
  });

  router.post('/publish', async (req, res) => {
    const result = await audited(req, 'content.publish', 'site', () => content.publish(req.body.revision, req.admin.email, req.body.note), (published) => ({ unchanged: published.unchanged, publication: published.publication && published.publication.id }));
    res.json(result);
  });

  router.post('/publications/:id/republish', async (req, res) => {
    const id = integerParam(req.params.id);
    const result = await audited(req, 'content.republish', String(id), () => content.republish(id, req.admin.email, req.body.note), (published) => ({ publication: published.publication.id }));
    res.json(result);
  });

  router.get('/audit', async (req, res) => {
    const limit = Math.min(200, Math.max(1, integerParam(req.query.limit) || 100));
    res.json({ entries: await repo.listAudit(limit) });
  });

  router.get('/deploy/overview', async (req, res) => res.json(await deploy.overview()));
  router.get('/deploy/branches', async (req, res) => res.json({ branches: await deploy.branches() }));
  router.get('/deploy/commits', async (req, res) => res.json({ commits: await deploy.commits(String(req.query.branch || config.github.productionBranch), integerParam(req.query.page) || 1) }));
  router.get('/deploy/deployments', async (req, res) => res.json({ deployments: await deploy.listDeployments({ target: req.query.target, limit: req.query.limit }) }));
  router.get('/deploy/deployments/:id', async (req, res) => res.json({ deployment: await deploy.getDeployment(req.params.id) }));
  router.get('/deploy/deployments/:id/verify', async (req, res) => res.json(await deploy.verify(req.params.id)));
  router.get('/deploy/rollbacks', async (req, res) => res.json(await deploy.rollbackCandidates()));

  router.post('/deploy/branches', ...sensitive, async (req, res) => {
    const created = await audited(req, 'deploy.branch.create', String(req.body.name || ''), () => deploy.createBranch(req.body, req.admin), (branch) => ({ branch: branch.name, sha: branch.sha }));
    res.status(201).json({ branch: created });
  });

  router.post('/deploy/previews', ...sensitive, async (req, res) => {
    const created = await audited(req, 'deploy.preview', `${req.body.ref}@${String(req.body.sha || 'head').slice(0, 7)}`, () => deploy.createPreview(req.body, req.admin), (deployment) => ({ deployment: deployment.id }));
    res.status(202).json({ deployment: created });
  });

  router.post('/deploy/production', ...sensitive, async (req, res) => {
    const created = await audited(req, 'deploy.production', `${req.body.ref}@${String(req.body.sha || '').slice(0, 7)}`, () => deploy.deployProduction(req.body, req.admin), (deployment) => ({ deployment: deployment.id, sha: deployment.sha }));
    res.status(202).json({ deployment: created });
  });

  router.post('/deploy/deployments/:id/promote', ...sensitive, async (req, res) => {
    const promoted = await audited(req, 'deploy.promote', req.params.id, () => deploy.promote(req.params.id, req.body.confirm, req.admin), (deployment) => ({ sha: deployment.sha }));
    res.json({ deployment: promoted });
  });

  router.post('/deploy/rollbacks', ...sensitive, async (req, res) => {
    const result = await audited(req, 'deploy.rollback', String(req.body.deploymentId || ''), () => deploy.rollback(req.body, req.admin), (outcome) => ({ to: outcome.rolledBackTo.id, from: outcome.previous && outcome.previous.id }));
    res.json(result);
  });

  router.use((req, res, next) => next(new ApiError(404, 'not_found', 'That endpoint does not exist.')));

  return router;
}

module.exports = { createAdminRouter };
