import { h, plural } from '../../dom.js';
import { api } from '../../api.js';
import { pageHeader, btn, toast, openModal, emptyState, setBusy } from '../../ui.js';
import { loading, problem, statePill, when, commitCell, externalLink, isActive } from './common.js';
import { selectBox } from './versions.js';

export function previewsView(context) {
  const root = h('div', { class: 'page' });
  const body = h('div', {});
  let timer = null;
  let items = [];

  function render() {
    if (!items.length) {
      body.replaceChildren(emptyState({ iconName: 'eye', title: 'No previews yet', text: 'Deploy a branch or commit as a preview to inspect it before publishing.', action: btn('New preview', { variant: 'primary', iconName: 'plus', onClick: openNew }) }));
      return;
    }
    const cols = '--cols: minmax(0,1.8fr) 110px 110px auto';
    body.replaceChildren(
      h('div', { class: 'rows' }, h('div', { class: 'row row-head', style: cols, 'aria-hidden': 'true' }, h('span', {}, 'Version'), h('span', {}, 'Status'), h('span', {}, 'Created'), h('span', {})), h('div', { class: 'rows-body' }, items.map((item) =>
        h('div', { class: 'row', style: cols },
          commitCell(item),
          statePill(item),
          when(item.createdAt),
          h('div', { class: 'row-actions' },
            item.url && item.state === 'READY' ? h('a', { class: 'btn btn-secondary btn-sm', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open preview') : null,
            item.inspectorUrl ? externalLink(item.inspectorUrl, 'Logs') : null,
            item.state === 'READY' && item.sha && item.branch ? btn('Production\u2026', { small: true, iconName: 'rocket', onClick: () => context.navigate(`production/${item.sha}/${encodeURIComponent(item.branch)}`) }) : null
          )
        )
      ))),
      h('p', { class: 'muted footnote' }, 'Preview links may ask you to sign in to Vercel if Deployment Protection is on for previews.')
    );
  }

  async function load() {
    clearTimeout(timer);
    try {
      items = (await api.deploy.deployments('preview', 40)).deployments;
      render();
      if (items.some((item) => isActive(item.state))) timer = setTimeout(load, 5000);
    } catch (error) {
      body.replaceChildren(problem(error, load));
    }
  }

  async function openNew() {
    let branches;
    try {
      branches = (await api.deploy.branches()).branches;
    } catch (error) {
      toast(error.message, { kind: 'error' });
      return;
    }
    let ref = (branches.find((item) => !item.isProduction) || branches[0]).name;
    let sha = '';
    const commitHolder = h('div', { class: 'select-wrap' });
    async function loadCommits() {
      commitHolder.replaceChildren(h('span', { class: 'muted' }, 'Loading\u2026'));
      try {
        const { commits } = await api.deploy.commits(ref, 1);
        sha = commits[0] ? commits[0].sha : '';
        commitHolder.replaceChildren(selectBox('preview-commit', commits.map((commit, index) => ({ value: commit.sha, label: `${commit.shortSha} \u00b7 ${commit.message.slice(0, 60)}${index === 0 ? ' (latest)' : ''}` })), sha, (value) => { sha = value; }));
      } catch (error) {
        commitHolder.replaceChildren(h('span', { class: 'field-error' }, error.message));
      }
    }
    const start = btn('Deploy preview', { variant: 'primary', iconName: 'rocket', onClick: async () => {
      if (!sha) return;
      setBusy(start, true);
      try {
        await api.deploy.createPreview(ref, sha);
        modal.close();
        toast('Preview started. It appears below while it builds.', { kind: 'success' });
        load();
      } catch (error) {
        toast(error.message, { kind: 'error' });
      } finally {
        setBusy(start, false);
      }
    } });
    const modal = openModal({
      title: 'New preview',
      description: 'Builds a non-production copy of the site from the chosen commit.',
      body: [
        h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', { for: 'preview-branch' }, 'Branch')), h('div', { class: 'select-wrap' }, selectBox('preview-branch', branches.map((item) => ({ value: item.name, label: item.name })), ref, (value) => { ref = value; loadCommits(); }))),
        h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', { for: 'preview-commit' }, 'Commit')), commitHolder)
      ],
      footer: [btn('Cancel', { variant: 'ghost', onClick: () => modal.close() }), start]
    });
    loadCommits();
  }

  root.append(pageHeader({ title: 'Previews', description: 'Non-production builds you can inspect before anything is published.', actions: [btn('Refresh', { iconName: 'refresh', onClick: load }), btn('New preview', { variant: 'primary', iconName: 'plus', onClick: openNew })] }), body);
  body.append(loading());
  load();
  return { el: root, destroy: () => clearTimeout(timer) };
}
