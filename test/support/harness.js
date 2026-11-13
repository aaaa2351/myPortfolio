const fs = require('fs');
const path = require('path');
const { createConfig } = require('../../server/config');
const { createApp } = require('../../server/app');
const { createMemoryRepo, createMemoryMedia } = require('./memory-repo');
const { startFakeGoTrue, startFakeGitHub, startFakeVercel } = require('./fakes');

const ROOT = path.resolve(__dirname, '..', '..');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'portfolio.json'), 'utf8'));

function createClient(base) {
  const jar = new Map();
  const state = { csrf: '' };

  async function raw(pathname, { method = 'GET', json, body, headers = {}, redirect = 'manual', origin = base, sendCsrf = true } = {}) {
    const sent = { ...headers };
    if (jar.size) sent.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (method !== 'GET' && method !== 'HEAD') {
      if (origin) sent.origin = origin;
      if (sendCsrf && state.csrf) sent['x-csrf-token'] = state.csrf;
    }
    let payload = body;
    if (json !== undefined) {
      sent['content-type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    const response = await fetch(base + pathname, { method, headers: sent, body: payload, redirect });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (/Max-Age=0/i.test(line) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  }

  async function call(pathname, options) {
    const response = await raw(pathname, options);
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  return { raw, call, jar, state, base };
}

async function createHarness(options = {}) {
  const gotrue = await startFakeGoTrue({ expiresIn: options.expiresIn || 3600 });
  const github = await startFakeGitHub();
  const vercel = await startFakeVercel();
  const clock = { offsetMs: 0 };
  const nowMs = () => Date.now() + clock.offsetMs;
  const repo = options.repo || createMemoryRepo({ now: () => new Date(nowMs()) });
  const media = createMemoryMedia();
  const config = createConfig({
    env: { SESSION_SECRET: 's'.repeat(48), ...(options.env || {}) },
    appUrl: 'http://127.0.0.1:1',
    allowedEmails: options.allowedEmails === undefined ? 'admin@example.com' : options.allowedEmails,
    supabaseUrl: options.noSupabase ? '' : gotrue.url,
    supabaseAnonKey: 'anon-key-test',
    supabaseServiceKey: 'service-key-test',
    githubApiUrl: github.url,
    githubToken: options.noGithub ? '' : 'gh-token-test',
    githubOwner: 'o',
    githubRepo: 'r',
    productionBranch: 'master',
    vercelApiUrl: vercel.url,
    vercelToken: options.noVercel ? '' : 'vc-token-test',
    vercelProjectId: 'prj_test',
    productionUrl: options.productionUrl || '',
    requirePreview: options.requirePreview === undefined ? true : options.requirePreview,
    serveStatic: Boolean(options.serveStatic),
    localHostGuard: false
  });
  if (options.mutateConfig) options.mutateConfig(config);

  const fetchImpl = options.fetch || fetch;
  const { app, services } = createApp(config, { repo, media, now: nowMs, nowMs, fetch: fetchImpl });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  config.appUrl = base;

  async function login(client, email = 'admin@example.com', user) {
    const start = await client.raw('/api/auth/login');
    const location = new URL(start.headers.get('location'));
    const code = gotrue.issueCode(user || gotrue.googleUser(email), location.searchParams.get('code_challenge'));
    const callback = await client.raw(`/api/auth/callback?code=${code}`);
    const session = await client.call('/api/auth/session');
    if (session.body && session.body.csrfToken) client.state.csrf = session.body.csrfToken;
    return { start, callback, session };
  }

  async function signedInClient(email) {
    const client = createClient(base);
    await login(client, email);
    return client;
  }

  async function close() {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await Promise.all([gotrue.close(), github.close(), vercel.close()]);
  }

  return { base, config, repo, media, gotrue, github, vercel, clock, services, seed: SEED, createClient: () => createClient(base), login, signedInClient, close };
}

module.exports = { createHarness, createClient, SEED, ROOT };
