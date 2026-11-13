import { h } from '../../dom.js';
import { api } from '../../api.js';
import { pageHeader, panel, btn, toast, confirmTyped, setBusy, emptyState } from '../../ui.js';
import { loading, problem, statePill, shaCode, when, externalLink, watchDeployment, checkList, isActive } from './common.js';
import { selectBox } from './versions.js';

export function productionView(context) {
  const root = h('div', { class: 'page' });
  const currentHost = h('div', {});
  const selectorHost = h('div', {});
  const progressHost = h('div', {});
  const stops = [];
  let overview = null;
  let branches = [];
  let branch = context.params[1] ? decodeURIComponent(context.params[1]) : '';
  let commits = [];
  let sha = context.params[0] || '';
  let tracked = null;
  let verification = null;

  function selected() {
    return commits.find((commit) => commit.sha === sha) || null;
  }

  function renderCurrent() {
    const current = overview && overview.production;
    currentHost.replaceChildren(
      panel({
        title: 'Live in production',
        body: current
          ? h('div', { class: 'live-card' }, h('div', {}, h('p', { class: 'live-sha' }, shaCode(current.sha), ' ', statePill(current)), h('p', { class: 'row-title-static' }, current.message || 'No commit message'), h('p', { class: 'muted mono-sm' }, `${current.branch || 'unknown branch'} \u00b7 deployed `, when(current.createdAt))), current.aliases.length ? externalLink(`https://${current.aliases[0]}`, current.aliases[0]) : null)
          : h('p', { class: 'muted' }, 'No production deployment was found for this project.')
      })
    );
  }

  function renderSelector() {
    const commit = selected();
    const ready = commit ? commit.deployments.find((item) => item.state === 'READY') : null;
    const building = commit ? commit.deployments.find((item) => isActive(item.state)) : null;
    const busy = tracked && isActive(tracked.state);
    const deployButton = btn('Deploy to production\u2026', { variant: 'primary', iconName: 'rocket', disabled: !commit || busy || (overview && overview.requirePreviewBeforeProduction && !ready), onClick: () => start(deployButton) });
    const previewButton = btn(building ? 'Preview is building' : 'Deploy a preview first', { iconName: 'eye', disabled: Boolean(building), onClick: () => previewFirst(previewButton) });

    selectorHost.replaceChildren(
      panel({
        title: 'Choose a version to deploy',
        description: 'Only commits that already exist on the chosen branch can be selected. Git history is never rewritten.',
        body: [
          h('div', { class: 'toolbar' },
            h('label', { class: 'toolbar-label', for: 'prod-branch' }, 'Branch'),
            h('div', { class: 'select-wrap toolbar-select' }, selectBox('prod-branch', branches.map((item) => ({ value: item.name, label: item.name })), branch, (value) => { branch = value; sha = ''; loadCommits(); })),
            h('label', { class: 'toolbar-label', for: 'prod-commit' }, 'Commit'),
            h('div', { class: 'select-wrap toolbar-select toolbar-wide' }, selectBox('prod-commit', commits.map((item) => ({ value: item.sha, label: `${item.shortSha} \u00b7 ${item.message.slice(0, 70)}` })), sha, (value) => { sha = value; renderSelector(); }))
          ),
          commit
            ? h('div', { class: 'commit-card' },
                h('p', { class: 'row-title-static' }, commit.message),
                h('p', { class: 'muted mono-sm' }, h('span', {}, shaCode(commit.sha), ` \u00b7 ${commit.author} \u00b7 `), when(commit.date)),
                h('p', { class: 'guard-line' }, ready ? h('span', {}, statePill('READY'), ' A preview of this exact commit finished building. ', ready.url ? externalLink(ready.url, 'Inspect it') : null) : building ? h('span', {}, statePill('BUILDING'), ' A preview is still building.') : h('span', { class: 'guard-warn' }, 'No finished preview of this commit exists yet.')),
                h('div', { class: 'btn-row' }, ready || !overview || !overview.requirePreviewBeforeProduction ? null : previewButton, deployButton))
            : emptyState({ iconName: 'commit', title: 'Pick a commit', text: 'Choose a branch and commit above.' })
        ]
      })
    );
  }

  async function previewFirst(button) {
    setBusy(button, true);
    try {
      await api.deploy.createPreview(branch, sha);
      toast('Preview started. Come back when it is ready.', { kind: 'success', action: { label: 'Open previews', onClick: () => context.navigate('previews') } });
      await loadCommits();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      setBusy(button, false);
    }
  }

  async function start(button) {
    const commit = selected();
    if (!commit) return;
    const confirmed = await confirmTyped({
      title: 'Deploy to production?',
      message: `${commit.shortSha} \u2013 ${commit.message}`,
      detail: 'This builds the commit with production settings and replaces the live site when it succeeds. You can roll back from the Rollbacks page.',
      expected: commit.shortSha,
      confirmLabel: 'Deploy to production'
    });
    if (!confirmed) return;
    setBusy(button, true);
    try {
      const { deployment } = await api.deploy.deployProduction(branch, commit.sha, commit.shortSha);
      toast('Production deployment started.', { kind: 'success' });
      verification = null;
      track(deployment);
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      setBusy(button, false);
    }
  }

  async function runVerify(id) {
    verification = null;
    renderProgress();
    try {
      verification = await api.deploy.verify(id);
    } catch (error) {
      verification = { checks: [{ id: 'verify', label: 'Verification', status: 'fail', detail: error.message }], passed: false };
    }
    renderProgress();
  }

  async function promote() {
    const confirmed = await confirmTyped({
      title: 'Promote to production domains?',
      message: `${tracked.shortSha} \u2013 ${tracked.message || ''}`,
      detail: 'The build finished but is not serving your domains yet. Promoting points them at this deployment.',
      expected: tracked.shortSha,
      confirmLabel: 'Promote'
    });
    if (!confirmed) return;
    try {
      const { deployment } = await api.deploy.promote(tracked.id, tracked.shortSha);
      tracked = deployment;
      toast('Promoted. Verifying\u2026', { kind: 'success' });
      await runVerify(tracked.id);
      refreshOverview();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  }

  function renderProgress() {
    if (!tracked) {
      progressHost.replaceChildren();
      return;
    }
    const needsPromote = tracked.state === 'READY' && tracked.substate === 'STAGED';
    progressHost.replaceChildren(
      panel({
        title: 'Production deployment',
        body: [
          h('div', { class: 'live-card' }, h('div', {}, h('p', { class: 'live-sha' }, shaCode(tracked.sha), ' ', statePill(tracked)), h('p', { class: 'row-title-static' }, tracked.message || ''), h('p', { class: 'muted mono-sm' }, `Started `, when(tracked.createdAt))), tracked.inspectorUrl ? externalLink(tracked.inspectorUrl, 'Build logs') : null),
          isActive(tracked.state) ? loading('Building\u2026 this page updates automatically.') : null,
          tracked.state === 'ERROR' ? h('p', { class: 'field-error' }, tracked.errorMessage || 'The build failed. Production was not changed. Check the build logs.') : null,
          needsPromote ? h('div', { class: 'notice notice-warn' }, h('p', {}, 'Built successfully but not live. Vercel keeps new deployments staged after a rollback until you promote one.'), btn('Promote\u2026', { variant: 'primary', iconName: 'rocket', onClick: promote })) : null,
          verification ? h('div', { class: 'verify' }, h('h3', {}, verification.passed ? 'Verified' : 'Verification found problems'), checkList(verification.checks)) : null,
          tracked.state === 'READY' && !verification ? loading('Verifying\u2026') : null
        ]
      })
    );
  }

  function track(deployment) {
    stops.splice(0).forEach((stop) => stop());
    tracked = deployment;
    renderProgress();
    renderSelector();
    stops.push(
      watchDeployment(deployment.id, async (update, error) => {
        if (error || !update) return;
        const finished = update.state !== tracked.state || update.substate !== tracked.substate;
        tracked = { ...tracked, ...update };
        renderProgress();
        if (finished && update.state === 'READY') {
          await runVerify(update.id);
          refreshOverview();
        }
        if (finished) renderSelector();
      })
    );
  }

  async function refreshOverview() {
    try {
      overview = await api.deploy.overview();
      renderCurrent();
    } catch {
      overview = overview || null;
    }
  }

  async function loadCommits() {
    selectorHost.replaceChildren(loading('Loading commits\u2026'));
    try {
      commits = (await api.deploy.commits(branch, 1)).commits;
      if (!commits.some((commit) => commit.sha === sha)) sha = commits[0] ? commits[0].sha : '';
      renderSelector();
    } catch (error) {
      selectorHost.replaceChildren(problem(error, loadCommits));
    }
  }

  async function init() {
    try {
      const [summary, list] = await Promise.all([api.deploy.overview(), api.deploy.branches()]);
      overview = summary;
      branches = list.branches;
      if (!branch || !branches.some((item) => item.name === branch)) branch = summary.productionBranch;
      renderCurrent();
      const running = summary.inProgress[0];
      await loadCommits();
      if (running) track(running);
    } catch (error) {
      selectorHost.replaceChildren(problem(error, init));
    }
  }

  root.append(pageHeader({ title: 'Production', description: 'Deploy a chosen version to the live site. Typed confirmation is required and the result is verified.' }), currentHost, selectorHost, progressHost);
  selectorHost.append(loading());
  init();
  return { el: root, destroy: () => stops.splice(0).forEach((stop) => stop()) };
}
