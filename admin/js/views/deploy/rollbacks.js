import { h } from '../../dom.js';
import { api } from '../../api.js';
import { pageHeader, panel, btn, toast, confirmTyped, emptyState, setBusy } from '../../ui.js';
import { loading, problem, statePill, shaCode, when, commitCell, externalLink, checkList } from './common.js';

export function rollbacksView() {
  const root = h('div', { class: 'page' });
  const body = h('div', {});
  const result = h('div', {});

  async function verify(id) {
    result.replaceChildren(panel({ title: 'Rollback complete', body: loading('Verifying\u2026') }));
    try {
      const check = await api.deploy.verify(id);
      result.replaceChildren(
        panel({
          title: check.passed ? 'Rollback verified' : 'Rollback needs attention',
          body: [
            h('p', { class: 'muted' }, `Production now points at ${check.deployment.shortSha || check.deployment.id}. Earlier deployments were kept, so you can move forward again at any time.`),
            checkList(check.checks),
            h('div', { class: 'notice notice-info' }, h('p', {}, 'Vercel stops auto-assigning production domains after a rollback. To resume, deploy a version from Production and promote it.'))
          ]
        })
      );
    } catch (error) {
      result.replaceChildren(panel({ title: 'Rollback requested', body: h('p', { class: 'field-error' }, `Verification failed: ${error.message}`) }));
    }
  }

  async function rollback(candidate, button) {
    const confirmed = await confirmTyped({
      title: 'Roll back production?',
      message: `Production will serve ${candidate.shortSha || candidate.id}${candidate.message ? ` \u2013 ${candidate.message}` : ''}.`,
      detail: 'No rebuild happens and nothing is deleted. The version you are replacing stays in history.',
      expected: candidate.confirmation,
      confirmLabel: 'Roll back'
    });
    if (!confirmed) return;
    setBusy(button, true);
    try {
      await api.deploy.rollback(candidate.id, candidate.confirmation, 'Rollback from Deployment Center');
      toast('Rollback requested.', { kind: 'success' });
      await verify(candidate.id);
      load();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      setBusy(button, false);
    }
  }

  function render({ current, candidates }) {
    const cols = '--cols: minmax(0,1.8fr) 100px 110px auto';
    body.replaceChildren(
      panel({ title: 'Currently live', body: current ? h('div', { class: 'live-card' }, h('div', {}, h('p', { class: 'live-sha' }, shaCode(current.sha), ' ', statePill(current)), h('p', { class: 'row-title-static' }, current.message || ''), h('p', { class: 'muted mono-sm' }, 'Deployed ', when(current.createdAt)))) : h('p', { class: 'muted' }, 'No live production deployment was found.') }),
      candidates.length
        ? h('div', { class: 'rows' }, h('div', { class: 'row row-head', style: cols, 'aria-hidden': 'true' }, h('span', {}, 'Previous production deployment'), h('span', {}, 'Status'), h('span', {}, 'Deployed'), h('span', {})), h('div', { class: 'rows-body' }, candidates.map((candidate) => {
            const button = btn('Roll back\u2026', { small: true, iconName: 'restore', onClick: () => rollback(candidate, button) });
            return h('div', { class: 'row', style: cols }, commitCell(candidate), statePill(candidate), when(candidate.createdAt), h('div', { class: 'row-actions' }, candidate.inspectorUrl ? externalLink(candidate.inspectorUrl, 'Logs') : null, button));
          })))
        : emptyState({ iconName: 'restore', title: 'Nothing to roll back to', text: 'Earlier successful production deployments will be listed here.' })
    );
  }

  async function load() {
    try {
      render(await api.deploy.rollbacks());
    } catch (error) {
      body.replaceChildren(problem(error, load));
    }
  }

  root.append(pageHeader({ title: 'Rollbacks', description: 'Restore an earlier production deployment instantly. History is preserved.', actions: btn('Refresh', { iconName: 'refresh', onClick: load }) }), body, result);
  body.append(loading());
  load();
  return { el: root };
}
