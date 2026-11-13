const crypto = require('crypto');
const cookies = require('../http/cookies');
const { ApiError } = require('../errors');

const OAUTH_TTL_SECONDS = 600;
const VERIFY_CACHE_MS = 30000;
const REFRESH_SKEW_SECONDS = 45;
const TOUCH_INTERVAL_SECONDS = 60;
const MAX_COOKIE_LENGTH = 3900;

function evaluateUser(user, allowedEmails) {
  const email = String((user && user.email) || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'no_email' };
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const google = identities.find((identity) => identity && identity.provider === 'google');
  if (!google) return { ok: false, reason: 'not_google', email };
  const data = google.identity_data || {};
  if (String(data.email || '').trim().toLowerCase() !== email) return { ok: false, reason: 'email_mismatch', email };
  if (data.email_verified === false || (data.email_verified !== true && !user.email_confirmed_at)) return { ok: false, reason: 'unverified', email };
  if (!allowedEmails.has(email)) return { ok: false, reason: 'not_allowed', email };
  const meta = user.user_metadata || {};
  return {
    ok: true,
    admin: {
      id: String(user.id),
      email,
      name: String(meta.full_name || meta.name || email).slice(0, 120),
      avatarUrl: /^https:\/\//i.test(meta.avatar_url || meta.picture || '') ? String(meta.avatar_url || meta.picture) : ''
    }
  };
}

function createAdminAuth({ config, gotrue, codec, now = () => Date.now() }) {
  const verifyCache = new Map();
  const nowSeconds = () => Math.floor(now() / 1000);
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const cookieOptions = (maxAge) => ({ maxAge, path: '/', secure: config.secureCookies, sameSite: 'Lax', httpOnly: true });

  function clear(res) {
    cookies.append(res, cookies.serialize(config.session.cookieName, '', cookieOptions(0)));
  }

  function writeSession(res, session) {
    const sealed = codec.seal({ typ: 'session', ...session });
    if (sealed.length > MAX_COOKIE_LENGTH) throw new ApiError(500, 'cookie_too_large', 'The session could not be stored.');
    const remaining = Math.max(1, session.started + config.session.maxAgeSeconds - nowSeconds());
    cookies.append(res, cookies.serialize(config.session.cookieName, sealed, cookieOptions(remaining)));
  }

  function startLogin() {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const url = gotrue.authorizeUrl({ redirectTo: `${config.appUrl}/api/auth/callback`, codeChallenge: challenge });
    const cookie = cookies.serialize(config.session.oauthCookieName, codec.seal({ typ: 'oauth', v: verifier, iat: nowSeconds() }), cookieOptions(OAUTH_TTL_SECONDS));
    return { url, cookie };
  }

  function clearOauthCookie(res) {
    cookies.append(res, cookies.serialize(config.session.oauthCookieName, '', cookieOptions(0)));
  }

  async function completeLogin(req, res) {
    const jar = cookies.parse(req.headers.cookie);
    const pending = codec.unseal(jar[config.session.oauthCookieName]);
    clearOauthCookie(res);
    if (!pending || pending.typ !== 'oauth' || typeof pending.v !== 'string' || nowSeconds() - Number(pending.iat) > OAUTH_TTL_SECONDS) {
      throw new ApiError(400, 'login_expired', 'The sign-in attempt expired. Start again.');
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || code.length > 2048) throw new ApiError(400, 'login_failed', 'The sign-in response was incomplete.');

    let tokens;
    try {
      tokens = await gotrue.exchangeCode({ authCode: code, codeVerifier: pending.v });
    } catch {
      throw new ApiError(400, 'login_failed', 'Sign-in could not be completed.');
    }
    if (!tokens || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
      throw new ApiError(400, 'login_failed', 'Sign-in could not be completed.');
    }

    const user = tokens.user || (await gotrue.getUser(tokens.access_token));
    const verdict = evaluateUser(user, config.admin.allowedEmails);
    if (!verdict.ok) {
      await gotrue.signOut(tokens.access_token).catch(() => {});
      const error = new ApiError(403, 'not_authorised', 'This Google account is not authorised for this CMS.');
      error.reason = verdict.reason;
      error.email = verdict.email || null;
      throw error;
    }

    const started = nowSeconds();
    const session = {
      sid: crypto.randomBytes(16).toString('hex'),
      at: tokens.access_token,
      rt: tokens.refresh_token,
      exp: Number(tokens.expires_at) || started + (Number(tokens.expires_in) || 3600),
      started,
      last: started
    };
    writeSession(res, session);
    return verdict.admin;
  }

  async function verify(token, fresh) {
    const key = hash(token);
    const cached = verifyCache.get(key);
    if (!fresh && cached && cached.until > now()) return cached.user;
    const user = await gotrue.getUser(token);
    if (verifyCache.size > 200) verifyCache.clear();
    verifyCache.set(key, { user, until: now() + VERIFY_CACHE_MS });
    return user;
  }

  function readSession(req) {
    const jar = cookies.parse(req.headers.cookie);
    const raw = jar[config.session.cookieName];
    if (!raw) return null;
    const session = codec.unseal(raw);
    if (!session || session.typ !== 'session' || typeof session.at !== 'string' || typeof session.rt !== 'string' || typeof session.sid !== 'string') return undefined;
    return session;
  }

  async function authenticate(req, res, { fresh = false } = {}) {
    const session = readSession(req);
    if (session === null) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
    if (session === undefined) {
      clear(res);
      throw new ApiError(401, 'invalid_session', 'Your session is not valid. Sign in again.');
    }

    const time = nowSeconds();
    if (time - Number(session.started) > config.session.maxAgeSeconds || time - Number(session.last || session.started) > config.session.idleSeconds) {
      clear(res);
      throw new ApiError(401, 'session_expired', 'Your session expired. Sign in again.');
    }

    let changed = false;
    if (Number(session.exp) - REFRESH_SKEW_SECONDS <= time) {
      try {
        const tokens = await gotrue.refresh(session.rt);
        if (!tokens || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') throw new Error('bad refresh');
        session.at = tokens.access_token;
        session.rt = tokens.refresh_token;
        session.exp = Number(tokens.expires_at) || time + (Number(tokens.expires_in) || 3600);
        changed = true;
      } catch {
        clear(res);
        throw new ApiError(401, 'session_expired', 'Your session expired. Sign in again.');
      }
    }

    let user;
    try {
      user = await verify(session.at, fresh);
    } catch (error) {
      if (error && error.status >= 400 && error.status < 500) {
        clear(res);
        throw new ApiError(401, 'session_expired', 'Your session expired. Sign in again.');
      }
      throw new ApiError(503, 'auth_unavailable', 'The sign-in service is unavailable. Try again shortly.');
    }

    const verdict = evaluateUser(user, config.admin.allowedEmails);
    if (!verdict.ok) {
      clear(res);
      const error = new ApiError(403, 'not_authorised', 'This account is not authorised for this CMS.');
      error.reason = verdict.reason;
      error.email = verdict.email || null;
      throw error;
    }

    if (changed || time - Number(session.last || 0) >= TOUCH_INTERVAL_SECONDS) {
      session.last = time;
      writeSession(res, session);
    }

    return { ...verdict.admin, sid: session.sid, expiresAt: new Date((Number(session.started) + config.session.maxAgeSeconds) * 1000).toISOString(), csrfToken: codec.csrf(session.sid) };
  }

  async function logout(req, res) {
    const session = readSession(req);
    clear(res);
    if (!session) return { hadSession: false };
    const supplied = req.headers['x-csrf-token'];
    if (!codec.verifyCsrf(session.sid, supplied)) throw new ApiError(403, 'csrf', 'Security token is missing or expired. Reload the page.');
    await gotrue.signOut(session.at).catch(() => {});
    verifyCache.delete(hash(session.at));
    return { hadSession: true };
  }

  return { startLogin, completeLogin, authenticate, logout, clear };
}

module.exports = { createAdminAuth, evaluateUser };
