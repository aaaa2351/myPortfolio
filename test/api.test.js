const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createConfig } = require('../server/config');
const { createApp } = require('../server');

const seed = path.resolve(__dirname, '..', 'public', 'data', 'portfolio.json');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

let server;
let base;
let root;
let token;
let origin;

test.before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-'));
  fs.mkdirSync(path.join(root, 'public', 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public', 'images'), { recursive: true });
  fs.mkdirSync(path.join(root, 'admin'), { recursive: true });
  fs.copyFileSync(seed, path.join(root, 'public', 'data', 'portfolio.json'));
  fs.writeFileSync(path.join(root, 'admin', 'index.html'), '<h1>admin</h1>');
  const config = createConfig({ root, port: 0 });
  const { app } = createApp(config);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  config.port = server.address().port;
  base = `http://127.0.0.1:${config.port}`;
  origin = base;
  const session = await (await fetch(`${base}/api/session`)).json();
  token = session.csrfToken;
});

test.after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const headers = (extra = {}) => ({ 'Content-Type': 'application/json', Origin: origin, 'X-CSRF-Token': token, ...extra });
const getContent = async () => (await (await fetch(`${base}/api/content`)).json()).content;

test('rejects unexpected Host headers', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/session', headers: { Host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('blocks writes without CSRF token or with a foreign origin', async () => {
  const content = await getContent();
  const noToken = await fetch(`${base}/api/content`, { method: 'PUT', headers: headers({ 'X-CSRF-Token': 'nope' }), body: JSON.stringify(content) });
  assert.equal(noToken.status, 403);
  const badOrigin = await fetch(`${base}/api/content`, { method: 'PUT', headers: headers({ Origin: 'http://evil.example' }), body: JSON.stringify(content) });
  assert.equal(badOrigin.status, 403);
});

test('saves content, stamps updates and creates a backup', async () => {
  const content = await getContent();
  content.projectList[0].name = 'Cipher Pro';
  const res = await fetch(`${base}/api/content`, { method: 'PUT', headers: headers(), body: JSON.stringify(content) });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.unchanged, false);
  assert.match(body.backup, /^portfolio-\d{8}-\d{6}-\d{3}\.json$/);
  assert.notEqual(body.content.projectList[0].updatedAt, '2026-11-09T09:00:00.000Z');
  assert.equal(body.content.projectList[1].updatedAt, '2026-11-09T09:00:00.000Z');
  assert.ok(fs.existsSync(path.join(root, 'data', 'backups', body.backup)));
  assert.equal(fs.readdirSync(path.join(root, 'public', 'data')).filter((f) => f.endsWith('.tmp')).length, 0);
});

test('identical saves do not create backups', async () => {
  const content = await getContent();
  const before = fs.readdirSync(path.join(root, 'data', 'backups')).length;
  const res = await fetch(`${base}/api/content`, { method: 'PUT', headers: headers(), body: JSON.stringify(content) });
  assert.equal((await res.json()).unchanged, true);
  assert.equal(fs.readdirSync(path.join(root, 'data', 'backups')).length, before);
});

test('validation rejects bad URLs, paths and scripts', async () => {
  const content = await getContent();
  content.projectList[0].liveUrl = 'javascript:alert(1)';
  content.projectList[1].imageSrc = 'images/../../etc/passwd.png';
  content.hero.primaryButton.target = 'javascript:alert(1)';
  content.hero.highlight = 'missing word';
  const res = await fetch(`${base}/api/content`, { method: 'PUT', headers: headers(), body: JSON.stringify(content) });
  const body = await res.json();
  assert.equal(res.status, 422);
  const paths = body.details.map((d) => d.path);
  for (const expected of ['projectList[0].liveUrl', 'projectList[1].imageSrc', 'hero.primaryButton.target', 'hero.highlight']) {
    assert.ok(paths.includes(expected), `missing error for ${expected}`);
  }
});

test('uploads real images only, with unique safe names', async () => {
  const send = (buffer, name, type) => {
    const form = new FormData();
    form.append('image', new Blob([buffer], { type }), name);
    return fetch(`${base}/api/images`, { method: 'POST', headers: { Origin: origin, 'X-CSRF-Token': token }, body: form });
  };
  const ok = await send(PNG, '../../My Photo!.png', 'image/png');
  const okBody = await ok.json();
  assert.equal(ok.status, 201);
  assert.match(okBody.image.path, /^images\/uploads\/my-photo-[a-z0-9]+-[a-f0-9]{8}\.png$/);
  assert.ok(fs.existsSync(path.join(root, 'public', okBody.image.path)));

  const fake = await send(Buffer.from('<script>alert(1)</script>'), 'x.png', 'image/png');
  assert.equal(fake.status, 415);
  const wrongType = await send(PNG, 'x.gif', 'image/gif');
  assert.equal(wrongType.status, 415);
  const big = await send(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png', 'image/png');
  assert.equal(big.status, 413);

  const list = await (await fetch(`${base}/api/images`)).json();
  assert.ok(list.images.some((image) => image.path === okBody.image.path));
});

test('backups can be listed, viewed and restored; bad names are refused', async () => {
  const list = await (await fetch(`${base}/api/backups`)).json();
  assert.ok(list.backups.length >= 1);
  const name = list.backups[0].name;
  const view = await (await fetch(`${base}/api/backups/${name}`)).json();
  assert.equal(view.backup.valid, true);
  assert.equal(view.backup.content.projectList[0].name, 'Cipher');

  const restore = await fetch(`${base}/api/backups/${name}/restore`, { method: 'POST', headers: headers() });
  assert.equal(restore.status, 200);
  assert.equal((await getContent()).projectList[0].name, 'Cipher');

  for (const bad of ['..%2F..%2Fpackage.json', 'portfolio-1.json', '%2e%2e']) {
    const res = await fetch(`${base}/api/backups/${bad}`);
    assert.ok([400, 404].includes(res.status), `${bad} -> ${res.status}`);
  }
});

test('reports missing local images', async () => {
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.ok(status.missingImages.some((item) => item.path === 'images/avatar.jpg'));
});

test('serves admin and portfolio, never data outside public', async () => {
  assert.equal((await fetch(`${base}/admin/`)).status, 200);
  assert.equal((await fetch(`${base}/data/portfolio.json`)).status, 200);
  assert.equal((await fetch(`${base}/data/backups/`)).status, 404);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});
