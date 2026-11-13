const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const cookies = require('../server/http/cookies');
const { createSessionCodec } = require('../server/auth/session');
const { evaluateUser } = require('../server/auth/admin-auth');
const { createConfig, missingSettings } = require('../server/config');
const model = require('../server/content-model');
const { jsonBody } = require('../server/http/json-body');
const { createRateLimiter } = require('../server/rate-limit');
const { clientIp } = require('../server/http/client-ip');
const { SEED } = require('./support/harness');

test('cookie helpers reject unsafe input and emit hardened attributes', () => {
  assert.throws(() => cookies.serialize('a b', 'x'));
  assert.throws(() => cookies.serialize('a', 'x;y'));
  assert.throws(() => cookies.serialize('a', 'x\r\nSet-Cookie: b=1'));
  const line = cookies.serialize('__Host-s', 'v1.abc', { maxAge: 60 });
  assert.match(line, /HttpOnly/);
  assert.match(line, /Secure/);
  assert.match(line, /SameSite=Lax/);
  assert.match(line, /Path=\//);
  assert.match(cookies.serialize('s', '', { maxAge: 0 }), /Expires=Thu, 01 Jan 1970/);
  assert.deepEqual({ ...cookies.parse('a=1; b="two"; a=3; =x; c') }, { a: '1', b: 'two' });
});

test('the session codec seals, detects tampering and binds CSRF tokens to the session', () => {
  const codec = createSessionCodec('k'.repeat(40));
  const token = codec.seal({ typ: 'session', at: 'secret-access-token' });
  assert.ok(!token.includes('secret-access-token'));
  assert.deepEqual(codec.unseal(token), { typ: 'session', at: 'secret-access-token' });
  const parts = token.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  assert.equal(codec.unseal(parts.join('.')), null);
  assert.equal(codec.unseal('garbage'), null);
  assert.equal(codec.unseal(''), null);
  assert.equal(createSessionCodec('z'.repeat(40)).unseal(token), null);
  assert.equal(codec.verifyCsrf('sid1', codec.csrf('sid1')), true);
  assert.equal(codec.verifyCsrf('sid2', codec.csrf('sid1')), false);
  assert.equal(codec.verifyCsrf('sid1', ''), false);
  assert.equal(codec.verifyCsrf('sid1', undefined), false);
});

test('user evaluation demands a verified Google identity on the allowlist', () => {
  const allowed = new Set(['me@example.com']);
  const google = (overrides = {}) => ({ id: 'u1', email: 'Me@Example.com', email_confirmed_at: 'x', identities: [{ provider: 'google', identity_data: { email: 'me@example.com', email_verified: true } }], user_metadata: { full_name: 'Me', avatar_url: 'https://x/y.png' }, ...overrides });
  assert.equal(evaluateUser(google(), allowed).ok, true);
  assert.equal(evaluateUser(google(), allowed).admin.email, 'me@example.com');
  assert.equal(evaluateUser(google({ email: 'other@example.com', identities: [{ provider: 'google', identity_data: { email: 'other@example.com', email_verified: true } }] }), allowed).reason, 'not_allowed');
  assert.equal(evaluateUser(google({ identities: [] }), allowed).reason, 'not_google');
  assert.equal(evaluateUser(google({ identities: [{ provider: 'google', identity_data: { email: 'else@example.com', email_verified: true } }] }), allowed).reason, 'email_mismatch');
  assert.equal(evaluateUser(google({ identities: [{ provider: 'google', identity_data: { email: 'me@example.com', email_verified: false } }] }), allowed).reason, 'unverified');
  assert.equal(evaluateUser({}, allowed).reason, 'no_email');
  assert.equal(evaluateUser(null, allowed).reason, 'no_email');
  assert.equal(evaluateUser(google({ user_metadata: { avatar_url: 'javascript:alert(1)' } }), allowed).admin.avatarUrl, '');
});

test('configuration defaults, clamping and cookie naming', () => {
  const base = createConfig({ env: {}, appUrl: 'http://localhost:3000' });
  assert.equal(base.session.maxAgeSeconds, 12 * 3600);
  assert.equal(base.session.idleSeconds, 60 * 60);
  assert.equal(base.session.cookieName, 'cms_session');
  assert.equal(base.maxUploadBytes, 4 * 1024 * 1024);
  assert.equal(base.deploy.requirePreviewBeforeProduction, true);
  assert.equal(base.github.productionBranch, 'master');

  const secure = createConfig({ env: { SESSION_MAX_AGE_HOURS: '999', SESSION_IDLE_MINUTES: '1', MAX_UPLOAD_MB: '50' }, appUrl: 'https://example.com/path' });
  assert.equal(secure.appUrl, 'https://example.com');
  assert.equal(secure.session.cookieName, '__Host-cms_session');
  assert.equal(secure.secureCookies, true);
  assert.equal(secure.session.maxAgeSeconds, 72 * 3600);
  assert.equal(secure.session.idleSeconds, 5 * 60);
  assert.equal(secure.maxUploadBytes, 4 * 1024 * 1024);

  assert.equal(createConfig({ env: { APP_URL: 'javascript:alert(1)' } }).appUrl, 'http://localhost:3000');
  const vercelPreview = createConfig({ env: { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'x-abc.vercel.app' } });
  assert.equal(vercelPreview.admin.enabled, false);
  assert.equal(vercelPreview.appUrl, 'https://x-abc.vercel.app');
  assert.equal(vercelPreview.serveStatic, false);
  assert.equal(createConfig({ env: { VERCEL: '1', VERCEL_ENV: 'preview', ALLOW_ADMIN_ON_PREVIEW: 'true' } }).admin.enabled, true);
  const prod = createConfig({ env: { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'site.com' } });
  assert.equal(prod.admin.enabled, true);
  assert.equal(prod.appUrl, 'https://site.com');
  assert.equal(prod.trustProxy, true);
  assert.deepEqual([...createConfig({ env: { ADMIN_ALLOWED_EMAILS: ' A@x.com, b@y.org;not-an-email ' } }).admin.allowedEmails], ['a@x.com', 'b@y.org']);
});

test('missing settings name variables without revealing values', () => {
  const empty = missingSettings(createConfig({ env: {}, appUrl: 'http://localhost:3000' }));
  assert.ok(empty.auth.includes('SESSION_SECRET (at least 32 characters)'));
  assert.ok(empty.auth.includes('ADMIN_ALLOWED_EMAILS'));
  assert.deepEqual(empty.data, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const short = missingSettings(createConfig({ env: { SESSION_SECRET: 'short' }, appUrl: 'http://localhost:3000' }));
  assert.ok(short.auth.some((entry) => entry.startsWith('SESSION_SECRET')));
  assert.ok(!JSON.stringify(short).includes('short"'));
});

test('content comparison ignores key order, which Postgres jsonb does not preserve', () => {
  const a = { b: 1, a: { y: [1, { q: 1, p: 2 }], x: null } };
  const b = { a: { x: null, y: [1, { p: 2, q: 1 }] }, b: 1 };
  assert.equal(model.sameJson(a, b), true);
  assert.equal(model.sameJson(a, { ...b, b: 2 }), false);
  assert.equal(model.sameJson([1, 2], [2, 1]), false);
  const stamped = model.stamp(null, SEED, '2026-01-01T00:00:00.000Z');
  const reorder = (value) => (Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().reverse().map((key) => [key, reorder(value[key])])) : value);
  const reordered = reorder(stamped);
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(stamped));
  assert.equal(model.sameJson(model.bare(stamped), model.bare(reordered)), true);
});

function fakeRequest({ body, type = 'application/json', length, method = 'POST', lazy }) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  stream.method = method;
  stream.headers = { 'content-type': type, ...(length !== undefined ? { 'content-length': String(length) } : {}) };
  if (lazy) {
    Object.defineProperty(stream, 'body', { configurable: true, enumerable: true, get: lazy, set(value) { Object.defineProperty(stream, 'body', { configurable: true, writable: true, value }); } });
  }
  return stream;
}

const run = (middleware, req) => new Promise((resolve) => middleware(req, {}, (error) => resolve(error)));

test('JSON body parsing works in plain Node and when the platform has already parsed the body', async () => {
  const parse = jsonBody({ limitBytes: 1024 });
  const plain = fakeRequest({ body: '{"a":1}' });
  assert.equal(await run(parse, plain), undefined);
  assert.deepEqual(plain.body, { a: 1 });

  const helper = fakeRequest({ body: '{"a":1}', lazy: () => ({ a: 1, from: 'platform' }) });
  assert.equal(await run(parse, helper), undefined);
  assert.equal(helper.body.from, 'platform');

  const throwing = fakeRequest({ body: '{bad', lazy: () => { throw new Error('Invalid JSON'); } });
  assert.equal((await run(parse, throwing)).code, 'bad_json');
  assert.equal((await run(parse, fakeRequest({ body: '{bad' }))).code, 'bad_json');
  assert.equal((await run(parse, fakeRequest({ body: '"text"' }))).code, 'bad_json');
  assert.equal((await run(parse, fakeRequest({ body: '{}', length: 99999 }))).code, 'too_large');
  assert.equal((await run(parse, fakeRequest({ body: JSON.stringify({ x: 'y'.repeat(2000) }) }))).code, 'too_large');
  const empty = fakeRequest({ body: '' });
  assert.equal(await run(parse, empty), undefined);
  assert.deepEqual(empty.body, {});
  const get = fakeRequest({ body: '{"a":1}', method: 'GET' });
  assert.equal(await run(parse, get), undefined);
  assert.equal(get.body, undefined);
  const multipart = fakeRequest({ body: '--x', type: 'multipart/form-data; boundary=x' });
  assert.equal(await run(parse, multipart), undefined);
});

test('rate limiting falls back to a per-instance counter when the shared store fails', async () => {
  const errors = [];
  const limiter = createRateLimiter({ repo: { rateLimit: async () => { throw new Error('db down'); } }, trustProxy: false, log: { error: (line) => errors.push(line) } });
  const req = { headers: {}, socket: { remoteAddress: '203.0.113.9' } };
  const middleware = limiter.middleware({ name: 't', windowSeconds: 60, max: 2 });
  const results = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    results.push(await new Promise((resolve) => middleware(req, { setHeader() {} }, (error) => resolve(error ? error.status : 'ok'))));
  }
  assert.deepEqual(results, ['ok', 'ok', 429]);
  assert.equal(errors.length, 3);
});

test('client IP only trusts forwarding headers behind a trusted proxy', () => {
  const req = { headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }, socket: { remoteAddress: '::ffff:127.0.0.1' } };
  assert.equal(clientIp(req, false), '127.0.0.1');
  assert.equal(clientIp(req, true), '198.51.100.7');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': 'not-an-ip' }, socket: { remoteAddress: '127.0.0.1' } }, true), '127.0.0.1');
  assert.equal(clientIp({ headers: {}, socket: {} }, false), 'unknown');
});
