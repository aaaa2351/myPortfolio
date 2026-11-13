import { h } from '../../dom.js';
import { api } from '../../api.js';
import { pageHeader, btn, emptyState, chip, segmented } from '../../ui.js';
import { loading, problem, statePill, when, commitCell, externalLink, isActive } from './common.js';

function duration(ms) {
  if (!ms) return '\u2013';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function historyView() {
  const root = h('div', { class: 'page' });
  const body = h('div', {});
  let filter = '';
  let timer = null;

  function render(items) {
    if (!items.length) {
      body.replaceChildren(emptyState({ iconName: 'history', title: 'No deployments', text: 'Nothing matches this filter yet.' }));
      return;
    }
    const cols = '--cols: minmax(0,1.8fr) 100px 100px 70px 100px auto';
    body.replaceChildren(
      h('div', { class: 'rows' }, h('div', { class: 'row row-head', style: cols, 'aria-hidden': 'true' }, h('span', {}, 'Version'), h('span', {}, 'Environment'), h('span', {}, 'Status'), h('span', {}, 'Build'), h('span', {}, 'Created'), h('span', {}, 'Started by')), h('div', { class: 'rows-body' }, items.map((item) =>
        h('div', { class: 'row', style: cols },
          commitCell(item),
          h('span', {}, item.target === 'production' ? chip('Production', 'accent') : chip('Preview')),
          statePill(item),
          h('span', { class: 'mono-sm' }, duration(item.durationMs)),
          when(item.createdAt),
          h('div', { class: 'cell-text' }, h('p', { class: 'row-sub' }, item.triggeredBy || item.creator || 'Git push'), item.inspectorUrl ? externalLink(item.inspectorUrl, 'Logs') : null)
        )
      )))
    );
  }

  async function load() {
    clearTimeout(timer);
    try {
      const { deployments } = await api.deploy.deployments(filter, 60);
      render(deployments);
      if (deployments.some((item) => isActive(item.state))) timer = setTimeout(load, 6000);
    } catch (error) {
      body.replaceChildren(problem(error, load));
    }
  }

  const filters = segmented({ label: 'Filter deployments', options: [{ value: '', label: 'All' }, { value: 'production', label: 'Production' }, { value: 'preview', label: 'Previews' }], value: filter, onChange: (value) => { filter = value; body.replaceChildren(loading()); load(); } });
  root.append(pageHeader({ title: 'Deployment history', description: 'Every deployment for this project, newest first. History is never deleted by the CMS.', actions: [filters, btn('Refresh', { iconName: 'refresh', onClick: load })] }), body);
  body.append(loading());
  load();
  return { el: root, destroy: () => clearTimeout(timer) };
}
