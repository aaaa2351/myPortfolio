import { h, timeAgo, formatDate } from '../../dom.js';
import { icon } from '../../icons.js';
import { api } from '../../api.js';
import { btn, emptyState, toast } from '../../ui.js';

const STATE_TONE = { READY: 'ok', BUILDING: 'warn', QUEUED: 'warn', INITIALIZING: 'warn', ERROR: 'danger', CANCELED: 'idle', DELETED: 'idle' };
const STATE_LABEL = { READY: 'Ready', BUILDING: 'Building', QUEUED: 'Queued', INITIALIZING: 'Starting', ERROR: 'Failed', CANCELED: 'Canceled', DELETED: 'Deleted' };
const ACTIVE = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);
const FINISHED = new Set(['READY', 'ERROR', 'CANCELED', 'DELETED']);

export function isActive(state) {
  return ACTIVE.has(state);
}

export function statePill(deployment) {
  const state = typeof deployment === 'string' ? deployment : deployment.state;
  const substate = typeof deployment === 'string' ? null : deployment.substate;
  const label = substate === 'STAGED' ? 'Staged' : STATE_LABEL[state] || state;
  const tone = substate === 'STAGED' ? 'warn' : STATE_TONE[state] || 'idle';
  return h('span', { class: `state-pill tone-${tone}` }, h('span', { class: `dot dot-${tone}` }), label);
}

export function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '\u2013';
}

export function shaCode(sha) {
  return h('code', { class: 'sha' }, shortSha(sha));
}

export function when(iso) {
  return iso ? h('span', { class: 'mono-sm', title: formatDate(iso, true) }, timeAgo(iso)) : h('span', { class: 'muted' }, '\u2013');
}

export function externalLink(href, label) {
  return h('a', { class: 'link inline-link', href, target: '_blank', rel: 'noopener noreferrer' }, label, icon('external', 13));
}

export function loading(text = 'Loading\u2026') {
  return h('div', { class: 'loading-block', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { class: 'muted' }, text));
}

export function problem(error, retry) {
  const missing = error && error.details && Array.isArray(error.details.missing) ? error.details.missing : [];
  if (error && error.code === 'not_configured') {
    return emptyState({
      iconName: 'info',
      title: `${error.details && error.details.service === 'vercel' ? 'Vercel' : error.details && error.details.service === 'github' ? 'GitHub' : 'This integration'} is not connected`,
      text: missing.length ? `Add ${missing.join(', ')} to the server environment, then redeploy. docs/SETUP.md has the exact steps.` : 'Add the missing environment variables on the server. docs/SETUP.md has the exact steps.',
      action: retry && btn('Check again', { iconName: 'refresh', onClick: retry })
    });
  }
  return emptyState({
    iconName: 'alert',
    title: 'Could not load this page',
    text: error ? error.message : 'Unknown error.',
    action: retry && btn('Try again', { iconName: 'refresh', onClick: retry })
  });
}

export function copyButton(text, label = 'Copy') {
  return btn(label, {
    small: true,
    variant: 'ghost',
    iconName: 'copy',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied', { kind: 'success', timeout: 1500 });
      } catch {
        toast('Copy is not available here.', { kind: 'error' });
      }
    }
  });
}

export function watchDeployment(id, onUpdate, { interval = 4000, limit = 20 * 60 * 1000 } = {}) {
  let stopped = false;
  let timer = null;
  const started = Date.now();
  async function tick() {
    if (stopped) return;
    try {
      const { deployment } = await api.deploy.deployment(id);
      if (stopped) return;
      onUpdate(deployment);
      if (FINISHED.has(deployment.state) || Date.now() - started > limit) return;
    } catch (error) {
      if (!stopped) onUpdate(null, error);
    }
    if (!stopped) timer = setTimeout(tick, interval);
  }
  timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

export function commitCell(item) {
  return h('div', { class: 'cell-text' }, h('p', { class: 'row-title-static' }, item.message || 'No commit message'), h('p', { class: 'row-sub mono-sm' }, [item.branch, item.shortSha || shortSha(item.sha)].filter(Boolean).join(' \u00b7 ')));
}

export function checkList(checks) {
  return h(
    'ul',
    { class: 'check-list' },
    checks.map((check) =>
      h(
        'li',
        { class: `check check-${check.status}` },
        icon(check.status === 'pass' ? 'checkCircle' : check.status === 'fail' ? 'alert' : 'info', 16),
        h('div', {}, h('p', { class: 'check-label' }, check.label), h('p', { class: 'muted check-detail' }, check.detail))
      )
    )
  );
}

export function destroyers() {
  const list = [];
  return { add: (fn) => list.push(fn), run: () => list.splice(0).forEach((fn) => fn()) };
}
