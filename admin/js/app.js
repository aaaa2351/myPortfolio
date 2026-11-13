import { h, $, plural } from './dom.js';
import { icon } from './icons.js';
import { api, setUnauthorizedHandler } from './api.js';
import { store, initContent, discardChanges, isDirty, diffContent, subscribe, refreshStatus } from './state.js';
import { btn, setBusy, toast, openModal, confirmDialog, emptyState } from './ui.js';
import { createPreview } from './preview.js';
import { dashboardView } from './views/dashboard.js';
import { projectsView } from './views/projects.js';
import { homepageView } from './views/homepage.js';
import { profileView } from './views/profile.js';
import { toolsView } from './views/tools.js';
import { servicesView } from './views/services.js';
import { imagesView } from './views/images.js';
import { backupsView } from './views/backups.js';
import { loginView } from './views/login.js';
import { publishingView, openPublishDialog } from './views/publishing.js';
import { auditView } from './views/audit.js';
import { deployOverviewView } from './views/deploy/overview.js';
import { versionsView } from './views/deploy/versions.js';
import { branchesView } from './views/deploy/branches.js';
import { previewsView } from './views/deploy/previews.js';
import { productionView } from './views/deploy/production.js';
import { historyView } from './views/deploy/history.js';
import { rollbacksView } from './views/deploy/rollbacks.js';

const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout', mount: dashboardView, focus: null },
  { id: 'projects', label: 'Projects', icon: 'layers', group: 'Content', mount: projectsView, focus: 'projects' },
  { id: 'homepage', label: 'Homepage', icon: 'home', group: 'Content', mount: homepageView, focus: 'home' },
  { id: 'profile', label: 'Profile and contact', icon: 'user', group: 'Content', mount: profileView, focus: 'about' },
  { id: 'tools', label: 'Tools', icon: 'wrench', group: 'Content', mount: toolsView, focus: 'about' },
  { id: 'services', label: 'Services', icon: 'briefcase', group: 'Content', mount: servicesView, focus: 'services' },
  { id: 'publishing', label: 'Publishing', icon: 'globe', group: 'Content', mount: publishingView, focus: null },
  { id: 'deploy', label: 'Overview', icon: 'gauge', group: 'Deployment', mount: deployOverviewView, focus: null, standalone: true },
  { id: 'versions', label: 'Versions', icon: 'commit', group: 'Deployment', mount: versionsView, focus: null, standalone: true },
  { id: 'branches', label: 'Branches', icon: 'branch', group: 'Deployment', mount: branchesView, focus: null, standalone: true },
  { id: 'previews', label: 'Previews', icon: 'eye', group: 'Deployment', mount: previewsView, focus: null, standalone: true },
  { id: 'production', label: 'Production', icon: 'rocket', group: 'Deployment', mount: productionView, focus: null, standalone: true },
  { id: 'history', label: 'History', icon: 'history', group: 'Deployment', mount: historyView, focus: null, standalone: true },
  { id: 'rollbacks', label: 'Rollbacks', icon: 'restore', group: 'Deployment', mount: rollbacksView, focus: null, standalone: true },
  { id: 'images', label: 'Images', icon: 'image', group: 'Library', mount: imagesView, focus: null },
  { id: 'backups', label: 'Backups', icon: 'archive', group: 'Library', mount: backupsView, focus: null },
  { id: 'audit', label: 'Activity', icon: 'activity', group: 'Library', mount: auditView, focus: null, standalone: true }
];

const LINK_TARGETS = ['#home', '#projects', '#about', '#services', '#contact'];
const KIND_LABELS = { added: 'Added', edited: 'Edited', removed: 'Removed', reordered: 'Reordered' };

let shell;
let main;
let preview;
let topbarState;
let saveButton;
let previewButton;
let publishButton;
let sessionModalOpen = false;
let heartbeat = null;
let currentView = null;
let currentRoute = ROUTES[0];
let loadError = null;

function parseHash() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const route = ROUTES.find((item) => item.id === parts[0]) || ROUTES[0];
  return { route, params: parts.slice(1) };
}

function navigate(id) {
  window.location.hash = `#/${id}`;
}

function viewContext(params) {
  return { params, navigate, preview, reloadContent };
}

function renderRoute() {
  const { route, params } = parseHash();
  currentRoute = route;
  if (currentView && currentView.destroy) currentView.destroy();
  currentView = null;
  main.replaceChildren();

  document.querySelectorAll('.nav-link').forEach((link) => {
    const active = link.dataset.route === route.id;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (!store.draft && route.id !== 'backups' && !route.standalone) {
    main.append(renderLoadError());
  } else {
    currentView = route.mount(viewContext(params));
    main.append(currentView.el);
  }

  shell.classList.remove('nav-open');
  if (route.focus) preview.focus(route.focus);
  paintTopbar();
  main.scrollTop = 0;
  window.scrollTo(0, 0);
}

function renderLoadError() {
  const details = loadError && Array.isArray(loadError.details) ? loadError.details.slice(0, 6) : [];
  return h(
    'div',
    { class: 'page' },
    emptyState({
      iconName: 'alert',
      title: 'Portfolio data could not be loaded',
      text: loadError ? loadError.message : 'Unknown error.',
      action: h(
        'div',
        { class: 'btn-row' },
        btn('Try again', { iconName: 'refresh', onClick: () => reloadContent().catch(() => {}) }),
        btn('Open backups', { variant: 'primary', iconName: 'archive', onClick: () => navigate('backups') })
      )
    }),
    details.length ? h('ul', { class: 'warnings' }, details.map((item) => h('li', {}, icon('alert', 16), h('span', {}, `${item.path ? `${item.path}: ` : ''}${item.message}`)))) : null
  );
}

async function reloadContent() {
  try {
    const { content, revision, published } = await api.content();
    loadError = null;
    initContent(content, { revision, published });
  } catch (error) {
    loadError = error;
    initContent(null);
    toast(error.message, { kind: 'error' });
  }
  await refreshStatus();
  renderRoute();
}

function locate(path) {
  const draft = store.draft;
  const collection = /^(projectList|tools|wds)\[(\d+)\]/.exec(path);
  if (collection) {
    const [, key, index] = collection;
    const item = draft[key][Number(index)];
    const routes = { projectList: ['projects', 'Projects', item && item.name], tools: ['tools', 'Tools', item && item.name], wds: ['services', 'Services', item && item.title] };
    const [route, area, name] = routes[key];
    return { route, area: `${area}${name ? ` \u203a ${name}` : ` \u203a #${Number(index) + 1}`}` };
  }
  if (path.startsWith('site') || path.startsWith('hero')) return { route: 'homepage', area: path.startsWith('hero') ? 'Homepage \u203a Hero' : 'Homepage \u203a Page and navigation' };
  return { route: 'profile', area: 'Profile and contact' };
}

function showValidationErrors(errors) {
  const items = (errors || []).map((error) => ({ ...error, ...locate(error.path) }));
  const modal = openModal({
    title: 'Fix these before saving',
    description: `${plural(items.length, 'field')} need attention. Nothing was saved.`,
    size: 'md',
    body: h(
      'ul',
      { class: 'error-list' },
      items.map((item) =>
        h('li', {}, h('div', {}, h('p', { class: 'error-area' }, item.area), h('p', {}, item.message)), h('a', { class: 'link', href: `#/${item.route}`, onclick: () => modal.close() }, 'Go there'))
      )
    ),
    footer: btn('Close', { variant: 'primary', onClick: () => modal.close() })
  });
}

async function save() {
  if (store.saving || !isDirty()) return;
  store.saving = true;
  paintTopbar();
  try {
    const result = await api.save(store.draft, store.revision);
    initContent(result.content, { revision: result.revision });
    await refreshStatus();
    toast(result.unchanged ? 'No changes to save.' : 'Draft saved. The previous version was backed up. Publish when you are ready.', {
      kind: 'success',
      action: result.unchanged ? undefined : { label: 'Publish', onClick: publish }
    });
    renderRoute();
  } catch (error) {
    if (error.code === 'validation_failed') showValidationErrors(error.details);
    else if (error.code === 'revision_conflict') await handleConflict();
    else toast(error.message, { kind: 'error' });
  } finally {
    store.saving = false;
    paintTopbar();
  }
}

async function handleConflict() {
  const reload = await confirmDialog({
    title: 'This portfolio changed somewhere else',
    message: 'Another device or tab saved a newer version, so your save was not applied.',
    detail: 'Load the latest version to continue. Your unsaved edits here will be discarded.',
    confirmLabel: 'Load latest version',
    danger: true
  });
  if (reload) {
    await reloadContent();
    toast('Loaded the latest version.', { kind: 'info' });
  }
}

function publish() {
  if (isDirty()) {
    toast('Save your changes before publishing.', { kind: 'info' });
    return;
  }
  openPublishDialog({
    onDone: async () => {
      await reloadContent();
    }
  });
}

function reviewPopover() {
  const changes = diffContent(store.saved, store.draft);
  const popover = h(
    'div',
    { class: 'popover', role: 'dialog', 'aria-label': 'Unsaved changes' },
    h('p', { class: 'popover-title' }, `${plural(changes.length, 'unsaved change')}`),
    h(
      'ul',
      { class: 'change-list' },
      changes.map((change) =>
        h('li', {}, h('span', { class: `change-kind kind-${change.kind}` }, KIND_LABELS[change.kind]), h('a', { href: `#/${change.route}`, onclick: () => popover.remove() }, change.label))
      )
    ),
    h('div', { class: 'popover-foot' }, btn('Discard all changes', {
      variant: 'ghost',
      small: true,
      iconName: 'restore',
      onClick: async () => {
        popover.remove();
        const ok = await confirmDialog({
          title: 'Discard all unsaved changes?',
          message: 'Your draft returns to the last saved version.',
          confirmLabel: 'Discard changes',
          danger: true
        });
        if (!ok) return;
        discardChanges();
        renderRoute();
        toast('Draft reset to the last saved version.', { kind: 'info' });
      }
    }))
  );
  return popover;
}

function paintTopbar() {
  if (!topbarState) return;
  const dirty = isDirty();
  const changes = dirty ? diffContent(store.saved, store.draft) : [];
  topbarState.replaceChildren();

  if (!store.draft) {
    topbarState.append(h('span', { class: 'save-state is-warn' }, h('span', { class: 'dot dot-warn' }), 'Data unavailable'));
  } else if (dirty) {
    const trigger = h(
      'button',
      {
        type: 'button',
        class: 'save-state is-dirty',
        'aria-haspopup': 'dialog',
        onclick: (event) => {
          event.stopPropagation();
          const existing = $('.popover', topbarState);
          if (existing) {
            existing.remove();
            return;
          }
          topbarState.append(reviewPopover());
        }
      },
      h('span', { class: 'dot dot-warn' }),
      plural(changes.length, 'unsaved change'),
      icon('chevron', 14)
    );
    topbarState.append(trigger);
  } else {
    topbarState.append(h('span', { class: 'save-state' }, h('span', { class: 'dot dot-ok' }), 'All changes saved'));
  }

  if (store.draft && store.status) {
    const pending = store.status.unpublishedChanges;
    topbarState.append(h('span', { class: `save-state publish-state${pending ? ' is-pending' : ''}` }, h('span', { class: `dot ${pending ? 'dot-warn' : 'dot-ok'}` }), pending ? (store.status.published ? 'Not published' : 'Never published') : 'Live site up to date'));
  }

  if (publishButton) {
    const pending = Boolean(store.status && store.status.unpublishedChanges);
    publishButton.disabled = !store.draft || store.saving || (!pending && !dirty);
    publishButton.classList.toggle('btn-primary', pending && !dirty);
    publishButton.classList.toggle('btn-secondary', !(pending && !dirty));
  }

  setBusy(saveButton, store.saving);
  saveButton.disabled = !dirty || store.saving;
  if (publishButton && !publishButton.disabled && dirty) publishButton.disabled = true;
  document.title = `${dirty ? '\u2022 ' : ''}${currentRoute.label} \u00b7 Portfolio CMS`;
}

function buildSidebar() {
  const groups = [];
  for (const route of ROUTES) {
    const label = route.group || '';
    let group = groups.find((item) => item.label === label);
    if (!group) {
      group = { label, routes: [] };
      groups.push(group);
    }
    group.routes.push(route);
  }

  const user = store.session.user;
  return h(
    'aside',
    { class: 'sidebar', id: 'sidebar', 'aria-label': 'Primary' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('div', {}, h('p', { class: 'brand-name' }, 'Portfolio CMS'), h('p', { class: 'brand-sub' }, store.draft ? store.draft.site.navName : 'Remote editor'))),
    h(
      'nav',
      {},
      groups.map((group) =>
        h(
          'div',
          { class: 'nav-group' },
          group.label && h('p', { class: 'nav-group-label' }, group.label),
          group.routes.map((route) =>
            h('a', { class: 'nav-link', href: `#/${route.id}`, dataset: { route: route.id } }, icon(route.icon, 18), h('span', {}, route.label))
          )
        )
      )
    ),
    h(
      'div',
      { class: 'side-foot user-foot' },
      h('div', { class: 'user-chip' }, user.avatarUrl ? h('img', { src: user.avatarUrl, alt: '', referrerpolicy: 'no-referrer', width: 28, height: 28 }) : h('span', { class: 'user-initial', 'aria-hidden': 'true' }, (user.name || user.email).slice(0, 1).toUpperCase()), h('div', { class: 'user-text' }, h('p', { class: 'user-name' }, user.name), h('p', { class: 'side-foot-note', title: user.email }, user.email))),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm signout', onclick: signOut }, icon('logout', 16), h('span', {}, 'Sign out'))
    )
  );
}

function buildShell() {
  const app = $('#app');
  main = h('main', { id: 'main', tabindex: '-1' });
  topbarState = h('div', { class: 'topbar-state' });
  saveButton = btn('Save changes', { variant: 'primary', iconName: 'save', onClick: save, disabled: true });
  previewButton = btn('Preview', { variant: 'secondary', iconName: 'panel', onClick: () => preview.toggle() });
  previewButton.setAttribute('aria-pressed', 'false');
  publishButton = btn('Publish', { variant: 'secondary', iconName: 'globe', onClick: publish, disabled: true });

  preview = createPreview({
    onVisibilityChange(open) {
      shell.classList.toggle('has-preview', open);
      previewButton.setAttribute('aria-pressed', String(open));
    }
  });

  const menuButton = h('button', { type: 'button', class: 'btn btn-ghost btn-icon menu-toggle', 'aria-label': 'Open navigation', onclick: () => shell.classList.toggle('nav-open') }, icon('menu', 20));

  shell = h(
    'div',
    { class: 'shell' },
    buildSidebar(),
    h(
      'div',
      { class: 'workspace' },
      h(
        'header',
        { class: 'topbar' },
        menuButton,
        topbarState,
        h('div', { class: 'topbar-actions' }, previewButton, publishButton, h('a', { class: 'btn btn-secondary btn-icon', href: '/', target: '_blank', rel: 'noopener', title: 'Open the public portfolio', 'aria-label': 'Open the public portfolio in a new tab' }, icon('external', 18)), saveButton)
      ),
      main
    ),
    preview.el,
    h('div', { class: 'scrim', onclick: () => shell.classList.remove('nav-open') }),
    h('datalist', { id: 'link-targets' }, LINK_TARGETS.map((value) => h('option', { value })))
  );

  app.replaceChildren(shell);
  document.addEventListener('click', (event) => {
    const popover = $('.popover', topbarState);
    if (popover && !popover.contains(event.target)) popover.remove();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const popover = $('.popover', topbarState);
      if (popover) popover.remove();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
}

function fatal(message) {
  $('#app').replaceChildren(
    h('div', { class: 'boot' }, h('div', { class: 'boot-card' }, icon('alert', 22), h('h1', {}, 'Cannot start the CMS'), h('p', { class: 'muted' }, message), btn('Try again', { variant: 'primary', onClick: () => window.location.reload() })))
  );
}

async function signOut() {
  if (isDirty()) {
    const leave = await confirmDialog({ title: 'Sign out with unsaved changes?', message: 'Your unsaved draft edits will be lost.', confirmLabel: 'Sign out', danger: true });
    if (!leave) return;
  }
  try {
    await api.logout();
  } catch {
    toast('Could not reach the server to end the session.', { kind: 'error' });
  }
  window.location.assign('/admin/');
}

function onSessionLost() {
  if (sessionModalOpen || !store.session) return;
  sessionModalOpen = true;
  const status = h('p', { class: 'muted', role: 'status' });
  const check = btn('I have signed in', { variant: 'primary', iconName: 'check', onClick: async () => {
    setBusy(check, true);
    try {
      const session = await api.session();
      if (session.authenticated && session.user.email === store.session.user.email) {
        modal.close();
        toast('Signed in again. Your draft is untouched.', { kind: 'success' });
      } else if (session.authenticated) {
        status.textContent = 'That is a different account. Reload to switch accounts.';
      } else {
        status.textContent = 'Not signed in yet. Finish signing in on the other tab first.';
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(check, false);
    }
  } });
  const modal = openModal({
    title: 'Your session ended',
    description: 'Sign in again in a new tab. This tab keeps your unsaved edits.',
    size: 'sm',
    body: [h('a', { class: 'btn btn-secondary', href: '/api/auth/login', target: '_blank', rel: 'noopener' }, icon('external', 16), h('span', {}, 'Sign in in a new tab')), status],
    footer: [btn('Reload page', { variant: 'ghost', onClick: () => window.location.reload() }), check],
    onClose: () => {
      sessionModalOpen = false;
    }
  });
}

function startHeartbeat() {
  const ping = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const session = await api.session();
      if (!session.authenticated) onSessionLost();
    } catch {
      return;
    }
  };
  heartbeat = setInterval(ping, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', ping);
}

function renderLogin(reason) {
  const params = new URLSearchParams(window.location.search);
  const authError = params.get('auth_error');
  if (params.has('auth_error')) window.history.replaceState(null, '', window.location.pathname);
  $('#app').replaceChildren(loginView({ reason, authError }));
}

async function boot() {
  let session;
  try {
    session = await api.session();
  } catch (error) {
    fatal(error.message);
    return;
  }
  if (!session.authenticated) {
    renderLogin(session.reason);
    return;
  }
  store.session = { ...session, maxUploadBytes: session.limits.maxUploadBytes };
  setUnauthorizedHandler(onSessionLost);
  try {
    const { content, revision, published } = await api.content();
    initContent(content, { revision, published });
  } catch (error) {
    loadError = error;
    initContent(null);
  }

  buildShell();
  subscribe(paintTopbar);
  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  renderRoute();
  refreshStatus();
  startHeartbeat();
}

boot();
