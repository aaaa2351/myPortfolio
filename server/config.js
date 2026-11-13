const path = require('path');

const MB = 1024 * 1024;
const MAX_UPLOAD_MB_CAP = 4;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function flag(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const raw = text(value);
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function integer(value, fallback, min, max) {
  const raw = text(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function origin(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

function emails(value) {
  return new Set(
    text(value)
      .split(/[\s,;]+/)
      .map((entry) => entry.toLowerCase())
      .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))
  );
}

function createConfig(options = {}) {
  const env = options.env || process.env;
  const root = options.root || path.resolve(__dirname, '..');
  const onVercel = Boolean(text(env.VERCEL));
  const vercelEnv = text(env.VERCEL_ENV);
  const production = options.production ?? (vercelEnv ? vercelEnv === 'production' : text(env.NODE_ENV) === 'production');
  const requestedPort = Number(options.port ?? env.PORT ?? 3000);
  const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 3000;

  let appUrl = origin(options.appUrl ?? env.APP_URL);
  if (!appUrl) {
    if (onVercel) {
      const productionHost = text(env.VERCEL_PROJECT_PRODUCTION_URL);
      const deploymentHost = text(env.VERCEL_URL);
      const chosen = vercelEnv === 'production' ? productionHost || deploymentHost : deploymentHost;
      appUrl = chosen ? `https://${chosen}` : '';
    } else {
      appUrl = `http://localhost:${port}`;
    }
  }

  const sessionHours = integer(env.SESSION_MAX_AGE_HOURS, 12, 1, 72);
  const idleMinutes = integer(env.SESSION_IDLE_MINUTES, 60, 5, 720);
  const uploadMb = integer(env.MAX_UPLOAD_MB, MAX_UPLOAD_MB_CAP, 1, MAX_UPLOAD_MB_CAP);
  const secure = appUrl.startsWith('https://');

  return {
    root,
    onVercel,
    vercelEnv,
    production,
    commitSha: text(env.VERCEL_GIT_COMMIT_SHA),
    host: '127.0.0.1',
    port,
    appUrl,
    secureCookies: secure,
    trustProxy: onVercel || flag(env.TRUST_PROXY),
    serveStatic: options.serveStatic ?? !onVercel,
    localHostGuard: options.localHostGuard ?? !onVercel,
    publicDir: path.join(root, 'public'),
    adminDir: path.join(root, 'admin'),
    dataFile: path.join(root, 'public', 'data', 'portfolio.json'),
    imagesDir: path.join(root, 'public', 'images'),
    localBackupDir: path.join(root, 'data', 'backups'),
    maxUploadBytes: uploadMb * MB,
    maxBodyBytes: 1 * MB,
    session: {
      secret: text(env.SESSION_SECRET),
      maxAgeSeconds: sessionHours * 3600,
      idleSeconds: idleMinutes * 60,
      cookieName: secure ? '__Host-cms_session' : 'cms_session',
      oauthCookieName: secure ? '__Host-cms_oauth' : 'cms_oauth'
    },
    admin: {
      allowedEmails: emails(options.allowedEmails ?? env.ADMIN_ALLOWED_EMAILS),
      enabled: production || !onVercel || flag(env.ALLOW_ADMIN_ON_PREVIEW)
    },
    supabase: {
      url: origin(options.supabaseUrl ?? env.SUPABASE_URL),
      anonKey: text(options.supabaseAnonKey ?? env.SUPABASE_ANON_KEY),
      serviceKey: text(options.supabaseServiceKey ?? env.SUPABASE_SERVICE_ROLE_KEY),
      bucket: text(env.SUPABASE_STORAGE_BUCKET) || 'portfolio-images'
    },
    github: {
      apiUrl: origin(options.githubApiUrl ?? env.CMS_GITHUB_API_URL) || 'https://api.github.com',
      token: text(options.githubToken ?? env.CMS_GITHUB_TOKEN),
      owner: text(options.githubOwner ?? env.CMS_GITHUB_OWNER),
      repo: text(options.githubRepo ?? env.CMS_GITHUB_REPO),
      productionBranch: text(options.productionBranch ?? env.CMS_GITHUB_PRODUCTION_BRANCH) || 'master'
    },
    vercel: {
      apiUrl: origin(options.vercelApiUrl ?? env.CMS_VERCEL_API_URL) || 'https://api.vercel.com',
      token: text(options.vercelToken ?? env.CMS_VERCEL_TOKEN),
      projectId: text(options.vercelProjectId ?? env.CMS_VERCEL_PROJECT_ID),
      teamId: text(options.vercelTeamId ?? env.CMS_VERCEL_TEAM_ID),
      productionUrl: origin(options.productionUrl ?? env.CMS_PRODUCTION_URL)
    },
    deploy: {
      requirePreviewBeforeProduction: flag(options.requirePreview ?? env.CMS_REQUIRE_PREVIEW_BEFORE_PRODUCTION, true),
      branchPrefix: 'dev/',
      requestTimeoutMs: 10000
    }
  };
}

function missingSettings(config) {
  const secretProblem = config.session.secret.length >= 32 ? [] : ['SESSION_SECRET (at least 32 characters)'];
  const pick = (pairs) => pairs.filter(([, value]) => !value).map(([name]) => name);
  return {
    auth: [
      ...pick([
        ['SUPABASE_URL', config.supabase.url],
        ['SUPABASE_ANON_KEY', config.supabase.anonKey],
        ['APP_URL', config.appUrl],
        ['ADMIN_ALLOWED_EMAILS', config.admin.allowedEmails.size]
      ]),
      ...secretProblem
    ],
    data: pick([
      ['SUPABASE_URL', config.supabase.url],
      ['SUPABASE_SERVICE_ROLE_KEY', config.supabase.serviceKey]
    ]),
    public: pick([
      ['SUPABASE_URL', config.supabase.url],
      ['SUPABASE_ANON_KEY', config.supabase.anonKey]
    ]),
    github: pick([
      ['CMS_GITHUB_TOKEN', config.github.token],
      ['CMS_GITHUB_OWNER', config.github.owner],
      ['CMS_GITHUB_REPO', config.github.repo]
    ]),
    vercel: pick([
      ['CMS_VERCEL_TOKEN', config.vercel.token],
      ['CMS_VERCEL_PROJECT_ID', config.vercel.projectId]
    ])
  };
}

module.exports = { createConfig, missingSettings, MB };
