const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./support/harness');

const ADMIN_ROUTES = [
  ['GET', '/api/admin/content'],
  ['PUT', '/api/admin/content'],
  ['GET', '/api/admin/status'],
  ['GET', '/api/admin/images'],
  ['POST', '/api/admin/images'],
  ['DELETE', '/api/admin/images/00000000-0000-4000-8000-000000000001'],
  ['GET', '/api/admin/backups'],
  ['GET', '/api/admin/backups/portfolio-20260101-000000-000.json'],
  ['POST', '/api/admin/backups/portfolio-20260101-000000-000.json/restore'],
  ['GET', '/api/admin/publishing'],
  ['GET', '/api/admin/publications/1'],
  ['POST', '/api/admin/publish'],
  ['POST', '/api/admin/publications/1/republish'],
  ['GET', '/api/admin/audit'],
  ['GET', '/api/admin/deploy/overview'],
  ['GET', '/api/admin/deploy/branches'],
  ['POST', '/api/admin/deploy/branches'],
  ['GET', '/api/admin/deploy/commits'],
  ['GET', '/api/admin/deploy/deployments'],
  ['GET', '/api/admin/deploy/deployments/dpl_abcdef123456'],
  ['GET', '/api/admin/deploy/deployments/dpl_abcdef123456/verify'],
  ['POST', '/api/admin/deploy/deployments/dpl_abcdef123456/promote'],
  ['POST', '/api/admin/deploy/previews'],
  ['POST', '/api/admin/deploy/production'],
  ['GET', '/api/admin/deploy/rollbacks'],
  ['POST', '/api/admin/deploy/rollbacks'],
  ['GET', '/api/admin/does-not-exist']
];

test('login starts a PKCE flow with a sealed, httpOnly verifier cookie', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = h.createClient();
  const res = await client.raw('/api/auth/login');
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin, h.gotrue.url);
  assert.equal(location.pathname, '/auth/v1/authorize');
  assert.equal(location.searchParams.get('provider'), 'google');
  assert.equal(location.searchParams.get('redirect_to'), `${h.base}/api/auth/callback`);
  assert.equal(location.searchParams.get('code_challenge_method'), 's256');
  assert.match(location.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  const cookie = res.headers.getSetCookie().find((line) => line.startsWith('cms_oauth='));
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=600/);
  assert.ok(!cookie.includes(location.searchParams.get('code_challenge')));
});

test('successful Google sign-in creates a secure session and a CSRF token', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = h.createClient();
  const { callback, session } = await h.login(client);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/admin/');
  const sessionCookie = callback.headers.getSetCookie().find((line) => line.startsWith('cms_session='));
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.match(sessionCookie, /Path=\//);
  assert.ok(callback.headers.getSetCookie().some((line) => line.startsWith('cms_oauth=;') && /Max-Age=0/.test(line)));
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.user.email, 'admin@example.com');
  assert.match(session.body.csrfToken, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(session.body).includes('at_'));
  const content = await client.call('/api/admin/content');
  assert.equal(content.status, 200);
});

test('a code that was not issued for this browser verifier is rejected', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = h.createClient();
  await client.raw('/api/auth/login');
  const code = h.gotrue.issueCode(h.gotrue.googleUser('admin@example.com'), 'attackerchallengeattackerchallengeattack0');
  const res = await client.raw(`/api/auth/callback?code=${code}`);
  assert.equal(res.headers.get('location'), '/admin/?auth_error=login_failed');
  assert.ok(!client.jar.has('cms_session'));
});

test('Google accounts outside the allowlist are refused, signed out and audited', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = h.createClient();
  const { callback } = await h.login(client, 'stranger@example.com');
  assert.equal(callback.headers.get('location'), '/admin/?auth_error=not_authorised');
  assert.ok(!client.jar.has('cms_session'));
  assert.equal(h.gotrue.state.revoked.size, 1);
  const denied = h.repo.state.audit.find((entry) => entry.action === 'auth.denied');
  assert.ok(denied);
  assert.equal(denied.outcome, 'denied');
  assert.equal(denied.actor, 'stranger@example.com');
  assert.equal(denied.details.reason, 'not_allowed');
  assert.equal((await client.call('/api/admin/content')).status, 401);
});

test('allowlist matching ignores case and requires an exact address', async (t) => {
  const h = await createHarness({ allowedEmails: 'Admin@Example.com' });
  t.after(h.close);
  const client = h.createClient();
  const { session } = await h.login(client, 'admin@example.com');
  assert.equal(session.body.authenticated, true);
  const other = h.createClient();
  const { callback } = await h.login(other, 'admin@example.com.evil.test');
  assert.match(callback.headers.get('location'), /not_authorised/);
});

test('an allowlisted email that is not a verified Google identity is refused', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const emailOnly = h.gotrue.googleUser('admin@example.com', { identities: [{ provider: 'email', identity_data: { email: 'admin@example.com' } }] });
  const first = h.createClient();
  const a = await h.login(first, 'admin@example.com', emailOnly);
  assert.match(a.callback.headers.get('location'), /not_authorised/);
  const unverified = h.gotrue.googleUser('admin@example.com', { email_confirmed_at: null, identities: [{ provider: 'google', identity_data: { email: 'admin@example.com', email_verified: false } }] });
  const second = h.createClient();
  const b = await h.login(second, 'admin@example.com', unverified);
  assert.match(b.callback.headers.get('location'), /not_authorised/);
  assert.deepEqual(
    h.repo.state.audit.filter((entry) => entry.action === 'auth.denied').map((entry) => entry.details.reason),
    ['not_google', 'unverified']
  );
});

test('callback without the verifier cookie, or with a provider error, does not sign anyone in', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = h.createClient();
  assert.equal((await client.raw('/api/auth/callback?code=abc')).headers.get('location'), '/admin/?auth_error=login_expired');
  assert.equal((await client.raw('/api/auth/callback?error=access_denied')).headers.get('location'), '/admin/?auth_error=login_cancelled');
  assert.equal(client.jar.size, 0);
});

test('every admin endpoint rejects unauthenticated requests on the server', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = h.createClient();
  for (const [method, path] of ADMIN_ROUTES) {
    const res = await client.call(path, { method, json: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${path} returned ${res.status}`);
    assert.equal(res.body.code, 'unauthenticated');
  }
  assert.equal(h.repo.state.draft, null);
  assert.equal(h.github.state.requests.length, 0);
  assert.equal(h.vercel.state.requests.length, 0);
});

test('the router registers no admin route outside the auth guard', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const { createApp } = require('../server/app');
  const { app } = createApp(h.config, { repo: h.repo, media: h.media });
  const layer = app._router.stack.find((entry) => entry.handle && entry.handle.stack && entry.regexp.test('/api/admin/x'));
  assert.ok(layer && layer.handle.stack, 'admin router mounted');
  const stack = layer.handle.stack;
  const guardIndex = stack.findIndex((entry) => entry.name === 'guard');
  assert.ok(guardIndex >= 0, 'guard present');
  const firstRoute = stack.findIndex((entry) => entry.route);
  assert.ok(guardIndex < firstRoute, 'guard runs before every route');
});

test('tampered, foreign and replayed cookies are rejected', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const good = client.jar.get('cms_session');
  const forged = h.createClient();
  forged.jar.set('cms_session', good.slice(0, -4) + 'AAAA');
  assert.equal((await forged.call('/api/admin/content')).body.code, 'invalid_session');
  const oauthOnly = h.createClient();
  await oauthOnly.raw('/api/auth/login');
  oauthOnly.jar.set('cms_session', oauthOnly.jar.get('cms_oauth'));
  assert.equal((await oauthOnly.call('/api/admin/content')).body.code, 'invalid_session');
});

test('state-changing requests need a same-origin Origin and the CSRF token', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const noToken = await client.call('/api/admin/publish', { method: 'POST', json: { revision: 1 }, sendCsrf: false });
  assert.equal(noToken.status, 403);
  assert.equal(noToken.body.code, 'csrf');
  const badToken = await client.call('/api/admin/publish', { method: 'POST', json: { revision: 1 }, headers: { 'x-csrf-token': 'f'.repeat(64) }, sendCsrf: false });
  assert.equal(badToken.body.code, 'csrf');
  const foreign = await client.call('/api/admin/publish', { method: 'POST', json: { revision: 1 }, origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'bad_origin');
  const missingOrigin = await client.call('/api/admin/publish', { method: 'POST', json: { revision: 1 }, origin: '' });
  assert.equal(missingOrigin.body.code, 'bad_origin');
  const crossSite = await client.call('/api/admin/publish', { method: 'POST', json: { revision: 1 }, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.body.code, 'bad_origin');
  assert.equal(h.repo.state.publications.length, 0);
});

test('sessions expire after the absolute lifetime and after idling', async (t) => {
  const h = await createHarness({ expiresIn: 86400 });
  t.after(h.close);
  const idle = await h.signedInClient();
  assert.equal((await idle.call('/api/admin/content')).status, 200);
  h.clock.offsetMs = 61 * 60 * 1000;
  const expired = await idle.call('/api/admin/content');
  assert.equal(expired.status, 401);
  assert.equal(expired.body.code, 'session_expired');
  assert.ok(!idle.jar.has('cms_session'));

  h.clock.offsetMs = 0;
  const long = await h.signedInClient();
  for (let hour = 1; hour <= 12; hour += 1) {
    h.clock.offsetMs = hour * 50 * 60 * 1000;
    const res = await long.call('/api/admin/content');
    if (res.status !== 200) assert.equal(res.body.code, 'session_expired');
  }
  h.clock.offsetMs = 13 * 3600 * 1000;
  assert.equal((await long.call('/api/admin/content')).body.code, 'session_expired');
});

test('an expired access token is refreshed server-side and the cookie is rotated', async (t) => {
  const h = await createHarness({ expiresIn: 1800 });
  t.after(h.close);
  const client = await h.signedInClient();
  const before = client.jar.get('cms_session');
  h.clock.offsetMs = 40 * 60 * 1000;
  const res = await client.call('/api/admin/content');
  assert.equal(res.status, 200);
  assert.notEqual(client.jar.get('cms_session'), before);
  assert.ok(h.gotrue.state.requests.some((request) => request.query.grant_type === 'refresh_token'));
});

test('tokens revoked at the provider stop working immediately for sensitive actions', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  assert.equal((await client.call('/api/admin/deploy/overview')).status, 200);
  for (const token of h.gotrue.state.tokens.keys()) h.gotrue.state.revoked.add(token);
  const res = await client.call('/api/admin/deploy/branches', { method: 'POST', json: { name: 'x', from: 'master' } });
  assert.equal(res.status, 401);
  assert.equal(h.github.state.requests.filter((request) => request.method === 'POST').length, 0);
});

test('logout needs the CSRF token, revokes the session upstream and clears the cookie', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const blocked = await client.call('/api/auth/logout', { method: 'POST', json: {}, sendCsrf: false });
  assert.equal(blocked.status, 403);
  const fresh = await h.signedInClient();
  const out = await fresh.call('/api/auth/logout', { method: 'POST', json: {} });
  assert.equal(out.status, 200);
  assert.ok(!fresh.jar.has('cms_session'));
  assert.ok(h.gotrue.state.revoked.size >= 1);
  assert.equal((await fresh.call('/api/auth/session')).body.authenticated, false);
  assert.equal((await fresh.call('/api/admin/content')).status, 401);
  assert.ok(h.repo.state.audit.some((entry) => entry.action === 'auth.logout'));
});

test('login and callback are rate limited per client address', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = h.createClient();
  let last;
  for (let attempt = 0; attempt < 21; attempt += 1) last = await client.raw('/api/auth/login');
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) >= 1);
});

test('admin is refused on non-production deployments and when auth is not configured', async (t) => {
  const disabled = await createHarness({ mutateConfig: (config) => { config.admin.enabled = false; } });
  t.after(disabled.close);
  const client = disabled.createClient();
  assert.equal((await client.call('/api/auth/session')).body.reason, 'admin_disabled');
  assert.equal((await client.call('/api/admin/content')).body.code, 'admin_disabled');
  assert.equal((await client.raw('/api/auth/login')).headers.get('location'), '/admin/?auth_error=admin_disabled');

  const bare = await createHarness({ noSupabase: true });
  t.after(bare.close);
  const other = bare.createClient();
  assert.equal((await other.call('/api/auth/session')).body.reason, 'not_configured');
  assert.equal((await other.call('/api/admin/content')).status, 503);
});

test('empty allowlist locks everyone out', async (t) => {
  const h = await createHarness({ allowedEmails: '' });
  t.after(h.close);
  const client = h.createClient();
  assert.equal((await client.call('/api/auth/session')).body.reason, 'not_configured');
  assert.equal((await client.raw('/api/auth/login')).headers.get('location'), '/admin/?auth_error=not_configured');
});
