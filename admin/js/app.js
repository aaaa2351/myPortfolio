import { h, $, plural } from './dom.js';
import { icon } from './icons.js';
import { api } from './api.js';
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

const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout', mount: dashboardView, focus: null },
  { id: 'projects', label: 'Projects', icon: 'layers', group: 'Content', mount: projectsView, focus: 'projects' },
  { id: 'homepage', label: 'Homepage', icon: 'home', group: 'Content', mount: homepageView, focus: 'home' },
  { id: 'profile', label: 'Profile and contact', icon: 'user', group: 'Content', mount: profileView, focus: 'about' },
  { id: 'tools', label: 'Tools', icon: 'wrench', group: 'Content', mount: toolsView, focus: 'about' },
  { id: 'services', label: 'Services', icon: 'briefcase', group: 'Content', mount: servicesView, focus: 'services' },
  { id: 'images', label: 'Images', icon: 'image', group: 'Library', mount: imagesView, focus: null },
  { id: 'backups', label: 'Backups', icon: 'archive', group: 'Library', mount: backupsView, focus: null }
];

const LINK_TARGETS = ['#home', '#projects', '#about', '#services', '#contact'];
const KIND_LABELS = { added: 'Added', edited: 'Edited', removed: 'Removed', reordered: 'Reordered' };

let shell;
let main;
let preview;
let topbarState;
let saveButton;
let previewButton;
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

  if (!store.draft && route.id !== 'backups') {
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
    const { content } = await api.content();
    loadError = null;
    initContent(content);
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
    description: `${plural(items.length, 'field')} need attention. Nothing was written to disk.`,
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
    const result = await api.save(store.draft);
    initContent(result.content);
    await refreshStatus();
    toast(result.unchanged ? 'No changes to save.' : 'Saved. The previous version was backed up.', {
      kind: 'success',
      action: result.backup ? { label: 'View backups', onClick: () => navigate('backups') } : undefined
    });
    renderRoute();
  } catch (error) {
    if (error.code === 'validation_failed') showValidationErrors(error.details);
    else toast(error.message, { kind: 'error' });
  } finally {
    store.saving = false;
    paintTopbar();
  }
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

  setBusy(saveButton, store.saving);
  saveButton.disabled = !dirty || store.saving;
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

  const port = (store.session && new URL(store.session.origin).port) || window.location.port;
  return h(
    'aside',
    { class: 'sidebar', id: 'sidebar', 'aria-label': 'Primary' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('div', {}, h('p', { class: 'brand-name' }, 'Portfolio CMS'), h('p', { class: 'brand-sub' }, store.draft ? store.draft.site.navName : 'Local editor'))),
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
    h('div', { class: 'side-foot' }, h('span', { class: 'dot dot-ok' }), h('div', {}, h('p', { class: 'mono-sm' }, `127.0.0.1:${port}`), h('p', { class: 'side-foot-note' }, 'Local only. Nothing is published automatically.')))
  );
}

function buildShell() {
  const app = $('#app');
  main = h('main', { id: 'main', tabindex: '-1' });
  topbarState = h('div', { class: 'topbar-state' });
  saveButton = btn('Save changes', { variant: 'primary', iconName: 'save', onClick: save, disabled: true });
  previewButton = btn('Preview', { variant: 'secondary', iconName: 'panel', onClick: () => preview.toggle() });
  previewButton.setAttribute('aria-pressed', 'false');

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
        h('div', { class: 'topbar-actions' }, previewButton, h('a', { class: 'btn btn-secondary btn-icon', href: '/', target: '_blank', rel: 'noopener', title: 'Open the portfolio', 'aria-label': 'Open the portfolio in a new tab' }, icon('external', 18)), saveButton)
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

async function boot() {
  try {
    store.session = await api.session();
  } catch (error) {
    fatal(error.message);
    return;
  }
  try {
    const { content } = await api.content();
    initContent(content);
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
}

boot();
