const express = require('express');
const { createConfig, missingSettings } = require('./config');
const { ApiError } = require('./errors');
const { createSecurity } = require('./security');
const { createSessionCodec } = require('./auth/session');
const { createGoTrue } = require('./auth/gotrue');
const { createAdminAuth } = require('./auth/admin-auth');
const { createGuard } = require('./auth/guard');
const { createAuthRouter } = require('./auth/routes');
const { createSupabaseClients, createSupabaseRepo } = require('./repo/supabase');
const { createSupabaseMedia } = require('./repo/supabase-media');
const { createRateLimiter } = require('./rate-limit');
const { createAudit } = require('./audit');
const { createContentService } = require('./storage');
const { createImages, createStaticImages } = require('./images');
const { createGitHub } = require('./deploy/github');
const { createVercel } = require('./deploy/vercel');
const { createDeployService } = require('./deploy/service');
const { createAdminRouter } = require('./api');
const { asyncRouter } = require('./http/async-router');
const { jsonBody } = require('./http/json-body');

function unconfigured(name, missing) {
  return new Proxy(
    {},
    {
      get() {
        return () => {
          throw new ApiError(503, 'not_configured', `${name} is not configured.`, { missing });
        };
      }
    }
  );
}

function createServices(config, overrides = {}) {
  const problems = missingSettings(config);
  const clients = overrides.repo ? { client: null, publicClient: null } : createSupabaseClients(config);
  const repo = overrides.repo || (clients.client ? createSupabaseRepo(clients) : unconfigured('The database', problems.data));
  const media = overrides.media || (clients.client ? createSupabaseMedia({ client: clients.client, bucket: config.supabase.bucket }) : unconfigured('Image storage', problems.data));
  const fetchImpl = overrides.fetch || fetch;
  const canAuth = !problems.auth.length;
  const codec = canAuth ? createSessionCodec(config.session.secret) : null;
  const gotrue = overrides.gotrue || (canAuth ? createGoTrue({ url: config.supabase.url, anonKey: config.supabase.anonKey, fetchImpl }) : null);
  const auth = canAuth ? createAdminAuth({ config, gotrue, codec, now: overrides.now }) : null;
  const staticImages = createStaticImages(config);
  const content = createContentService({ repo, config, staticImages });
  const images = createImages({ config, repo, media, staticImages, isReferenced: async (url) => (await content.referencedImages()).has(url) });
  const github = createGitHub({ config, fetchImpl });
  const vercel = createVercel({ config, fetchImpl });
  const deploy = createDeployService({ config, github, vercel, repo, fetchImpl });
  return { problems, repo, media, codec, gotrue, auth, staticImages, content, images, deploy, fetchImpl };
}

function errorHandler(config) {
  return function handle(error, req, res, next) {
    if (res.headersSent) return next(error);
    let status = 500;
    let code = 'server_error';
    let message = 'Something went wrong on the server. Try again.';
    let details;
    if (error instanceof ApiError) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error && error.type === 'entity.too.large') {
      status = 413;
      code = 'too_large';
      message = 'The request body is too large.';
    }
    if (status >= 500 && code !== 'not_configured') {
      console.error(JSON.stringify({ level: 'error', msg: 'request_failed', method: req.method, path: req.path, code, error: error && error.message, cause: error && error.cause && (error.cause.message || error.cause.code) }));
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ error: message, code, ...(details !== undefined && status < 500 ? { details } : {}) });
  };
}

function createApp(config, overrides = {}) {
  const services = createServices(config, overrides);
  const security = createSecurity(config);
  const { problems } = services;
  const limiter = createRateLimiter({ repo: services.repo, trustProxy: config.trustProxy, now: overrides.nowMs });
  const audit = createAudit({ repo: services.repo, trustProxy: config.trustProxy });
  const features = () => ({ github: !problems.github.length, vercel: !problems.vercel.length });
  const app = express();

  app.disable('x-powered-by');
  app.set('etag', false);
  if (config.trustProxy) app.set('trust proxy', true);
  app.use(security.localHostGuard);
  app.use(security.securityHeaders);
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, commit: config.commitSha || null, environment: config.vercelEnv || (config.production ? 'production' : 'local') });
  });

  const publicRouter = asyncRouter();
  publicRouter.get('/content', limiter.middleware({ name: 'public-content', windowSeconds: 60, max: 120, memoryOnly: true }), async (req, res) => {
    if (problems.public.length) throw new ApiError(503, 'not_configured', 'Published content is not available yet.');
    const published = await services.content.publicContent();
    if (!published) throw new ApiError(404, 'not_published', 'Nothing has been published yet.');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
    res.json(published.content);
  });
  app.use('/api/public', publicRouter);

  if (services.auth) {
    const guard = createGuard({ config, problems, auth: services.auth, codec: services.codec, security, audit });
    app.use('/api/auth', createAuthRouter({ config, problems, auth: services.auth, audit, limiter, features }));
    app.use('/api/admin', createAdminRouter({ config, guard, limiter, audit, content: services.content, images: services.images, deploy: services.deploy, repo: services.repo, auth: services.auth }));
  } else {
    const closed = asyncRouter();
    const reason = () => (config.admin.enabled ? 'not_configured' : 'admin_disabled');
    closed.get('/auth/session', (req, res) => res.json({ authenticated: false, reason: reason() }));
    closed.get('/auth/login', (req, res) => res.redirect(302, `/admin/?auth_error=${reason()}`));
    closed.get('/auth/callback', (req, res) => res.redirect(302, `/admin/?auth_error=${reason()}`));
    closed.use((req, res, next) => next(new ApiError(503, 'not_configured', 'The CMS is not fully configured on the server.')));
    app.use('/api', closed);
  }

  app.use('/api', (req, res, next) => next(new ApiError(404, 'not_found', 'That endpoint does not exist.')));

  if (config.serveStatic) {
    const staticOptions = {
      dotfiles: 'ignore',
      index: 'index.html',
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    };
    app.use('/admin', express.static(config.adminDir, staticOptions));
    app.use(express.static(config.publicDir, staticOptions));
  }

  app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use(errorHandler(config));

  return { app, services, limiter };
}

function createProductionApp() {
  const config = createConfig();
  const problems = missingSettings(config);
  const missing = [...new Set([...problems.auth, ...problems.data])];
  if (missing.length) console.warn(JSON.stringify({ level: 'warn', msg: 'cms_not_fully_configured', missing }));
  return createApp(config).app;
}

module.exports = { createApp, createServices, createProductionApp, errorHandler };
