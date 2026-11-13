const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHarness } = require('./support/harness');

const clone = (value) => JSON.parse(JSON.stringify(value));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

test('validation rejects bad URLs, paths and scripts (carried over from the local CMS)', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const { content, revision } = (await client.call('/api/admin/content')).body;
  const bad = clone(content);
  bad.projectList[0].liveUrl = 'javascript:alert(1)';
  bad.projectList[1].imageSrc = 'images/../../etc/passwd.png';
  bad.hero.primaryButton.target = 'javascript:alert(1)';
  bad.hero.highlight = 'missing word';
  const res = await client.call('/api/admin/content', { method: 'PUT', json: { content: bad, revision } });
  assert.equal(res.status, 422);
  const paths = res.body.details.map((entry) => entry.path);
  for (const expected of ['projectList[0].liveUrl', 'projectList[1].imageSrc', 'hero.primaryButton.target', 'hero.highlight']) {
    assert.ok(paths.includes(expected), `missing error for ${expected}`);
  }
  assert.equal(h.repo.state.draft.revision, 1);
});

test('uploaded file names are sanitised and unique even for hostile originals', async (t) => {
  const h = await createHarness();
  t.after(h.close);
  const client = await h.signedInClient();
  const send = (name) => {
    const form = new FormData();
    form.append('image', new Blob([PNG], { type: 'image/png' }), name);
    return client.call('/api/admin/images', { method: 'POST', body: form });
  };
  const first = await send('../../My Photo!.png');
  const second = await send('../../My Photo!.png');
  assert.equal(first.status, 201);
  assert.match(first.body.image.name, /^my-photo-[a-z0-9]+-[a-f0-9]{8}\.png$/);
  assert.match(first.body.image.path, /\/uploads\/my-photo-[a-z0-9]+-[a-f0-9]{8}\.png$/);
  assert.notEqual(first.body.image.name, second.body.image.name);
  assert.ok(![...h.media.objects.keys()].some((key) => key.includes('..')));
});

test('the local development server still rejects unexpected Host headers', async (t) => {
  const h = await createHarness({ mutateConfig: (config) => { config.localHostGuard = true; } });
  t.after(h.close);
  h.config.port = Number(new URL(h.base).port);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: h.config.port, path: '/api/health', headers: { Host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
  assert.equal((await h.createClient().call('/api/health')).status, 200);
});

test('local static serving exposes the site and admin shell but nothing else', async (t) => {
  const h = await createHarness({ serveStatic: true });
  t.after(h.close);
  const client = h.createClient();
  const admin = await client.raw('/admin/');
  assert.equal(admin.status, 200);
  assert.match(admin.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(admin.headers.get('x-frame-options'), 'DENY');
  assert.match(admin.headers.get('x-robots-tag'), /noindex/);
  const page = await client.raw('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal((await client.raw('/data/portfolio.json')).status, 200);
  assert.equal((await client.raw('/admin/js/app.js')).status, 200);
  for (const hidden of ['/data/backups/', '/../package.json', '/server/app.js', '/.env', '/package.json', '/supabase/migrations/20261112000001_cms_core.sql', '/admin/../server/config.js']) {
    assert.equal((await client.raw(hidden)).status, 404, hidden);
  }
  const html = await (await client.raw('/admin/')).text();
  assert.match(html, /href="\/admin\/admin\.css"/);
  assert.match(html, /src="\/admin\/js\/app\.js"/);
});
