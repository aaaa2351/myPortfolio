import { h, plural } from '../../dom.js';
import { api } from '../../api.js';
import { pageHeader, panel, btn, toast, emptyState, setBusy } from '../../ui.js';
import { loading, problem, shaCode, when, statePill, externalLink, copyButton } from './common.js';

export function selectBox(id, options, value, onChange) {
  const select = h('select', { id }, options.map((option) => h('option', { value: option.value, selected: option.value === value }, option.label)));
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function versionsView(context) {
  const root = h('div', { class: 'page' });
  const body = h('div', {});
  const toolbar = h('div', { class: 'toolbar' });
  let branches = [];
  let branch = context.params[0] ? decodeURIComponent(context.params[0]) : '';
  let page = 1;
  let commits = [];
  let more = false;

  async function preview(commit, button) {
    setBusy(button, true);
    try {
      const { deployment } = await api.deploy.createPreview(branch, commit.sha);
      toast(`Preview of ${commit.shortSha} started.`, { kind: 'success', action: { label: 'Open previews', onClick: () => context.navigate('previews') } });
      commit.deployments.unshift({ id: deployment.id, state: deployment.state, target: 'preview', url: deployment.url });
      renderCommits();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      setBusy(button, false);
    }
  }

  function renderCommits() {
    if (!commits.length) {
      body.replaceChildren(emptyState({ iconName: 'commit', title: 'No commits found', text: `Nothing to show for ${branch}.` }));
      return;
    }
    const rows = commits.map((commit) => {
      const latest = commit.deployments[0];
      const button = btn('Preview', { small: true, iconName: 'eye', onClick: () => preview(commit, button) });
      return h(
        'div',
        { class: 'row', style: '--cols: minmax(0,2fr) 140px 120px auto' },
        h('div', { class: 'cell-text' }, h('p', { class: 'row-title-static' }, commit.message), h('p', { class: 'row-sub mono-sm' }, h('span', {}, shaCode(commit.sha), ` \u00b7 ${commit.author}`))),
        when(commit.date),
        latest ? statePill(latest.state) : h('span', { class: 'muted' }, 'Not deployed'),
        h('div', { class: 'row-actions' }, copyButton(commit.sha, ''), commit.url ? externalLink(commit.url, 'GitHub') : null, button, btn('Production\u2026', { small: true, iconName: 'rocket', onClick: () => context.navigate(`production/${commit.sha}/${encodeURIComponent(branch)}`) }))
      );
    });
    body.replaceChildren(
      h('div', { class: 'rows' }, h('div', { class: 'row row-head', style: '--cols: minmax(0,2fr) 140px 120px auto', 'aria-hidden': 'true' }, h('span', {}, 'Commit'), h('span', {}, 'Committed'), h('span', {}, 'Deployment'), h('span', {})), h('div', { class: 'rows-body' }, rows)),
      more ? h('div', { class: 'btn-row load-more' }, btn('Load older commits', { onClick: loadMore })) : null
    );
  }

  async function loadMore() {
    page += 1;
    try {
      const { commits: next } = await api.deploy.commits(branch, page);
      commits = [...commits, ...next];
      more = next.length >= 30;
      renderCommits();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  }

  async function loadCommits() {
    body.replaceChildren(loading('Loading commits\u2026'));
    page = 1;
    try {
      const result = await api.deploy.commits(branch, 1);
      commits = result.commits;
      more = commits.length >= 30;
      renderCommits();
    } catch (error) {
      body.replaceChildren(problem(error, loadCommits));
    }
  }

  async function init() {
    try {
      const [overview, list] = await Promise.all([api.deploy.overview(), api.deploy.branches()]);
      branches = list.branches;
      if (!branch) branch = overview.productionBranch;
      toolbar.replaceChildren(
        h('label', { class: 'toolbar-label', for: 'branch-select' }, 'Branch'),
        h('div', { class: 'select-wrap toolbar-select' }, selectBox('branch-select', branches.map((item) => ({ value: item.name, label: item.isProduction ? `${item.name} (production)` : item.name })), branch, (value) => { branch = value; history.replaceState(null, '', `#/versions/${encodeURIComponent(value)}`); loadCommits(); }))
      );
      await loadCommits();
    } catch (error) {
      body.replaceChildren(problem(error, init));
    }
  }

  root.append(pageHeader({ title: 'Versions', description: 'Every commit on a branch, with its deployment status. Selecting a version never changes Git history.' }), panel({ body: toolbar }), body);
  body.append(loading());
  init();
  return { el: root };
}
