const http = require('http');
const crypto = require('crypto');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      const url = new URL(req.url, 'http://fake');
      const reply = (status, data, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(data === undefined ? '' : JSON.stringify(data));
      };
      try {
        await handler({ req, url, body, reply });
      } catch (error) {
        reply(500, { message: error.message });
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }) }));
  });
}

async function startFakeGoTrue({ expiresIn = 3600 } = {}) {
  const state = { codes: new Map(), tokens: new Map(), refresh: new Map(), revoked: new Set(), requests: [], counter: 0, expiresIn };

  function issue(user) {
    const n = ++state.counter;
    const access = `at_${n}_${crypto.randomBytes(6).toString('hex')}`;
    const refresh = `rt_${n}_${crypto.randomBytes(6).toString('hex')}`;
    state.tokens.set(access, user);
    state.refresh.set(refresh, user);
    return { access_token: access, refresh_token: refresh, expires_in: state.expiresIn, expires_at: Math.floor(Date.now() / 1000) + state.expiresIn, token_type: 'bearer', user };
  }

  const handle = ({ req, url, body, reply }) => {
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    if (req.headers.apikey !== 'anon-key-test') return reply(401, { message: 'No API key found in request' });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const entry = state.codes.get(body && body.auth_code);
      if (!entry) return reply(400, { error_code: 'flow_state_not_found', msg: 'invalid flow state' });
      const challenge = crypto.createHash('sha256').update(String(body.code_verifier)).digest('base64url');
      if (challenge !== entry.challenge) return reply(400, { error_code: 'bad_code_verifier', msg: 'code challenge does not match' });
      state.codes.delete(body.auth_code);
      return reply(200, issue(entry.user));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const user = state.refresh.get(body && body.refresh_token);
      if (!user || state.revoked.has(body.refresh_token)) return reply(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      state.refresh.delete(body.refresh_token);
      return reply(200, issue(user));
    }
    if (url.pathname === '/auth/v1/user') {
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const user = state.tokens.get(token);
      if (!user || state.revoked.has(token)) return reply(401, { msg: 'invalid JWT' });
      return reply(200, user);
    }
    if (url.pathname === '/auth/v1/logout') {
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      state.revoked.add(token);
      return reply(204);
    }
    return reply(404, { msg: 'not found' });
  };

  const fake = await listen(handle);
  return {
    ...fake,
    state,
    googleUser(email, extra = {}) {
      return {
        id: `user-${crypto.createHash('sha1').update(email).digest('hex').slice(0, 12)}`,
        email,
        email_confirmed_at: '2026-01-01T00:00:00Z',
        app_metadata: { provider: 'google', providers: ['google'] },
        user_metadata: { full_name: 'Test Admin', avatar_url: 'https://lh3.googleusercontent.com/a/test' },
        identities: [{ provider: 'google', identity_data: { email, email_verified: true } }],
        ...extra
      };
    },
    issueCode(user, challenge) {
      const code = crypto.randomBytes(12).toString('hex');
      state.codes.set(code, { user, challenge });
      return code;
    },
    expireAccessTokens() {
      state.tokens.clear();
    }
  };
}

async function startFakeGitHub() {
  const sha = (n) => String(n).padStart(40, 'a').slice(-40);
  const state = {
    requests: [],
    branches: { master: sha(3), 'dev/redesign': sha(2) },
    commits: [
      { sha: sha(3), message: 'Ship contact form\n\nBody text', author: 'Okiki', date: '2026-11-10T10:00:00Z' },
      { sha: sha(2), message: 'Tweak hero', author: 'Okiki', date: '2026-11-09T10:00:00Z' },
      { sha: sha(1), message: 'Initial portfolio', author: 'Okiki', date: '2026-11-01T10:00:00Z' }
    ],
    ancestors: { master: [sha(3), sha(2), sha(1)], 'dev/redesign': [sha(2), sha(1)] },
    forbiddenBranches: new Set(),
    sha
  };
  const commitJson = (c) => ({ sha: c.sha, html_url: `https://github.com/o/r/commit/${c.sha}`, commit: { message: c.message, author: { name: c.author, date: c.date } }, author: { login: 'okiki' } });

  const fake = await listen(({ req, url, body, reply }) => {
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    if (req.headers.authorization !== 'Bearer gh-token-test') return reply(401, { message: 'Bad credentials' });
    const p = decodeURIComponent(url.pathname);
    if (p === '/repos/o/r') return reply(200, { id: 42, full_name: 'o/r', default_branch: 'master', private: true, html_url: 'https://github.com/o/r', permissions: { push: true } });
    if (p === '/repos/o/r/branches') return reply(200, Object.entries(state.branches).map(([name, head]) => ({ name, protected: name === 'master', commit: { sha: head } })));
    const branchMatch = /^\/repos\/o\/r\/branches\/(.+)$/.exec(p);
    if (branchMatch) {
      const head = state.branches[branchMatch[1]];
      if (!head) return reply(404, { message: 'Branch not found' });
      return reply(200, { name: branchMatch[1], protected: branchMatch[1] === 'master', commit: commitJson(state.commits.find((c) => c.sha === head)) });
    }
    if (p === '/repos/o/r/commits') {
      const list = (state.ancestors[url.searchParams.get('sha')] || []).map((s) => commitJson(state.commits.find((c) => c.sha === s)));
      return reply(200, list);
    }
    const commitMatch = /^\/repos\/o\/r\/commits\/([0-9a-f]+)$/.exec(p);
    if (commitMatch) {
      const found = state.commits.find((c) => c.sha === commitMatch[1]);
      return found ? reply(200, commitJson(found)) : reply(404, { message: 'No commit found' });
    }
    const compareMatch = /^\/repos\/o\/r\/compare\/([0-9a-f]+)\.\.\.(.+)$/.exec(p);
    if (compareMatch) {
      const list = state.ancestors[compareMatch[2]];
      if (!list) return reply(404, { message: 'Not Found' });
      const index = list.indexOf(compareMatch[1]);
      if (index === -1) return reply(200, { status: 'diverged' });
      return reply(200, { status: index === 0 ? 'identical' : 'ahead' });
    }
    if (p === '/repos/o/r/git/refs' && req.method === 'POST') {
      const name = String(body.ref).replace('refs/heads/', '');
      if (state.branches[name]) return reply(422, { message: 'Reference already exists' });
      state.branches[name] = body.sha;
      state.ancestors[name] = [body.sha];
      return reply(201, { ref: body.ref, object: { sha: body.sha } });
    }
    return reply(404, { message: 'Not Found' });
  });
  return { ...fake, state };
}

async function startFakeVercel() {
  const state = { requests: [], deployments: [], project: { id: 'prj_test', name: 'portfolio', framework: null, targets: { production: null } }, counter: 0, failRollback: false };

  function make({ sha, ref, target, readyState = 'READY', substate = null, createdAt }) {
    const n = ++state.counter;
    const id = `dpl_${String(n).padStart(8, '0')}test`;
    const deployment = {
      uid: id,
      id,
      url: `portfolio-${n}.vercel.app`,
      readyState,
      state: readyState,
      readySubstate: substate,
      target: target || null,
      created: createdAt || Date.now() - (100 - n) * 60000,
      createdAt: createdAt || Date.now() - (100 - n) * 60000,
      ready: (createdAt || Date.now() - (100 - n) * 60000) + 30000,
      meta: { githubCommitSha: sha, githubCommitRef: ref, githubCommitMessage: `commit ${sha.slice(0, 7)}` },
      creator: { username: 'okiki' },
      inspectorUrl: `https://vercel.com/team/portfolio/${id}`,
      alias: target === 'production' ? ['portfolio.example.com'] : []
    };
    state.deployments.push(deployment);
    return deployment;
  }

  const fake = await listen(({ req, url, body, reply }) => {
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    if (req.headers.authorization !== 'Bearer vc-token-test') return reply(403, { error: { message: 'Not authorized' } });
    const p = url.pathname;
    if (p === '/v9/projects/prj_test') return reply(200, state.project);
    if (p === '/v6/deployments') {
      let list = [...state.deployments];
      if (url.searchParams.get('target')) list = list.filter((d) => d.target === url.searchParams.get('target'));
      if (url.searchParams.get('state')) list = list.filter((d) => d.readyState === url.searchParams.get('state'));
      list.sort((a, b) => b.created - a.created);
      return reply(200, { deployments: list.slice(0, Number(url.searchParams.get('limit') || 20)) });
    }
    const getMatch = /^\/v13\/deployments\/(dpl_[A-Za-z0-9]+)$/.exec(p);
    if (getMatch && req.method === 'GET') {
      const found = state.deployments.find((d) => d.id === getMatch[1]);
      return found ? reply(200, found) : reply(404, { error: { message: 'not found' } });
    }
    if (p === '/v13/deployments' && req.method === 'POST') {
      if (!body || !body.gitSource || !body.name) return reply(400, { error: { message: 'invalid body' } });
      const created = make({ sha: body.gitSource.sha, ref: body.gitSource.ref, target: body.target, readyState: 'QUEUED', substate: body.target === 'production' ? 'STAGED' : null, createdAt: Date.now() });
      return reply(200, created);
    }
    const promoteMatch = /^\/v10\/projects\/prj_test\/promote\/(dpl_[A-Za-z0-9]+)$/.exec(p);
    if (promoteMatch && req.method === 'POST') {
      const found = state.deployments.find((d) => d.id === promoteMatch[1]);
      if (!found) return reply(404, { error: { message: 'not found' } });
      found.readySubstate = 'PROMOTED';
      state.project.targets.production = { id: found.id };
      return reply(201);
    }
    const rollbackMatch = /^\/v1\/projects\/prj_test\/rollback\/(dpl_[A-Za-z0-9]+)$/.exec(p);
    if (rollbackMatch && req.method === 'POST') {
      if (state.failRollback) return reply(422, { error: { message: 'Cannot rollback to this deployment' } });
      state.project.targets.production = { id: rollbackMatch[1] };
      return reply(201);
    }
    return reply(404, { error: { message: 'unknown route' } });
  });
  return { ...fake, state, make };
}

module.exports = { startFakeGoTrue, startFakeGitHub, startFakeVercel };
