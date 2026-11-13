import { h } from '../../dom.js';
import { api } from '../../api.js';
import { pageHeader, btn, toast, openModal, emptyState, chip, setBusy } from '../../ui.js';
import { loading, problem, shaCode, statePill } from './common.js';
import { selectBox } from './versions.js';

function field(id, label, input, hint) {
  return h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', { for: id }, label)), input, hint && h('p', { class: 'field-hint' }, hint));
}

export function branchesView(context) {
  const root = h('div', { class: 'page' });
  const body = h('div', {});
  let branches = [];

  function openCreate() {
    const production = branches.find((item) => item.isProduction);
    let from = production ? production.name : branches[0] ? branches[0].name : '';
    const name = h('input', { id: 'new-branch-name', type: 'text', placeholder: 'homepage-refresh', autocomplete: 'off', spellcheck: 'false', maxlength: '90' });
    const error = h('p', { class: 'field-error', role: 'alert' });
    const create = btn('Create branch', { variant: 'primary', iconName: 'branch', onClick: async () => {
      error.textContent = '';
      if (!name.value.trim()) {
        error.textContent = 'Enter a branch name.';
        return;
      }
      setBusy(create, true);
      try {
        const { branch } = await api.deploy.createBranch(name.value.trim(), from);
        modal.close();
        toast(`Created ${branch.name}`, { kind: 'success' });
        load();
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        setBusy(create, false);
      }
    } });
    const modal = openModal({
      title: 'New development branch',
      description: 'Branches are created from an existing version. Production is never modified.',
      body: [
        field('new-branch-name', 'Branch name', name, 'Created under dev/. Letters, numbers, dots, dashes and underscores.'),
        field('new-branch-from', 'Start from', h('div', { class: 'select-wrap' }, selectBox('new-branch-from', branches.map((item) => ({ value: item.name, label: item.name })), from, (value) => { from = value; })), 'The latest commit of this branch is used.'),
        error
      ],
      footer: [btn('Cancel', { variant: 'ghost', onClick: () => modal.close() }), create]
    });
    name.focus();
  }

  async function deploy(item, button) {
    setBusy(button, true);
    try {
      await api.deploy.createPreview(item.name, item.sha);
      toast(`Preview of ${item.name} started.`, { kind: 'success', action: { label: 'Open previews', onClick: () => context.navigate('previews') } });
      load();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      setBusy(button, false);
    }
  }

  function render() {
    if (!branches.length) {
      body.replaceChildren(emptyState({ iconName: 'branch', title: 'No branches', text: 'The repository has no branches yet.' }));
      return;
    }
    const cols = '--cols: minmax(0,1.5fr) 100px 140px auto';
    body.replaceChildren(
      h('div', { class: 'rows' }, h('div', { class: 'row row-head', style: cols, 'aria-hidden': 'true' }, h('span', {}, 'Branch'), h('span', {}, 'Head'), h('span', {}, 'Deployment'), h('span', {})), h('div', { class: 'rows-body' }, branches.map((item) => {
        const button = btn('Preview', { small: true, iconName: 'eye', onClick: () => deploy(item, button) });
        return h('div', { class: 'row', style: cols },
          h('div', { class: 'cell-text' }, h('p', { class: 'row-title-static' }, item.name, item.isProduction && chip('Production', 'accent'), item.protected && !item.isProduction && chip('Protected')), h('p', { class: 'row-sub' }, item.isProduction ? 'Protected from changes in this dashboard' : 'Development branch')),
          shaCode(item.sha),
          item.deployment ? statePill(item.deployment.state) : h('span', { class: 'muted' }, 'Not deployed'),
          h('div', { class: 'row-actions' }, btn('Versions', { small: true, variant: 'ghost', iconName: 'commit', onClick: () => context.navigate(`versions/${encodeURIComponent(item.name)}`) }), button)
        );
      })))
    );
  }

  async function load() {
    try {
      branches = (await api.deploy.branches()).branches;
      render();
    } catch (error) {
      body.replaceChildren(problem(error, load));
    }
  }

  root.append(pageHeader({ title: 'Branches', description: 'Work on changes in a development branch and deploy it as a preview before it goes anywhere near production.', actions: [btn('Refresh', { iconName: 'refresh', onClick: load }), btn('New branch', { variant: 'primary', iconName: 'plus', onClick: openCreate })] }), body);
  body.append(loading());
  load();
  return { el: root };
}
