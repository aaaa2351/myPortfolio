const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('./support/harness');
const { ADMIN_CSP, PUBLIC_CSP } = require('../server/security');
const { build } = require('../scripts/build');

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const headerFor = (source, key) => (vercel.headers.find((entry) => entry.source === source).headers.find((header) => header.key === key) || {}).value;

test('vercel.json routes the API to one function and serves /admin on direct navigation', () => {
  assert.equal(vercel.outputDirectory, 'dist');
  assert.equal(vercel.buildCommand, 'node scripts/build.js');
  assert.ok(vercel.rewrites.some((rule) => rule.source === '/api/(.*)' && rule.destination === '/api'));
  assert.ok(vercel.rewrites.some((rule) => rule.source === '/admin' && rule.destination === '/admin/index.html'));
  assert.ok(fs.existsSync(path.join(ROOT, 'api', 'index.js')));
  assert.deepEqual(Object.keys(vercel.functions), ['api/index.js']);
  const apiFiles = fs.readdirSync(path.join(ROOT, 'api'));
  assert.deepEqual(apiFiles, ['index.js']);
});

test('security headers in vercel.json match the server and forbid inline script', () => {
  assert.equal(headerFor('/admin/(.*)', 'Content-Security-Policy'), ADMIN_CSP);
  assert.equal(headerFor('/admin', 'Content-Security-Policy'), ADMIN_CSP);
  assert.equal(headerFor('/((?!admin|api).*)', 'Content-Security-Policy'), PUBLIC_CSP);
  assert.equal(headerFor('/admin/(.*)', 'X-Frame-Options'), 'DENY');
  assert.match(headerFor('/(.*)', 'Strict-Transport-Security'), /max-age=63072000/);
  for (const policy of [ADMIN_CSP, PUBLIC_CSP]) {
    const script = policy.split('; ').find((part) => part.startsWith('script-src'));
    assert.equal(script, "script-src 'self'");
    assert.ok(!policy.includes('unsafe-inline') || !script.includes('unsafe-inline'));
  }
});

test('the generated vercel.json is up to date with its generator', () => {
  const before = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'write-vercel-json.js')]);
  assert.equal(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'), before);
});

test('the build output contains the site and admin shell but no server code, data or secrets', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-dist-'));
  build({ root: ROOT, out });
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(out, full).split(path.sep).join('/'));
    }
  })(out);
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('admin/index.html'));
  assert.ok(files.includes('admin/js/app.js'));
  assert.ok(files.includes('data/portfolio.json'));
  for (const file of files) {
    assert.ok(!/^(server|test|supabase|scripts|api|docs|node_modules)\//.test(file), file);
    assert.ok(!/(^|\/)\.env|package\.json|\.sql$|\.pem$/.test(file), file);
    assert.ok(!file.startsWith('data/backups'), file);
  }
  const admin = fs.readFileSync(path.join(out, 'admin/index.html'), 'utf8');
  assert.match(admin, /href="\/admin\/admin\.css"/);
  fs.rmSync(out, { recursive: true, force: true });
});

test('no secret-looking values are committed to browser-served code', () => {
  const served = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html|css|json)$/.test(entry.name)) served.push(full);
    }
  })(path.join(ROOT, 'admin'));
  for (const file of served) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/service_role|sb_secret_|ghp_|github_pat_|SUPABASE_SERVICE|CMS_VERCEL_TOKEN|CMS_GITHUB_TOKEN/.test(text), file);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\./.test(text), `${file} contains a JWT-like string`);
  }
});

test('.env.example lists every variable the server reads and contains no real secrets', () => {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const sources = ['server/config.js', 'server/index.js', 'scripts/seed.js'].map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  const used = new Set([...sources.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]));
  const systemManaged = new Set(['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_GIT_COMMIT_SHA', 'TRUST_PROXY', 'CMS_GITHUB_API_URL', 'CMS_VERCEL_API_URL']);
  for (const name of used) {
    if (systemManaged.has(name)) continue;
    assert.match(example, new RegExp(`^${name}=`, 'm'), `${name} is missing from .env.example`);
  }
  for (const line of example.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) continue;
    assert.ok(!/^(eyJ|sb_|ghp_|github_pat_|vcp_)/.test(match[2]), `${match[1]} looks like a real secret`);
  }
  assert.match(example, /^SESSION_SECRET=$/m);
  assert.match(example, /^SUPABASE_SERVICE_ROLE_KEY=$/m);
});

test('git ignores secrets and local backups and Vercel ignores them too', () => {
  const git = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const ignore = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8');
  assert.match(git, /^\.env$/m);
  assert.match(git, /data\/backups/);
  assert.match(ignore, /^data\/backups$/m);
  assert.match(ignore, /^\.env$/m);
});
