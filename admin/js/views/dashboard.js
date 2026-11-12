import { h, timeAgo, formatDate, formatBytes, plural } from '../dom.js';
import { icon } from '../icons.js';
import { store, isDirty, diffContent, contentWarnings, refreshStatus, subscribe } from '../state.js';
import { pageHeader, panel, btn } from '../ui.js';

function latest(items) {
  return items.map((item) => item.updatedAt).filter(Boolean).sort().pop() || '';
}

function recentEntries(content) {
  const sectionLabels = {
    site: ['Page and navigation settings', 'homepage'],
    hero: ['Homepage hero', 'homepage'],
    profile: ['Profile and About', 'profile'],
    contact: ['Contact banner', 'profile'],
    socials: ['Social links', 'profile'],
    footer: ['Footer', 'profile']
  };
  const entries = [];
  for (const [key, [label, route]] of Object.entries(sectionLabels)) {
    const at = content.meta.sections[key];
    if (at) entries.push({ label, kind: 'Section', route, at });
  }
  content.projectList.forEach((item) => item.updatedAt && entries.push({ label: item.name, kind: 'Project', route: 'projects', at: item.updatedAt }));
  content.tools.forEach((item) => item.updatedAt && entries.push({ label: item.name, kind: 'Tool', route: 'tools', at: item.updatedAt }));
  content.wds.forEach((item) => item.updatedAt && entries.push({ label: item.title, kind: 'Service', route: 'services', at: item.updatedAt }));
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);
}

function statusRow({ tone, label, value, route }) {
  const content = h('div', { class: 'status-value' }, value);
  return h(
    'div',
    { class: 'status-row' },
    h('span', { class: `dot dot-${tone}`, 'aria-hidden': 'true' }),
    h('div', {}, h('p', { class: 'status-label' }, label), content),
    route && h('a', { class: 'status-link', href: `#/${route}`, 'aria-label': `Open ${label}` }, icon('right', 16))
  );
}

export function dashboardView(context) {
  const root = h('div', { class: 'page' });
  let unsubscribe = null;

  function render() {
    const content = store.draft;
    const status = store.status;
    const dirty = isDirty();
    const changes = diffContent(store.saved, store.draft);
    const warnings = contentWarnings(content);
    const missing = status ? status.missingImages : [];

    const stat = (route, label, count, at) =>
      h('a', { class: 'stat', href: `#/${route}` }, h('span', { class: 'stat-number' }, String(count)), h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-meta' }, at ? `Updated ${timeAgo(at)}` : 'No updates yet'));

    const strip = h(
      'div',
      { class: 'stat-strip' },
      stat('projects', 'Projects', content.projectList.length, latest(content.projectList)),
      stat('tools', 'Tools', content.tools.length, latest(content.tools)),
      stat('services', 'Services', content.wds.length, latest(content.wds)),
      stat('backups', 'Backups', status ? status.backupCount : '\u2013', content.meta.updatedAt)
    );

    const recent = recentEntries(content);
    const recentBody = recent.length
      ? h('ul', { class: 'recent' }, recent.map((entry) => h('li', {}, h('a', { href: `#/${entry.route}` }, h('span', { class: 'recent-name' }, entry.label), h('span', { class: 'recent-kind' }, entry.kind), h('span', { class: 'mono-sm' }, timeAgo(entry.at))))))
      : h('p', { class: 'muted' }, 'Nothing has been saved yet.');

    const siteUrl = (store.session && store.session.origin) || window.location.origin;
    const statusBody = h(
      'div',
      { class: 'status-list' },
      statusRow({ tone: dirty ? 'warn' : 'ok', label: 'Content', value: dirty ? `${plural(changes.length, 'unsaved change')} in this draft` : `All changes saved \u00b7 ${timeAgo(content.meta.updatedAt)}` }),
      statusRow({ tone: 'ok', label: 'Local site', value: h('a', { class: 'mono-sm link', href: '/', target: '_blank', rel: 'noopener' }, `${siteUrl}/`) }),
      statusRow({
        tone: !status ? 'idle' : missing.length ? 'warn' : 'ok',
        label: 'Image files',
        value: !status ? 'Status unavailable' : missing.length ? `${missing.length} referenced ${missing.length === 1 ? 'image is' : 'images are'} missing from public/` : `All ${status.localImagesReferenced} local images found`,
        route: 'images'
      }),
      statusRow({ tone: status && status.dataValid ? 'ok' : 'warn', label: 'Data file', value: status ? `public/data/portfolio.json \u00b7 ${formatBytes(status.fileBytes)}` : 'Status unavailable' }),
      statusRow({ tone: 'ok', label: 'Deployment', value: 'Static files in public/ are ready to deploy. Nothing is pushed automatically.' })
    );

    const missingList = missing.length
      ? h('details', { class: 'missing' }, h('summary', {}, `Show ${plural(missing.length, 'missing file')}`), h('ul', {}, missing.map((item) => h('li', {}, h('code', {}, item.path), h('span', { class: 'muted' }, ` \u2013 ${item.usedBy.join(', ')}`)))))
      : null;

    const warningList = warnings.length
      ? h('ul', { class: 'warnings' }, warnings.map((item) => h('li', {}, icon('alert', 16), h('span', {}, item.message), h('a', { href: `#/${item.route}`, class: 'link' }, 'Review'))))
      : null;

    const shortcut = (iconName, label, href, onClick) =>
      h('a', { class: 'shortcut', href: href || '#', onclick: onClick ? (event) => { event.preventDefault(); onClick(); } : null }, icon(iconName, 18), h('span', {}, label));

    root.replaceChildren(
      pageHeader({ title: 'Dashboard', description: 'Your portfolio content, saved state and local site at a glance.' }),
      strip,
      h(
        'div',
        { class: 'dash-grid' },
        panel({ title: 'Recently updated', body: recentBody }),
        panel({ title: 'Portfolio status', body: [statusBody, missingList, warningList && h('div', { class: 'checks' }, h('h3', {}, 'Content checks'), warningList)] })
      ),
      panel({
        title: 'Shortcuts',
        body: h(
          'div',
          { class: 'shortcuts' },
          shortcut('plus', 'Add project', '#/projects/new'),
          shortcut('home', 'Edit hero', '#/homepage'),
          shortcut('user', 'Update profile', '#/profile'),
          shortcut('wrench', 'Add tool', '#/tools/new'),
          shortcut('briefcase', 'Add service', '#/services/new'),
          shortcut('image', 'Image library', '#/images'),
          shortcut('archive', 'View backups', '#/backups'),
          shortcut('panel', 'Open live preview', null, () => context.preview.toggle())
        )
      })
    );
  }

  render();
  refreshStatus();
  unsubscribe = subscribe(render);
  return { el: root, destroy: () => unsubscribe && unsubscribe() };
}
