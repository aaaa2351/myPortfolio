import { h, formatDate, plural } from '../dom.js';
import { api } from '../api.js';
import { store, diffContent } from '../state.js';
import { pageHeader, panel, btn, toast, openModal, confirmDialog, emptyState, chip, setBusy } from '../ui.js';

const KIND_LABELS = { added: 'Added', edited: 'Edited', removed: 'Removed', reordered: 'Reordered' };

function changeList(changes) {
  return h('ul', { class: 'change-list' }, changes.map((change) => h('li', {}, h('span', { class: `change-kind kind-${change.kind}` }, KIND_LABELS[change.kind]), h('span', {}, change.label))));
}

export async function openPublishDialog({ onDone }) {
  let state;
  try {
    state = await api.publishing();
  } catch (error) {
    toast(error.message, { kind: 'error' });
    return;
  }
  if (!state.pending) {
    toast('The live site already matches your saved draft.', { kind: 'info' });
    return;
  }
  const changes = state.published ? diffContent(state.published.content, store.saved) : [];
  const note = h('input', { type: 'text', maxlength: '200', placeholder: 'What changed? (optional)', 'aria-label': 'Publish note' });
  const publish = btn('Publish to live site', { variant: 'primary', iconName: 'globe', onClick: async () => {
    setBusy(publish, true);
    try {
      const result = await api.publish(state.draft.revision, note.value.trim());
      modal.close();
      toast(result.unchanged ? 'Nothing to publish.' : 'Published. Visitors see it within about a minute.', { kind: 'success' });
      if (onDone) onDone();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      setBusy(publish, false);
    }
  } });
  const modal = openModal({
    title: 'Publish your saved draft?',
    description: state.published ? `Replaces the version published ${formatDate(state.published.publishedAt, true)}.` : 'This is the first publication. Everything in the draft goes live.',
    body: [
      state.published ? (changes.length ? [h('p', { class: 'popover-title' }, plural(changes.length, 'change') + ' going live'), changeList(changes)] : h('p', { class: 'muted' }, 'Content differs in small details only.')) : null,
      h('div', { class: 'field' }, h('div', { class: 'field-top' }, h('label', {}, 'Note')), note)
    ],
    footer: [btn('Cancel', { variant: 'ghost', onClick: () => modal.close() }), publish]
  });
  note.focus();
}

export function publishingView(context) {
  const root = h('div', { class: 'page' });
  const body = h('div', {});

  async function republish(entry, button) {
    const ok = await confirmDialog({
      title: 'Republish this version?',
      message: `The live site will show the content published ${formatDate(entry.publishedAt, true)}.`,
      detail: 'Your draft is not changed. You can publish the draft again afterwards.',
      confirmLabel: 'Republish',
      danger: true
    });
    if (!ok) return;
    setBusy(button, true);
    try {
      await api.republish(entry.id);
      toast('Republished.', { kind: 'success' });
      context.reloadContent();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      setBusy(button, false);
    }
  }

  function render(state) {
    const pending = state.pending;
    const changes = state.published && store.saved ? diffContent(state.published.content, store.saved) : [];
    const status = h('div', { class: 'status-list' },
      h('div', { class: 'status-row' }, h('span', { class: `dot dot-${pending ? 'warn' : 'ok'}` }), h('div', { class: 'status-text' }, h('p', { class: 'status-label' }, 'Live site'), h('p', { class: 'status-value' }, state.published ? `${pending ? 'Behind your draft' : 'Matches your draft'} \u00b7 published ${formatDate(state.published.publishedAt, true)} by ${state.published.publishedBy || 'unknown'}` : 'Nothing published yet'))),
      h('div', { class: 'status-row' }, h('span', { class: 'dot dot-ok' }), h('div', { class: 'status-text' }, h('p', { class: 'status-label' }, 'Saved draft'), h('p', { class: 'status-value' }, `Revision ${state.draft.revision} \u00b7 saved ${formatDate(state.draft.updatedAt, true)}`)))
    );
    const pendingBody = pending
      ? [changes.length ? changeList(changes) : h('p', { class: 'muted' }, state.published ? 'Small differences only.' : 'The whole portfolio will go live.'), h('div', { class: 'btn-row' }, btn('Publish\u2026', { variant: 'primary', iconName: 'globe', onClick: () => openPublishDialog({ onDone: context.reloadContent }) }))]
      : h('p', { class: 'muted' }, 'There is nothing waiting to be published.');

    const cols = '--cols: minmax(0,1.4fr) minmax(0,1.4fr) auto';
    const history = state.history.length
      ? h('div', { class: 'rows' }, h('div', { class: 'rows-body' }, state.history.map((entry, index) => {
          const button = btn('Republish', { small: true, iconName: 'restore', disabled: index === 0 && !pending, onClick: () => republish(entry, button) });
          return h('div', { class: 'row', style: cols },
            h('div', { class: 'cell-text' }, h('p', { class: 'row-title-static' }, formatDate(entry.publishedAt, true), index === 0 && chip('Live', 'accent')), h('p', { class: 'row-sub' }, `${entry.publishedBy || 'unknown'}${entry.republishedFrom ? ` \u00b7 republish of #${entry.republishedFrom}` : ''}`)),
            h('div', { class: 'cell-text' }, h('p', { class: 'row-sub' }, entry.note || 'No note'), h('p', { class: 'row-sub mono-sm' }, `Version #${entry.id}`)),
            h('div', { class: 'row-actions' }, index === 0 ? null : button)
          );
        })))
      : emptyState({ iconName: 'history', title: 'No publications yet', text: 'Publish your saved draft to make it visible at the public address.' });

    body.replaceChildren(
      panel({ title: 'Status', body: status }),
      panel({ title: 'Waiting to publish', description: 'Saving only updates the draft. Visitors keep seeing the published version.', body: pendingBody }),
      panel({ title: 'Publication history', description: 'Each publication is kept permanently. Republishing an older one creates a new entry.', body: history })
    );
  }

  async function load() {
    try {
      render(await api.publishing());
    } catch (error) {
      body.replaceChildren(emptyState({ iconName: 'alert', title: 'Could not load publishing state', text: error.message, action: btn('Try again', { iconName: 'refresh', onClick: load }) }));
    }
  }

  root.append(pageHeader({ title: 'Publishing', description: 'Editing and publishing are separate. Review what is going live, then publish.' }), body);
  body.append(h('p', { class: 'muted' }, 'Loading\u2026'));
  load();
  return { el: root };
}
