const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDatabase } = require('./support');
const { startRest } = require('./rest-support');
const { createSupabaseClients, createSupabaseRepo } = require('../../server/repo/supabase');
const { createHarness, SEED } = require('../support/harness');

const URL = process.env.TEST_DATABASE_URL;
const BIN = process.env.TEST_POSTGREST_BIN;
const skip = URL && BIN ? false : 'Set TEST_DATABASE_URL and TEST_POSTGREST_BIN (a PostgREST binary) to run the supabase-js integration tests.';
const clone = (value) => JSON.parse(JSON.stringify(value));

async function environment() {
  const db = await freshDatabase(URL);
  const rest = await startRest({ databaseUrl: URL, bin: BIN });
  const config = { supabase: { url: rest.url, anonKey: rest.anonKey, serviceKey: rest.serviceKey } };
  const repo = createSupabaseRepo(createSupabaseClients(config));
  return {
    db,
    rest,
    config,
    repo,
    async close() {
      await rest.stop();
      await db.end();
    }
  };
}

test('the Supabase repository works end to end through supabase-js, PostgREST and Postgres', { skip }, async (t) => {
  const env = await environment();
  t.after(env.close);
  const { repo } = env;

  assert.equal(await repo.getDraft(), null);
  assert.equal(await repo.getPublished(), null);
  assert.equal(await repo.seedDraft({ schemaVersion: 1, title: 'one' }, 'seed'), 1);
  assert.equal(await repo.seedDraft({ title: 'ignored' }, 'seed'), 1);
  const draft = await repo.getDraft();
  assert.equal(draft.revision, 1);
  assert.equal(draft.content.title, 'one');

  const saved = await repo.saveDraft({ content: { title: 'two' }, expectedRevision: 1, actor: 'me@example.com' });
  assert.equal(saved.revision, 2);
  assert.match(saved.backupName, /^portfolio-\d{8}-\d{6}-\d{3}\.json$/);
  await assert.rejects(() => repo.saveDraft({ content: { title: 'late' }, expectedRevision: 1, actor: 'x' }), (error) => error.status === 409 && error.code === 'revision_conflict' && error.details.currentRevision === 2);

  assert.equal(await repo.countBackups(), 1);
  const list = await repo.listBackups(10);
  assert.equal(list[0].name, saved.backupName);
  assert.equal(list[0].createdBy, 'me@example.com');
  assert.equal(list[0].revision, 1);
  const backup = await repo.getBackup(saved.backupName);
  assert.equal(backup.content.title, 'one');
  assert.equal(await repo.getBackup('portfolio-20200101-000000-000.json'), null);
  assert.equal(await repo.importBackup({ name: 'portfolio-20200101-000000-000.json', content: { old: true }, createdAt: '2020-01-01T00:00:00.000Z', actor: 'seed' }), true);
  assert.equal(await repo.importBackup({ name: 'portfolio-20200101-000000-000.json', content: { old: true }, createdAt: '2020-01-01T00:00:00.000Z', actor: 'seed' }), false);

  const first = await repo.publish({ expectedRevision: 2, actor: 'me', note: 'go' });
  assert.equal(first.sourceRevision, 2);
  await assert.rejects(() => repo.publish({ expectedRevision: 1, actor: 'me' }), (error) => error.status === 409);
  const live = await repo.getPublished();
  assert.equal(live.content.title, 'two');
  assert.equal(live.id, first.id);
  assert.equal((await repo.getLatestPublication()).note, 'go');
  const second = await repo.republish({ id: first.id, actor: 'me', note: 'again' });
  assert.ok(second.id > first.id);
  const history = await repo.listPublications(10);
  assert.deepEqual(history.map((entry) => entry.id), [second.id, first.id]);
  assert.equal(history[0].republishedFrom, first.id);
  assert.equal((await repo.getPublication(first.id)).content.title, 'two');
  await assert.rejects(() => repo.republish({ id: 99999, actor: 'me' }), (error) => error.status === 404);

  await repo.audit({ actorEmail: 'me@example.com', actorId: 'u1', action: 'content.save', target: 'draft', outcome: 'success', ip: '203.0.113.5', userAgent: 'test', details: { a: 1 } });
  const audit = await repo.listAudit(5);
  assert.equal(audit[0].action, 'content.save');
  assert.equal(audit[0].ip, '203.0.113.5');
  assert.deepEqual(audit[0].details, { a: 1 });

  const asset = await repo.insertAsset({ objectPath: 'uploads/a.png', name: 'a.png', mime: 'image/png', size: 1234, url: 'https://x/a.png', uploadedBy: 'me' });
  assert.match(asset.id, /^[0-9a-f-]{36}$/);
  assert.equal((await repo.listAssets()).length, 1);
  assert.equal((await repo.getAsset(asset.id)).url, 'https://x/a.png');
  await repo.deleteAsset(asset.id);
  assert.equal(await repo.getAsset(asset.id), null);
  await assert.rejects(() => repo.insertAsset({ objectPath: 'uploads/b.svg', name: 'b.svg', mime: 'image/svg+xml', size: 10, url: 'https://x', uploadedBy: 'me' }));

  await repo.insertEvent({ actor: 'me', kind: 'preview_deployed', ref: 'dev/x', sha: 'a'.repeat(40), deploymentId: 'dpl_123456', details: { ok: true } });
  const events = await repo.listEvents(5);
  assert.equal(events[0].deploymentId, 'dpl_123456');

  assert.equal((await repo.rateLimit('k', 60, 2)).allowed, true);
  assert.equal((await repo.rateLimit('k', 60, 2)).allowed, true);
  const blocked = await repo.rateLimit('k', 60, 2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1);
});

test('the public anon key can read only the published snapshot, never private tables or functions', { skip }, async (t) => {
  const env = await environment();
  t.after(env.close);
  await env.repo.seedDraft({ title: 'secret draft' }, 'seed');
  await env.repo.publish({ expectedRevision: 1, actor: 'me' });
  const { createClient } = require('@supabase/supabase-js');
  for (const key of [env.rest.anonKey, env.rest.authenticatedKey]) {
    const client = createClient(env.rest.url, key, { auth: { persistSession: false } });
    const published = await client.rpc('cms_get_published');
    assert.equal(published.error, null);
    assert.equal(published.data.content.title, 'secret draft');
    for (const table of ['cms_draft', 'cms_backups', 'cms_publications', 'cms_audit_log', 'cms_media_assets', 'cms_deployment_events', 'cms_rate_limits']) {
      const result = await client.from(table).select('*');
      assert.ok(result.error, `${table} should be unreadable`);
      assert.equal(result.data, null);
    }
    for (const [name, args] of [['cms_save_draft', { p_content: {}, p_expected_revision: 1, p_actor: 'x', p_reason: 'save' }], ['cms_publish', { p_expected_revision: 1, p_actor: 'x' }], ['cms_seed_draft', { p_content: {}, p_actor: 'x' }], ['cms_rate_limit', { p_key: 'k', p_window_seconds: 60, p_max: 5 }]]) {
      const result = await client.rpc(name, args);
      assert.ok(result.error, `${name} should be refused`);
    }
    const write = await client.from('cms_draft').update({ revision: 9 }).eq('id', 1);
    assert.ok(write.error);
  }
});

test('the whole CMS runs against the real database path: sign in, edit, conflict, publish, serve publicly', { skip }, async (t) => {
  const env = await environment();
  t.after(env.close);
  const h = await createHarness({ repo: env.repo });
  t.after(h.close);
  const client = await h.signedInClient();

  const loaded = (await client.call('/api/admin/content')).body;
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.content.hero.description, SEED.hero.description);

  const edited = clone(loaded.content);
  edited.hero.description = 'Saved through PostgREST';
  const saved = await client.call('/api/admin/content', { method: 'PUT', json: { content: edited, revision: 1 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 2);
  const unchanged = await client.call('/api/admin/content', { method: 'PUT', json: { content: saved.body.content, revision: 2 } });
  assert.equal(unchanged.body.unchanged, true, 'jsonb key reordering must not look like a change');

  const stale = await client.call('/api/admin/content', { method: 'PUT', json: { content: { ...edited, tools: [] }, revision: 1 } });
  assert.ok([409, 422].includes(stale.status));

  const backups = (await client.call('/api/admin/backups')).body.backups;
  assert.equal(backups.length, 1);
  assert.equal(backups[0].valid, true);
  const restored = await client.call(`/api/admin/backups/${backups[0].name}/restore`, { method: 'POST', json: { revision: 2 } });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.content.hero.description, SEED.hero.description);

  const visitor = h.createClient();
  assert.equal((await visitor.call('/api/public/content')).status, 404);
  const state = (await client.call('/api/admin/publishing')).body;
  assert.equal(state.pending, true);
  const published = await client.call('/api/admin/publish', { method: 'POST', json: { revision: state.draft.revision, note: 'real db' } });
  assert.equal(published.status, 200);
  assert.equal(published.body.unchanged, false);
  assert.equal((await visitor.call('/api/public/content')).body.hero.description, SEED.hero.description);
  assert.equal((await client.call('/api/admin/publish', { method: 'POST', json: { revision: state.draft.revision } })).body.unchanged, true);
  const status = (await client.call('/api/admin/status')).body;
  assert.equal(status.unpublishedChanges, false);
  assert.equal(status.backupCount, 2);
  const audit = (await client.call('/api/admin/audit?limit=20')).body.entries.map((entry) => entry.action);
  for (const action of ['auth.login', 'content.save', 'content.restore', 'content.publish']) assert.ok(audit.includes(action), action);
});
