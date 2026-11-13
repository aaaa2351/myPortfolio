class GoTrueError extends Error {
  constructor(status, body) {
    super((body && (body.msg || body.message || body.error_description || body.error)) || `Auth request failed (${status}).`);
    this.name = 'GoTrueError';
    this.status = status;
    this.body = body || null;
  }
}

function createGoTrue({ url, anonKey, fetchImpl = fetch, timeoutMs = 8000 }) {
  const base = `${url}/auth/v1`;

  async function call(method, pathname, { query, body, token } = {}) {
    const target = new URL(`${base}${pathname}`);
    for (const [key, value] of Object.entries(query || {})) target.searchParams.set(key, value);
    const headers = { apikey: anonKey, Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    } catch (error) {
      throw new GoTrueError(0, { message: `Auth service unreachable: ${error.name}` });
    }
    let data = null;
    const raw = await response.text();
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }
    if (!response.ok) throw new GoTrueError(response.status, data);
    return data;
  }

  return {
    authorizeUrl({ redirectTo, codeChallenge }) {
      const target = new URL(`${base}/authorize`);
      target.searchParams.set('provider', 'google');
      target.searchParams.set('redirect_to', redirectTo);
      target.searchParams.set('code_challenge', codeChallenge);
      target.searchParams.set('code_challenge_method', 's256');
      target.searchParams.set('prompt', 'select_account');
      return target.toString();
    },
    exchangeCode: ({ authCode, codeVerifier }) => call('POST', '/token', { query: { grant_type: 'pkce' }, body: { auth_code: authCode, code_verifier: codeVerifier } }),
    refresh: (refreshToken) => call('POST', '/token', { query: { grant_type: 'refresh_token' }, body: { refresh_token: refreshToken } }),
    getUser: (accessToken) => call('GET', '/user', { token: accessToken }),
    signOut: (accessToken) => call('POST', '/logout', { query: { scope: 'local' }, token: accessToken })
  };
}

module.exports = { createGoTrue, GoTrueError };
