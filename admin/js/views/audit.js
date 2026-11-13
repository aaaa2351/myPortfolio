import { h } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, btn, emptyState, chip } from '../ui.js';
import { when } from './deploy/common.js';

const LABELS = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.denied': 'Sign-in refused',
  'content.save': 'Saved draft',
  'content.restore': 'Restored backup',
  'content.publish': 'Published',
  'content.republish': 'Republished',
  'image.upload': 'Uploaded image',
  'image.delete': 'Deleted image',
  'deploy.branch.create': 'Created branch',
  'deploy.preview': 'Started preview',
  'deploy.production': 'Deployed to production',
  'deploy.promote': 'Promoted deployment',
  'deploy.rollback': 'Rolled back'
};

export function auditView() {
  const root = h('div', { class: 'page' });
  const body = h('div', {});

  async function load() {
    try {
      const { entries } = await api.audit(100);
      if (!entries.length) {
        body.replaceChildren(emptyState({ iconName: 'activity', title: 'No activity yet', text: 'Sign-ins, saves, publishes and deployments appear here.' }));
        return;
      }
      const cols = '--cols: 110px minmax(0,1.2fr) minmax(0,1.3fr) 90px';
      body.replaceChildren(h('div', { class: 'rows' }, h('div', { class: 'row row-head', style: cols, 'aria-hidden': 'true' }, h('span', {}, 'When'), h('span', {}, 'Action'), h('span', {}, 'Who and what'), h('span', {}, 'Result')), h('div', { class: 'rows-body' }, entries.map((entry) =>
        h('div', { class: 'row', style: cols },
          when(entry.at),
          h('div', { class: 'cell-text' }, h('p', { class: 'row-title-static' }, LABELS[entry.action] || entry.action), h('p', { class: 'row-sub mono-sm' }, entry.action)),
          h('div', { class: 'cell-text' }, h('p', { class: 'row-sub' }, entry.actor || 'Unknown'), h('p', { class: 'row-sub mono-sm' }, entry.target || '')),
          entry.outcome === 'success' ? chip('OK') : chip(entry.outcome === 'denied' ? 'Denied' : 'Failed', 'danger')
        )
      ))));
    } catch (error) {
      body.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load activity', text: error.message, action: btn('Try again', { iconName: 'refresh', onClick: load }) }));
    }
  }

  root.append(pageHeader({ title: 'Activity', description: 'An append-only record of sign-ins, edits, publishes and deployments.', actions: btn('Refresh', { iconName: 'refresh', onClick: load }) }), body);
  body.append(h('p', { class: 'muted' }, 'Loading\u2026'));
  load();
  return { el: root };
}
