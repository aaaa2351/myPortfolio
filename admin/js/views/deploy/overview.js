import { h, formatDate, plural } from '../../dom.js';
import { api } from '../../api.js';
import { pageHeader, panel, btn, emptyState } from '../../ui.js';
import { store } from '../../state.js';
import { loading, problem, statePill, shaCode, when, externalLink, commitCell } from './common.js';

function connection({ label, connected, detail, error }) {
  return h(
    'div',
    { class: 'status-row' },
    h('span', { class: `dot dot-${connected ? 'ok' : error ? 'danger' : 'warn'}` }),
    h('div', { class: 'status-text' }, h('p', { class: 'status-label' }, label), h('p', { class: 'status-value' }, connected ? detail : error || 'Not connected'))
  );
}

function stat(label, value, meta) {
  return h('div', { class: 'stat stat-static' }, h('p', { class: 'stat-label' }, label), h('div', { class: 'stat-number stat-text' }, value), h('p', { class: 'stat-meta' }, meta || '\u00a0'));
}

export function deployOverviewView(context) {
  const root = h('div', { class: 'page' });
  const body = h('div', {});
  let timer = null;

  function render(data) {
    const production = data.production;
    const latest = data.latestSuccessful;
    const publishing = store.status;
    const strip = h(
      'div',
      { class: 'stat-strip' },
      stat('Production version', production ? shaCode(production.sha) : 'None', production ? production.message || production.branch : 'No production deployment found'),
      stat('Status', production ? statePill(production) : 'Unknown', data.inProgress.length ? `${plural(data.inProgress.length, 'build')} in progress` : 'No builds in progress'),
      stat('Last successful deploy', latest ? when(latest.createdAt) : 'Never', latest ? `${latest.shortSha || ''} on ${latest.branch || 'unknown branch'}` : ''),
      stat('Site content', publishing && publishing.unpublishedChanges ? 'Unpublished edits' : 'Up to date', publishing && publishing.published ? `Published ${formatDate(publishing.published.publishedAt, true)}` : 'Never published')
    );

    const connections = h(
      'div',
      { class: 'status-list' },
      connection({ label: 'GitHub', connected: data.github.connected, detail: data.github.connected ? h('span', {}, externalLink(data.github.url, data.github.fullName), ` \u00b7 production branch ${data.productionBranch}${data.github.canPush ? '' : ' \u00b7 read-only token'}`) : '', error: data.github.error || (data.missing.github.length ? `Missing ${data.missing.github.join(', ')}` : '') }),
      connection({ label: 'Vercel', connected: data.vercel.connected, detail: data.vercel.connected ? `Project ${data.vercel.name}` : '', error: data.vercel.error || (data.missing.vercel.length ? `Missing ${data.missing.vercel.join(', ')}` : '') }),
      h('div', { class: 'status-row' }, h('span', { class: `dot dot-${data.requirePreviewBeforeProduction ? 'ok' : 'warn'}` }), h('div', { class: 'status-text' }, h('p', { class: 'status-label' }, 'Production guard'), h('p', { class: 'status-value' }, data.requirePreviewBeforeProduction ? 'A finished preview of the exact commit is required before production.' : 'Preview-first guard is switched off.')))
    );

    const recent = data.recent.length
      ? h('div', { class: 'rows' }, h('div', { class: 'rows-body' }, data.recent.map((item) => h('div', { class: 'row', style: '--cols: minmax(0,1.6fr) 90px 110px 90px' }, commitCell(item), h('span', { class: 'chip' }, item.target === 'production' ? 'Production' : 'Preview'), statePill(item), when(item.createdAt)))))
      : emptyState({ iconName: 'rocket', title: 'No deployments yet', text: 'Deploy a preview from Versions or Branches to get started.' });

    body.replaceChildren(
      strip,
      h('div', { class: 'dash-grid' }, panel({ title: 'Connections', body: connections }), panel({ title: 'Quick actions', body: h('div', { class: 'shortcuts' }, ...[['commit', 'Browse versions', '#/versions'], ['branch', 'Branches', '#/branches'], ['eye', 'Previews', '#/previews'], ['rocket', 'Deploy to production', '#/production'], ['restore', 'Rollbacks', '#/rollbacks']].map(([iconName, label, href]) => h('a', { class: 'shortcut', href }, h('span', {}, label)))) })),
      panel({ title: 'Recent deployments', actions: btn('View all', { variant: 'ghost', small: true, onClick: () => context.navigate('history') }), body: recent })
    );
    if (data.inProgress.length || data.recent.some((item) => ['BUILDING', 'QUEUED', 'INITIALIZING'].includes(item.state))) timer = setTimeout(load, 6000);
  }

  async function load() {
    clearTimeout(timer);
    try {
      render(await api.deploy.overview());
    } catch (error) {
      body.replaceChildren(problem(error, load));
    }
  }

  root.append(pageHeader({ title: 'Deployment Center', description: 'What is live, what is building and where it came from.', actions: btn('Refresh', { iconName: 'refresh', onClick: load }) }), body);
  body.append(loading());
  load();
  return { el: root, destroy: () => clearTimeout(timer) };
}
