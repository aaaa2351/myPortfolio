const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, SEED } = require('./support/harness');

const clone = (value) => JSON.parse(JSON.stringify(value));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

function upload(client, bytes, filename, type) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type }), filename);
  return client.call('/api/admin/images', { method: 'POST', body: form });
}

test('first load seeds the draft from the bundled file and returns a revision', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const res = await client.call('/api/admin/content');
  assert.equal(res.status, 200);
  assert.equal(res.body.revision, 1);
  assert.equal(res.body.content.hero.description, SEED.hero.description);
  assert.equal(res.body.published, null);
  assert.equal(h.repo.state.backups.length, 0);
});

test('saving validates, stamps, backs up the previous draft and bumps the revision', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const loaded = (await client.call('/api/admin/content')).body;
  const edited = clone(loaded.content);
  edited.hero.description = 'A brand new headline';
  const saved = await client.call('/api/admin/content', { method: 'PUT', json: { content: edited, revision: loaded.revision } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 2);
  assert.equal(saved.body.unchanged, false);
  assert.match(saved.body.backup, /^portfolio-\d{8}-\d{6}-\d{3}\.json$/);
  assert.equal(saved.body.content.hero.description, 'A brand new headline');
  assert.ok(saved.body.content.meta.updatedAt);
  assert.equal(h.repo.state.backups.length, 1);
  assert.equal(h.repo.state.backups[0].content.hero.description, SEED.hero.description);

  const again = await client.call('/api/admin/content', { method: 'PUT', json: { content: saved.body.content, revision: 2 } });
  assert.equal(again.body.unchanged, true);
  assert.equal(again.body.revision, 2);
  assert.equal(h.repo.state.backups.length, 1);
});

test('invalid content is rejected with field errors and nothing is stored', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const loaded = (await client.call('/api/admin/content')).body;
  const bad = clone(loaded.content);
  bad.hero.heading = '';
  bad.projectList[0].liveUrl = 'javascript:alert(1)';
  const res = await client.call('/api/admin/content', { method: 'PUT', json: { content: bad, revision: 1 } });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'validation_failed');
  assert.ok(res.body.details.length >= 2);
  assert.equal(h.repo.state.draft.revision, 1);
  const missing = await client.call('/api/admin/content', { method: 'PUT', json: { content: loaded.content } });
  assert.ok([400, 200].includes(missing.status));
  const noRevision = clone(loaded.content);
  noRevision.hero.description = 'x';
  const res2 = await client.call('/api/admin/content', { method: 'PUT', json: { content: noRevision } });
  assert.equal(res2.status, 400);
  assert.equal(res2.body.code, 'revision_required');
});

test('two devices cannot silently overwrite each other', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const phone = await h.signedInClient();
  const laptop = await h.signedInClient();
  const base = (await phone.call('/api/admin/content')).body;
  const a = clone(base.content);
  a.hero.description = 'From the phone';
  assert.equal((await phone.call('/api/admin/content', { method: 'PUT', json: { content: a, revision: base.revision } })).status, 200);
  const b = clone(base.content);
  b.hero.description = 'From the laptop';
  const conflict = await laptop.call('/api/admin/content', { method: 'PUT', json: { content: b, revision: base.revision } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'revision_conflict');
  assert.equal(conflict.body.details.currentRevision, 2);
  assert.equal(h.repo.state.draft.content.hero.description, 'From the phone');
});

test('backups can be listed, inspected and restored without losing the current draft', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  let { content, revision } = (await client.call('/api/admin/content')).body;
  for (const title of ['One', 'Two']) {
    const next = clone(content);
    next.hero.description = title;
    const saved = (await client.call('/api/admin/content', { method: 'PUT', json: { content: next, revision } })).body;
    content = saved.content;
    revision = saved.revision;
  }
  const list = (await client.call('/api/admin/backups')).body.backups;
  assert.equal(list.length, 2);
  assert.ok(list.every((entry) => entry.valid && entry.summary.projects > 0));
  const oldest = list[list.length - 1];
  const detail = await client.call(`/api/admin/backups/${oldest.name}`);
  assert.equal(detail.body.backup.content.hero.description, SEED.hero.description);
  const restored = await client.call(`/api/admin/backups/${oldest.name}/restore`, { method: 'POST', json: { revision } });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.content.hero.description, SEED.hero.description);
  assert.equal(restored.body.revision, revision + 1);
  assert.equal(h.repo.state.backups.length, 3);
  assert.equal(h.repo.state.backups[2].content.hero.description, 'Two');
  assert.equal(h.repo.state.backups[2].reason, 'restore');
  assert.equal((await client.call('/api/admin/backups/not-a-backup.json')).status, 400);
  assert.equal((await client.call('/api/admin/backups/portfolio-20200101-000000-000.json')).status, 404);
  const stale = await client.call(`/api/admin/backups/${oldest.name}/restore`, { method: 'POST', json: { revision: 1 } });
  assert.equal(stale.status, 409);
});

test('editing and publishing are separate: the public site only changes on publish', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const visitor = h.createClient();
  assert.equal((await visitor.call('/api/public/content')).status, 404);

  const client = await h.signedInClient();
  let { content, revision } = (await client.call('/api/admin/content')).body;
  const first = await client.call('/api/admin/publish', { method: 'POST', json: { revision, note: 'Initial release' } });
  assert.equal(first.status, 200);
  assert.equal(first.body.unchanged, false);
  const live = await visitor.call('/api/public/content');
  assert.equal(live.status, 200);
  assert.equal(live.body.hero.description, SEED.hero.description);
  assert.match(live.headers.get('cache-control'), /s-maxage=30/);
  assert.ok(!live.headers.has('set-cookie'));

  const next = clone(content);
  next.hero.description = 'Draft only headline';
  const saved = (await client.call('/api/admin/content', { method: 'PUT', json: { content: next, revision } })).body;
  assert.equal((await visitor.call('/api/public/content')).body.hero.description, SEED.hero.description);
  const state = (await client.call('/api/admin/publishing')).body;
  assert.equal(state.pending, true);
  assert.equal(state.published.content.hero.description, SEED.hero.description);

  assert.equal((await client.call('/api/admin/publish', { method: 'POST', json: { revision: revision } })).status, 409);
  const second = await client.call('/api/admin/publish', { method: 'POST', json: { revision: saved.revision } });
  assert.equal(second.status, 200);
  assert.equal((await visitor.call('/api/public/content')).body.hero.description, 'Draft only headline');
  const again = await client.call('/api/admin/publish', { method: 'POST', json: { revision: saved.revision } });
  assert.equal(again.body.unchanged, true);
  assert.equal(h.repo.state.publications.length, 2);

  const history = (await client.call('/api/admin/publishing')).body.history;
  assert.equal(history.length, 2);
  const republished = await client.call(`/api/admin/publications/${history[1].id}/republish`, { method: 'POST', json: {} });
  assert.equal(republished.status, 200);
  assert.equal((await visitor.call('/api/public/content')).body.hero.description, SEED.hero.description);
  assert.equal(h.repo.state.publications.length, 3);
  assert.equal(h.repo.state.publications[2].republishedFrom, history[1].id);
  assert.equal((await client.call('/api/admin/content')).body.content.hero.description, 'Draft only headline');
  assert.equal((await client.call('/api/admin/publications/999/republish', { method: 'POST', json: {} })).status, 404);
});

test('image uploads check real bytes, are stored remotely and list alongside repo images', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const ok = await upload(client, JPEG, 'My Photo!.jpg', 'image/jpeg');
  assert.equal(ok.status, 201);
  assert.match(ok.body.image.path, /^https:\/\/media\.test\/storage\/v1\/object\/public\/portfolio-images\/uploads\/my-photo-[a-z0-9-]+\.jpg$/);
  assert.equal(ok.body.image.deletable, true);
  assert.equal(h.media.objects.size, 1);

  const fake = await upload(client, Buffer.from('<svg onload=alert(1)>'), 'x.png', 'image/png');
  assert.equal(fake.status, 415);
  const wrongType = await upload(client, JPEG, 'x.gif', 'image/gif');
  assert.equal(wrongType.status, 415);
  const huge = await upload(client, Buffer.concat([JPEG, Buffer.alloc(h.config.maxUploadBytes + 10)]), 'big.jpg', 'image/jpeg');
  assert.equal(huge.status, 413);
  assert.equal(h.media.objects.size, 1);

  const listed = (await client.call('/api/admin/images')).body.images;
  assert.ok(listed.some((image) => image.uploaded && image.deletable && image.id));
  assert.ok(listed.some((image) => image.path.startsWith('images/') && image.deletable === false));
});

test('an image used by the draft or the live site cannot be deleted; an unused one can', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const image = (await upload(client, PNG, 'banner.png', 'image/png')).body.image;
  let { content, revision } = (await client.call('/api/admin/content')).body;
  const next = clone(content);
  next.hero.image = image.path;
  const saved = (await client.call('/api/admin/content', { method: 'PUT', json: { content: next, revision } })).body;
  assert.equal(saved.revision, 2);
  const blocked = await client.call(`/api/admin/images/${image.id}`, { method: 'DELETE' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'image_in_use');

  await client.call('/api/admin/publish', { method: 'POST', json: { revision: 2 } });
  const reverted = clone(saved.content);
  reverted.hero.image = SEED.hero.image;
  const back = (await client.call('/api/admin/content', { method: 'PUT', json: { content: reverted, revision: 2 } })).body;
  assert.equal((await client.call(`/api/admin/images/${image.id}`, { method: 'DELETE' })).status, 409);
  await client.call('/api/admin/publish', { method: 'POST', json: { revision: back.revision } });
  const removed = await client.call(`/api/admin/images/${image.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(h.media.objects.size, 0);
  assert.equal((await client.call(`/api/admin/images/${image.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await client.call('/api/admin/images/not-an-id', { method: 'DELETE' })).status, 400);
});

test('status reports validity, backups, publication state and missing local images', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  let { content, revision } = (await client.call('/api/admin/content')).body;
  const next = clone(content);
  next.hero.image = 'images/definitely-missing.png';
  await client.call('/api/admin/content', { method: 'PUT', json: { content: next, revision } });
  const status = (await client.call('/api/admin/status')).body;
  assert.equal(status.dataValid, true);
  assert.equal(status.backupCount, 1);
  assert.equal(status.published, null);
  assert.equal(status.unpublishedChanges, true);
  assert.ok(status.missingImages.some((entry) => entry.path === 'images/definitely-missing.png'));
});

test('every mutating action writes an audit entry with the actor, and failures are recorded', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  let { content, revision } = (await client.call('/api/admin/content')).body;
  const next = clone(content);
  next.hero.description = 'Audited';
  await client.call('/api/admin/content', { method: 'PUT', json: { content: next, revision } });
  await client.call('/api/admin/publish', { method: 'POST', json: { revision: 2 } });
  await client.call('/api/admin/publish', { method: 'POST', json: { revision: 1 } });
  await upload(client, JPEG, 'a.jpg', 'image/jpeg');
  const actions = h.repo.state.audit.map((entry) => `${entry.action}:${entry.outcome}`);
  for (const expected of ['auth.login:success', 'content.save:success', 'content.publish:success', 'content.publish:failure', 'image.upload:success']) {
    assert.ok(actions.includes(expected), `${expected} missing from ${actions.join(', ')}`);
  }
  assert.ok(h.repo.state.audit.filter((entry) => entry.action.startsWith('content.')).every((entry) => entry.actor === 'admin@example.com'));
  const listed = await client.call('/api/admin/audit?limit=5');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.entries.length, 5);
});

test('malformed and oversized request bodies are rejected cleanly', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const bad = await client.call('/api/admin/content', { method: 'PUT', body: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_json');
  const big = await client.call('/api/admin/content', { method: 'PUT', body: JSON.stringify({ content: 'x'.repeat(2 * 1024 * 1024), revision: 1 }), headers: { 'content-type': 'application/json' } });
  assert.equal(big.status, 413);
});

test('API responses are never cached and carry hardening headers', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const res = await client.call('/api/admin/content');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  const health = await client.call('/api/health');
  assert.deepEqual(Object.keys(health.body).sort(), ['commit', 'environment', 'ok']);
});

test('write requests are rate limited per user', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  let last;
  for (let attempt = 0; attempt < 62; attempt += 1) last = await client.call('/api/admin/publish', { method: 'POST', json: { revision: 999 } });
  assert.equal(last.status, 429);
});
