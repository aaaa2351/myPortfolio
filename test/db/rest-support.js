const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

let counter = 0;
const SECRET = 'rest-test-secret-rest-test-secret-0123456789';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function mint(role) {
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'test', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${unsigned}.${crypto.createHmac('sha256', SECRET).update(unsigned).digest('base64url')}`;
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ok = await new Promise((resolve) => {
      const request = http.get({ host: '127.0.0.1', port, path: '/' }, (response) => {
        response.resume();
        resolve(true);
      });
      request.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('PostgREST did not start');
}

async function startRest({ databaseUrl, bin }) {
  const url = new URL(databaseUrl);
  counter += 1;
  const port = 3300 + ((process.pid + counter * 7) % 400);
  const proxyPort = port + 500;
  const configFile = path.join(os.tmpdir(), `postgrest-${process.pid}-${port}.conf`);
  fs.writeFileSync(configFile, [`db-uri = "postgres://authenticator:pw@${url.hostname}:${url.port || 5432}${url.pathname}"`, 'db-schemas = "public"', 'db-anon-role = "anon"', `jwt-secret = "${SECRET}"`, 'server-host = "127.0.0.1"', `server-port = ${port}`].join('\n'));
  const child = spawn(bin, [configFile], { stdio: 'ignore' });
  await waitForPort(port);

  const proxy = http.createServer((req, res) => {
    const target = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url.replace(/^\/rest\/v1/, ''), headers: req.headers }, (upstream) => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    });
    req.pipe(target);
    target.on('error', () => res.destroy());
  });
  await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${proxyPort}`,
    anonKey: mint('anon'),
    serviceKey: mint('service_role'),
    authenticatedKey: mint('authenticated'),
    async stop() {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
      fs.rmSync(configFile, { force: true });
    }
  };
}

module.exports = { startRest };
