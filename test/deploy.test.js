const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./support/harness');
const { isValidBranchName } = require('../server/deploy/service');

const sha = (n) => String(n).padStart(40, 'a').slice(-40);

async function setup(options = {}) {
  const h = await createHarness({ productionUrl: 'https://portfolio.example.com', ...options });
  const older = h.vercel.make({ sha: sha(1), ref: 'master', target: 'production', substate: 'PROMOTED' });
  const current = h.vercel.make({ sha: sha(2), ref: 'master', target: 'production', substate: 'PROMOTED' });
  const preview = h.vercel.make({ sha: sha(3), ref: 'master', target: null });
  h.vercel.state.project.targets.production = { id: current.id };
  const client = await h.signedInClient();
  return { h, client, older, current, preview };
}

const posts = (fake) => fake.state.requests.filter((request) => request.method !== 'GET');

test('overview reports connection status, current production and latest successful deployment', async (t) => {
  const { h, client, current } = await setup();
  t.after(h.close);
  const res = await client.call('/api/admin/deploy/overview');
  assert.equal(res.status, 200);
  assert.equal(res.body.github.connected, true);
  assert.equal(res.body.github.fullName, 'o/r');
  assert.equal(res.body.vercel.connected, true);
  assert.equal(res.body.vercel.name, 'portfolio');
  assert.equal(res.body.production.id, current.id);
  assert.equal(res.body.production.shortSha, sha(2).slice(0, 7));
  assert.equal(res.body.latestSuccessful.state, 'READY');
  assert.equal(res.body.productionBranch, 'master');
  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes('gh-token-test') && !serialized.includes('vc-token-test'));
  assert.ok(h.github.state.requests.every((request) => request.headers.authorization === 'Bearer gh-token-test'));
  assert.ok(h.vercel.state.requests.every((request) => request.headers.authorization === 'Bearer vc-token-test'));
});

test('unconfigured integrations report exactly which variables are missing and call nothing', async (t) => {
  const h = await createHarness({ noGithub: true, noVercel: true });
  t.after(h.close);
  const client = await h.signedInClient();
  const overview = await client.call('/api/admin/deploy/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.github.connected, false);
  assert.deepEqual(overview.body.missing.github, ['CMS_GITHUB_TOKEN']);
  assert.deepEqual(overview.body.missing.vercel, ['CMS_VERCEL_TOKEN']);
  const branches = await client.call('/api/admin/deploy/branches');
  assert.equal(branches.status, 503);
  assert.equal(branches.body.code, 'not_configured');
  assert.equal(h.github.state.requests.length, 0);
  assert.equal(h.vercel.state.requests.length, 0);
});

test('branches and commits show history, production marker and deployment state', async (t) => {
  const { h, client } = await setup();
  t.after(h.close);
  const branches = (await client.call('/api/admin/deploy/branches')).body.branches;
  const master = branches.find((branch) => branch.name === 'master');
  assert.equal(master.isProduction, true);
  assert.equal(master.protected, true);
  assert.equal(master.deployment.state, 'READY');
  assert.equal(branches.find((branch) => branch.name === 'dev/redesign').isProduction, false);
  const commits = (await client.call('/api/admin/deploy/commits?branch=master')).body.commits;
  assert.equal(commits.length, 3);
  assert.equal(commits[0].message, 'Ship contact form');
  assert.equal(commits[0].shortSha, sha(3).slice(0, 7));
  assert.equal(commits[0].deployments.length, 1);
  assert.equal((await client.call('/api/admin/deploy/commits?branch=../etc')).status, 400);
});

test('creating a development branch is create-only and never touches production', async (t) => {
  const { h, client } = await setup();
  t.after(h.close);
  const created = await client.call('/api/admin/deploy/branches', { method: 'POST', json: { name: 'new-idea', from: 'master' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.branch.name, 'dev/new-idea');
  assert.equal(created.body.branch.sha, sha(3));
  const request = h.github.state.requests.find((entry) => entry.method === 'POST');
  assert.equal(request.path, '/repos/o/r/git/refs');
  assert.deepEqual(request.body, { ref: 'refs/heads/dev/new-idea', sha: sha(3) });
  assert.equal((await client.call('/api/admin/deploy/branches', { method: 'POST', json: { name: 'new-idea', from: 'master' } })).status, 409);
  assert.equal((await client.call('/api/admin/deploy/branches', { method: 'POST', json: { name: 'from-sha', from: sha(1) } })).status, 201);
  for (const bad of ['..', 'a b', 'x..y', 'dev/', 'x.lock', 'a//b', '~x', 'x^y', '']) {
    const res = await client.call('/api/admin/deploy/branches', { method: 'POST', json: { name: bad, from: 'master' } });
    assert.equal(res.status, 400, `branch name "${bad}" should be rejected`);
  }
  assert.equal((await client.call('/api/admin/deploy/branches', { method: 'POST', json: { name: 'x', from: 'missing-branch' } })).status, 404);
  assert.ok(h.repo.state.events.some((event) => event.kind === 'branch_created' && event.ref === 'dev/new-idea'));
});

test('branch name validation matches git ref rules', () => {
  for (const ok of ['dev/feature-1', 'dev/a.b_c', 'feature/x']) assert.equal(isValidBranchName(ok), true, ok);
  for (const bad of ['', '/x', 'x/', 'a..b', 'a b', 'a\\b', 'x.lock', 'dev/.hidden', 'dev/x.lock', 'a@{b', 'a:b', 'a*b', 'a?b', 'a[b', 'x'.repeat(120), null, undefined, 5]) {
    assert.equal(isValidBranchName(bad), false, String(bad));
  }
});

test('previews build a chosen branch commit as a non-production deployment', async (t) => {
  const { h, client } = await setup();
  t.after(h.close);
  const res = await client.call('/api/admin/deploy/previews', { method: 'POST', json: { ref: 'dev/redesign' } });
  assert.equal(res.status, 202);
  assert.equal(res.body.deployment.target, 'preview');
  assert.equal(res.body.deployment.sha, sha(2));
  const create = h.vercel.state.requests.find((entry) => entry.method === 'POST');
  assert.equal(create.path, '/v13/deployments');
  assert.equal(create.body.target, undefined);
  assert.deepEqual(create.body.gitSource, { type: 'github', org: 'o', repo: 'r', ref: 'dev/redesign', sha: sha(2) });
  assert.equal(create.body.project, 'prj_test');
  assert.equal(create.body.name, 'portfolio');
  assert.equal(create.query.forceNew, '1');
  assert.ok(h.repo.state.events.some((event) => event.kind === 'preview_deployed' && event.deploymentId === res.body.deployment.id));

  const mismatch = await client.call('/api/admin/deploy/previews', { method: 'POST', json: { ref: 'dev/redesign', sha: sha(3) } });
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.code, 'commit_not_on_branch');
  assert.equal((await client.call('/api/admin/deploy/previews', { method: 'POST', json: { ref: 'dev/redesign', sha: 'abc' } })).status, 400);
  assert.equal(posts(h.vercel).length, 1);
});

function addCommit(h, n) {
  h.github.state.commits.unshift({ sha: sha(n), message: `Commit ${n}`, author: 'Okiki', date: '2026-11-11T10:00:00Z' });
  h.github.state.ancestors.master.unshift(sha(n));
  h.github.state.branches.master = sha(n);
}

test('production deploys require a typed confirmation, a built preview of the exact commit and a quiet pipeline', async (t) => {
  const { h, client } = await setup();
  t.after(h.close);
  addCommit(h, 4);
  const body = { ref: 'master', sha: sha(3) };

  const wrong = await client.call('/api/admin/deploy/production', { method: 'POST', json: { ...body, confirm: 'nope' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'confirmation_mismatch');
  assert.equal((await client.call('/api/admin/deploy/production', { method: 'POST', json: body })).status, 400);

  const offBranch = await client.call('/api/admin/deploy/production', { method: 'POST', json: { ref: 'dev/redesign', sha: sha(3), confirm: sha(3).slice(0, 7) } });
  assert.equal(offBranch.status, 422);
  assert.equal(offBranch.body.code, 'commit_not_on_branch');

  const unbuilt = await client.call('/api/admin/deploy/production', { method: 'POST', json: { ref: 'master', sha: sha(4), confirm: sha(4).slice(0, 7) } });
  assert.equal(unbuilt.status, 412);
  assert.equal(unbuilt.body.code, 'preview_required');
  assert.equal(posts(h.vercel).length, 0);

  const ok = await client.call('/api/admin/deploy/production', { method: 'POST', json: { ...body, confirm: sha(3).slice(0, 7) } });
  assert.equal(ok.status, 202);
  assert.equal(ok.body.deployment.target, 'production');
  const create = posts(h.vercel)[0];
  assert.equal(create.path, '/v13/deployments');
  assert.equal(create.body.target, 'production');
  assert.deepEqual(create.body.gitSource, { type: 'github', org: 'o', repo: 'r', ref: 'master', sha: sha(3) });
  const event = h.repo.state.events.find((entry) => entry.kind === 'production_deployed');
  assert.equal(event.actor, 'admin@example.com');
  assert.equal(event.sha, sha(3));

  const busy = await client.call('/api/admin/deploy/production', { method: 'POST', json: { ...body, confirm: sha(3).slice(0, 7) } });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'deployment_in_progress');
  assert.equal(posts(h.vercel).length, 1);
});

test('the preview-first guard can be switched off by configuration', async (t) => {
  const { h, client } = await setup({ requirePreview: false });
  t.after(h.close);
  addCommit(h, 4);
  const res = await client.call('/api/admin/deploy/production', { method: 'POST', json: { ref: 'master', sha: sha(4), confirm: sha(4).slice(0, 7) } });
  assert.equal(res.status, 202);
});

test('promote finishes a staged production deployment after confirmation', async (t) => {
  const { h, client } = await setup();
  t.after(h.close);
  const staged = h.vercel.make({ sha: sha(3), ref: 'master', target: 'production', substate: 'STAGED' });
  const wrong = await client.call(`/api/admin/deploy/deployments/${staged.id}/promote`, { method: 'POST', json: { confirm: 'x' } });
  assert.equal(wrong.status, 400);
  const ok = await client.call(`/api/admin/deploy/deployments/${staged.id}/promote`, { method: 'POST', json: { confirm: sha(3).slice(0, 7) } });
  assert.equal(ok.status, 200);
  const call = h.vercel.state.requests.find((entry) => entry.path.includes('/promote/'));
  assert.equal(call.path, `/v10/projects/prj_test/promote/${staged.id}`);
  assert.equal(ok.body.deployment.substate, 'PROMOTED');
  const preview = h.vercel.state.deployments.find((entry) => !entry.target);
  const bad = await client.call(`/api/admin/deploy/deployments/${preview.id}/promote`, { method: 'POST', json: { confirm: 'x' } });
  assert.equal(bad.status, 409);
});

test('rollback lists earlier production deployments and restores one after confirmation', async (t) => {
  const { h, client, older, current } = await setup();
  t.after(h.close);
  const list = (await client.call('/api/admin/deploy/rollbacks')).body;
  assert.equal(list.current.id, current.id);
  assert.deepEqual(list.candidates.map((entry) => entry.id), [older.id]);
  assert.equal(list.candidates[0].confirmation, sha(1).slice(0, 7));

  const wrong = await client.call('/api/admin/deploy/rollbacks', { method: 'POST', json: { deploymentId: older.id, confirm: 'wrong' } });
  assert.equal(wrong.status, 400);
  assert.equal(posts(h.vercel).length, 0);

  const same = await client.call('/api/admin/deploy/rollbacks', { method: 'POST', json: { deploymentId: current.id, confirm: sha(2).slice(0, 7) } });
  assert.equal(same.status, 409);

  const ok = await client.call('/api/admin/deploy/rollbacks', { method: 'POST', json: { deploymentId: older.id, confirm: sha(1).slice(0, 7), reason: 'Broken contact form' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.rolledBackTo.id, older.id);
  assert.equal(ok.body.previous.id, current.id);
  const call = h.vercel.state.requests.find((entry) => entry.path.includes('/rollback/'));
  assert.equal(call.method, 'POST');
  assert.equal(call.path, `/v1/projects/prj_test/rollback/${older.id}`);
  assert.equal(call.query.description, 'Broken contact form');
  const event = h.repo.state.events.find((entry) => entry.kind === 'rollback');
  assert.equal(event.previousDeploymentId, current.id);
  assert.equal(h.vercel.state.deployments.length, 3);
  assert.equal(h.repo.state.audit.some((entry) => entry.action === 'deploy.rollback' && entry.outcome === 'success'), true);

  const preview = h.vercel.state.deployments.find((entry) => !entry.target);
  assert.equal((await client.call('/api/admin/deploy/rollbacks', { method: 'POST', json: { deploymentId: preview.id, confirm: 'x' } })).status, 409);
  assert.equal((await client.call('/api/admin/deploy/rollbacks', { method: 'POST', json: { deploymentId: 'bad id', confirm: 'x' } })).status, 400);
});

test('a rejected rollback surfaces the reason and is audited as a failure', async (t) => {
  const { h, client, older } = await setup();
  t.after(h.close);
  h.vercel.state.failRollback = true;
  const res = await client.call('/api/admin/deploy/rollbacks', { method: 'POST', json: { deploymentId: older.id, confirm: sha(1).slice(0, 7) } });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'vercel_rejected');
  assert.ok(h.repo.state.audit.some((entry) => entry.action === 'deploy.rollback' && entry.outcome === 'failure'));
  assert.ok(!h.repo.state.events.some((entry) => entry.kind === 'rollback'));
});

test('verification checks state, live pointer, health and commit', async (t) => {
  const health = { ok: true, commit: sha(2) };
  const fetchStub = async (url, init) => (String(url).startsWith('https://portfolio.example.com/') ? new Response(JSON.stringify(health), { status: 200 }) : fetch(url, init));
  const { h, client, current, older } = await setup({ fetch: fetchStub });
  t.after(h.close);
  const good = (await client.call(`/api/admin/deploy/deployments/${current.id}/verify`)).body;
  assert.equal(good.passed, true);
  assert.deepEqual(good.checks.map((check) => `${check.id}:${check.status}`), ['state:pass', 'target:pass', 'live:pass', 'health:pass', 'commit:pass']);

  health.commit = sha(9);
  const wrongCommit = (await client.call(`/api/admin/deploy/deployments/${current.id}/verify`)).body;
  assert.equal(wrongCommit.passed, false);
  assert.equal(wrongCommit.checks.find((check) => check.id === 'commit').status, 'fail');

  const notLive = (await client.call(`/api/admin/deploy/deployments/${older.id}/verify`)).body;
  assert.equal(notLive.passed, false);
  assert.equal(notLive.checks.find((check) => check.id === 'live').status, 'fail');
  assert.equal(notLive.checks.find((check) => check.id === 'health').status, 'skipped');
});

test('history merges Vercel deployments with who triggered them from the CMS', async (t) => {
  const { h, client } = await setup();
  t.after(h.close);
  await client.call('/api/admin/deploy/previews', { method: 'POST', json: { ref: 'dev/redesign' } });
  const all = (await client.call('/api/admin/deploy/deployments')).body.deployments;
  assert.equal(all.length, 4);
  const triggered = all.find((entry) => entry.triggeredBy);
  assert.equal(triggered.triggeredBy, 'admin@example.com');
  assert.equal(triggered.triggeredKind, 'preview_deployed');
  const previews = (await client.call('/api/admin/deploy/deployments?target=preview')).body.deployments;
  assert.ok(previews.every((entry) => entry.target !== 'production'));
  const production = (await client.call('/api/admin/deploy/deployments?target=production')).body.deployments;
  assert.equal(production.length, 2);
  assert.equal((await client.call('/api/admin/deploy/deployments/not-an-id')).status, 400);
});

test('the integration never sends destructive Git or Vercel calls and never writes to the production branch', async (t) => {
  const { h, client, older } = await setup();
  t.after(h.close);
  await client.call('/api/admin/deploy/branches', { method: 'POST', json: { name: 'safe', from: 'master' } });
  await client.call('/api/admin/deploy/previews', { method: 'POST', json: { ref: 'dev/redesign' } });
  await client.call('/api/admin/deploy/rollbacks', { method: 'POST', json: { deploymentId: older.id, confirm: sha(1).slice(0, 7) } });
  const methods = new Set([...h.github.state.requests, ...h.vercel.state.requests].map((request) => request.method));
  assert.deepEqual([...methods].sort(), ['GET', 'POST']);
  const writes = h.github.state.requests.filter((request) => request.method !== 'GET');
  assert.ok(writes.every((request) => request.path === '/repos/o/r/git/refs' && request.body.ref.startsWith('refs/heads/dev/')));
  assert.equal(h.github.state.branches.master, sha(3));
  assert.equal(await client.call('/api/admin/deploy/branches', { method: 'POST', json: { name: 'master', from: 'master' } }).then((res) => res.body.branch.name), 'dev/master');
});

test('deployment actions are audited and rate limited per user', async (t) => {
  const { h, client } = await setup();
  t.after(h.close);
  let last;
  for (let attempt = 0; attempt < 16; attempt += 1) last = await client.call('/api/admin/deploy/previews', { method: 'POST', json: { ref: 'dev/redesign' } });
  assert.equal(last.status, 429);
  assert.ok(h.repo.state.audit.filter((entry) => entry.action === 'deploy.preview').length >= 15);
});

test('GitHub and Vercel failures are translated without leaking upstream details', async (t) => {
  const { h, client } = await setup({ mutateConfig: (config) => { config.github.token = 'wrong'; config.vercel.token = 'wrong'; } });
  t.after(h.close);
  const branches = await client.call('/api/admin/deploy/branches');
  assert.equal(branches.status, 502);
  assert.equal(branches.body.code, 'github_unauthorized');
  const history = await client.call('/api/admin/deploy/deployments');
  assert.equal(history.status, 502);
  assert.equal(history.body.code, 'vercel_unauthorized');
  assert.ok(!JSON.stringify(branches.body).includes('Bad credentials'));
});
