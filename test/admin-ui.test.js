const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');
const { createHarness, ROOT } = require('./support/harness');

const sha = (n) => String(n).padStart(40, 'a').slice(-40);
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;
const tracked = new Set();
globalThis.setTimeout = (fn, ms, ...args) => {
  const id = realSetTimeout(fn, ms, ...args);
  tracked.add(id);
  return id;
};
globalThis.setInterval = (fn, ms, ...args) => {
  const id = realSetInterval(fn, ms, ...args);
  tracked.add(id);
  return id;
};
function clearTracked() {
  for (const id of tracked) {
    realClearTimeout(id);
    realClearInterval(id);
  }
  tracked.clear();
}
const sleep = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));
const importAdmin = (file, query = '') => import(`${pathToFileURL(path.join(ROOT, 'admin', 'js', file)).href}${query}`);

function installDom(base, jar) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toasts"></div></body></html>', { url: `${base}/admin/`, pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  window.scrollTo = () => {};
  window.Element.prototype.scrollTo = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    history: window.history,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => realSetTimeout(() => fn(Date.now()), 0)
  });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.fetch = async (url, init = {}) => {
    const headers = { ...(init.headers || {}) };
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookie) headers.cookie = cookie;
    if (init.method && init.method !== 'GET') headers.origin = base;
    const body = init.body;
    let response;
    try {
      response = await realFetch(new URL(url, base), { method: init.method, headers, body, redirect: 'manual' });
    } catch (error) {
        throw error;
    }
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (/Max-Age=0/i.test(line)) jar.delete(pair.slice(0, index));
      else jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  };
  return dom;
}

async function waitFor(check, label, timeout = 4000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      const value = check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(25);
  }
  const page = document.body.textContent.replace(/\s+/g, ' ').slice(0, 400);
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message}` : ''}. Page text: ${page}`);
}

const text = () => document.body.textContent.replace(/\s+/g, ' ');
const click = (element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const buttonByText = (label, root = document) => [...root.querySelectorAll('button, a.btn')].find((node) => node.textContent.trim() === label);
const go = async (route) => {
  window.location.hash = `#/${route}`;
  await sleep(30);
};

test('signed-out visitors see the login screen with a clear message, never the dashboard', async (t) => {
  const h = await createHarness();
  const dom = installDom(h.base, new Map());
  t.after(async () => {
    clearTracked();
    dom.window.close();
    await h.close();
  });
  window.history.replaceState(null, '', '/admin/?auth_error=not_authorised');
  await importAdmin('app.js', '?signed-out');
  await waitFor(() => document.querySelector('.login-card'), 'login card');
  assert.match(text(), /Continue with Google/);
  assert.match(text(), /not authorised/i);
  assert.equal(document.querySelector('a.login-button').getAttribute('href'), '/api/auth/login');
  assert.equal(document.querySelector('.sidebar'), null);
  assert.equal(window.location.search, '');
});

test('the dashboard boots, saves with a revision, publishes, and drives every Deployment Center screen', async (t) => {
  const h = await createHarness({ productionUrl: 'https://portfolio.example.com' });
  h.vercel.make({ sha: sha(1), ref: 'master', target: 'production', substate: 'PROMOTED' });
  const current = h.vercel.make({ sha: sha(2), ref: 'master', target: 'production', substate: 'PROMOTED' });
  h.vercel.make({ sha: sha(3), ref: 'master', target: null });
  h.vercel.state.project.targets.production = { id: current.id };
  const client = await h.signedInClient();
  const dom = installDom(h.base, client.jar);
  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  t.after(async () => {
    clearTracked();
    dom.window.close();
    await h.close();
  });

  await importAdmin('app.js', '?signed-in');
  await waitFor(() => document.querySelector('.sidebar'), 'sidebar');
  const nav = [...document.querySelectorAll('.nav-link')].map((link) => link.textContent.trim());
  for (const label of ['Dashboard', 'Projects', 'Publishing', 'Overview', 'Versions', 'Branches', 'Previews', 'Production', 'History', 'Rollbacks', 'Images', 'Backups', 'Activity']) {
    assert.ok(nav.includes(label), `${label} missing from navigation: ${nav.join(', ')}`);
  }
  assert.match(document.querySelector('.user-foot').textContent, /admin@example\.com/);
  await waitFor(() => /Never published/.test(text()), 'publish state');
  assert.equal(buttonByText('Save changes').disabled, true);

  const state = await importAdmin('state.js');
  assert.equal(state.store.revision, 1);
  state.update((draft) => {
    draft.hero.description = 'Edited through the real dashboard code';
  });
  await waitFor(() => !buttonByText('Save changes').disabled, 'save enabled');
  click(buttonByText('Save changes'));
  await waitFor(() => /Draft saved/.test(text()), 'save toast');
  assert.equal(state.store.revision, 2);
  assert.equal(h.repo.state.draft.content.hero.description, 'Edited through the real dashboard code');
  assert.equal(h.repo.state.draft.revision, 2);

  await waitFor(() => !buttonByText('Publish').disabled, 'publish enabled');
  click(buttonByText('Publish'));
  await waitFor(() => document.querySelector('dialog[open]') && /Publish your saved draft/.test(text()), 'publish dialog');
  click(buttonByText('Publish to live site'));
  await waitFor(() => h.repo.state.publications.length === 1, 'publication stored');
  await waitFor(() => /Live site up to date/.test(text()), 'publish state refreshed');
  assert.equal((await h.createClient().call('/api/public/content')).body.hero.description, 'Edited through the real dashboard code');

  await go('deploy');
  await waitFor(() => /o\/r/.test(text()) && /Project portfolio/.test(text()), 'overview connections');
  assert.match(text(), /Production version/);
  assert.match(text(), new RegExp(sha(2).slice(0, 7)));

  await go('versions');
  await waitFor(() => /Ship contact form/.test(text()), 'commit list');
  assert.ok(buttonByText('Production\u2026'));

  await go('branches');
  await waitFor(() => /dev\/redesign/.test(text()), 'branch list');
  assert.match(text(), /Production/);
  click(buttonByText('New branch'));
  await waitFor(() => document.querySelector('#new-branch-name'), 'new branch form');
  document.querySelector('#new-branch-name').value = 'ui-test';
  click(buttonByText('Create branch'));
  await waitFor(() => h.github.state.branches['dev/ui-test'], 'branch created via UI');
  await waitFor(() => !document.querySelector('dialog[open]'), 'dialog closed');

  await go('previews');
  await waitFor(() => /Open preview/.test(text()), 'preview list');

  await go('history');
  await waitFor(() => /Production/.test(text()) && document.querySelectorAll('.rows-body .row').length >= 3, 'history rows');

  await go('rollbacks');
  await waitFor(() => /Previous production deployment/.test(text()), 'rollback list');
  click(buttonByText('Roll back\u2026'));
  await waitFor(() => document.querySelector('.typed-input'), 'typed confirmation');
  const confirm = () => buttonByText('Roll back', document.querySelector('dialog[open]'));
  assert.equal(confirm().disabled, true);
  const input = document.querySelector('.typed-input');
  input.value = 'wrong';
  input.dispatchEvent(new window.Event('input'));
  assert.equal(confirm().disabled, true);
  assert.equal(h.vercel.state.requests.filter((request) => request.path.includes('/rollback/')).length, 0);
  input.value = sha(1).slice(0, 7);
  input.dispatchEvent(new window.Event('input'));
  assert.equal(confirm().disabled, false);
  click(confirm());
  await waitFor(() => h.vercel.state.requests.some((request) => request.path.includes('/rollback/')), 'rollback request');
  await waitFor(() => /Rollback (verified|needs attention)/.test(text()), 'rollback result');

  await go(`production/${sha(3)}/master`);
  await waitFor(() => /Choose a version to deploy/.test(text()) && /Ship contact form/.test(text()), 'production selector');
  const deploy = buttonByText('Deploy to production\u2026');
  assert.ok(deploy);
  assert.equal(deploy.disabled, false);
  click(deploy);
  await waitFor(() => document.querySelector('.typed-input'), 'production confirmation');
  assert.equal(h.vercel.state.requests.filter((request) => request.method === 'POST' && request.path === '/v13/deployments').length, 0);
  const typed = document.querySelector('.typed-input');
  typed.value = sha(3).slice(0, 7);
  typed.dispatchEvent(new window.Event('input'));
  click(buttonByText('Deploy to production', document.querySelector('dialog[open]')));
  await waitFor(() => h.vercel.state.requests.some((request) => request.path === '/v13/deployments' && request.body.target === 'production'), 'production deployment request');
  await waitFor(() => /Production deployment/.test(text()), 'progress panel');

  await go('audit');
  await waitFor(() => /Deployed to production/.test(text()) && /Published/.test(text()) && /Saved draft/.test(text()), 'activity list');

  await go('publishing');
  await waitFor(() => /Publication history/.test(text()), 'publishing view');
  assert.match(text(), /Live/);

  await go('backups');
  await waitFor(() => /Restore/.test(text()), 'backups list');

  await go('images');
  await waitFor(() => document.querySelector('.tile-grid'), 'image library');

  assert.deepEqual(errors, []);
});

test('an expired session shows a recoverable modal and keeps unsaved edits', async (t) => {
  const h = await createHarness();
  const client = await h.signedInClient();
  const dom = installDom(h.base, client.jar);
  t.after(async () => {
    clearTracked();
    dom.window.close();
    await h.close();
  });
  await importAdmin('app.js', '?expiry');
  await waitFor(() => document.querySelector('.sidebar'), 'sidebar');
  const state = await importAdmin('state.js');
  state.update((draft) => {
    draft.hero.description = 'Unsaved work that must survive';
  });
  client.jar.delete('cms_session');
  await waitFor(() => !buttonByText('Save changes').disabled, 'save enabled');
  click(buttonByText('Save changes'));
  await waitFor(() => /Your session ended/.test(text()), 'session modal');
  assert.equal(state.store.draft.hero.description, 'Unsaved work that must survive');
  assert.equal(h.repo.state.draft.revision, 1);
  assert.equal(document.querySelector('dialog[open] a[href="/api/auth/login"]').getAttribute('target'), '_blank');
});

test('a save that loses a race shows the conflict dialog instead of overwriting', async (t) => {
  const h = await createHarness();
  const client = await h.signedInClient();
  const dom = installDom(h.base, client.jar);
  t.after(async () => {
    clearTracked();
    dom.window.close();
    await h.close();
  });
  await importAdmin('app.js', '?conflict');
  await waitFor(() => document.querySelector('.sidebar'), 'sidebar');
  const other = await h.signedInClient();
  const loaded = (await other.call('/api/admin/content')).body;
  const changed = JSON.parse(JSON.stringify(loaded.content));
  changed.hero.description = 'Saved from another device';
  assert.equal((await other.call('/api/admin/content', { method: 'PUT', json: { content: changed, revision: loaded.revision } })).status, 200);

  const state = await importAdmin('state.js');
  state.update((draft) => {
    draft.hero.description = 'My competing edit';
  });
  await waitFor(() => !buttonByText('Save changes').disabled, 'save enabled');
  click(buttonByText('Save changes'));
  await waitFor(() => /changed somewhere else/.test(text()), 'conflict dialog');
  assert.equal(h.repo.state.draft.content.hero.description, 'Saved from another device');
  click(buttonByText('Load latest version'));
  await waitFor(() => state.store.draft.hero.description === 'Saved from another device', 'latest loaded');
  assert.equal(state.store.revision, 2);
});
