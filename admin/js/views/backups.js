import { h, formatBytes, formatDate, timeAgo, plural } from '../dom.js';
import { api } from '../api.js';
import { isDirty } from '../state.js';
import { pageHeader, btn, openModal, confirmDialog, toast, emptyState, chip, setBusy } from '../ui.js';

export function backupsView(context) {
  const root = h('div', { class: 'page' });
  const body = h('div', {});

  function summaryText(entry) {
    if (!entry.summary) return 'Not a valid portfolio file';
    return `${plural(entry.summary.projects, 'project')} \u00b7 ${plural(entry.summary.tools, 'tool')} \u00b7 ${plural(entry.summary.services, 'service')}`;
  }

  async function restore(entry, closeModal) {
    const dirty = isDirty();
    const confirmed = await confirmDialog({
      title: 'Restore this backup?',
      message: `The portfolio will be replaced with the version from ${formatDate(entry.createdAt, true)}.`,
      detail: `Your current saved version is backed up first, so you can undo this.${dirty ? ' Unsaved changes in this draft will be discarded.' : ''}`,
      confirmLabel: 'Restore backup',
      danger: true
    });
    if (!confirmed) return;
    try {
      const result = await api.restore(entry.name);
      if (closeModal) closeModal();
      await context.reloadContent();
      toast(result.unchanged ? 'That backup matches the current version, so nothing changed.' : 'Backup restored. The previous version was backed up first.', { kind: 'success' });
      load();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  }

  async function view(entry) {
    let data;
    try {
      data = (await api.backup(entry.name)).backup;
    } catch (error) {
      toast(error.message, { kind: 'error' });
      return;
    }
    const restoreButton = btn('Restore this version', { variant: 'primary', iconName: 'restore', disabled: !data.valid, onClick: () => restore(entry, () => modal.close()) });
    const modal = openModal({
      title: formatDate(data.createdAt, true),
      description: `${data.name} \u00b7 ${formatBytes(data.size)}`,
      size: 'lg',
      body: [
        data.valid ? h('p', { class: 'muted' }, summaryText(data)) : h('p', { class: 'field-error' }, `This backup does not match the current format: ${data.errors.map((item) => item.message).join(' ')}`),
        h('pre', { class: 'code-view', tabindex: '0', 'aria-label': 'Backup contents (read only)' }, JSON.stringify(data.content, null, 2))
      ],
      footer: [btn('Close', { variant: 'ghost', onClick: () => modal.close() }), restoreButton]
    });
  }

  async function load() {
    body.replaceChildren(h('p', { class: 'muted' }, 'Loading backups\u2026'));
    let backups;
    try {
      backups = (await api.backups()).backups;
    } catch (error) {
      body.replaceChildren(h('p', { class: 'field-error' }, error.message));
      return;
    }
    if (!backups.length) {
      body.replaceChildren(emptyState({ iconName: 'archive', title: 'No backups yet', text: 'A backup of the previous version is created every time you save changes.' }));
      return;
    }
    const rows = h('div', { class: 'rows backup-rows' });
    rows.style.setProperty('--cols', 'minmax(0, 1.2fr) minmax(0, 1.4fr) 72px auto');
    rows.append(
      h('div', { class: 'row row-head', 'aria-hidden': 'true' }, h('span', {}, 'Saved'), h('span', { class: 'col-hide' }, 'Contents'), h('span', { class: 'col-hide' }, 'Size'), h('span', {})),
      h(
        'div',
        { class: 'rows-body' },
        backups.map((entry, index) =>
          h(
            'div',
            { class: 'row' },
            h('div', { class: 'cell-text' }, h('p', { class: 'row-title-static' }, formatDate(entry.createdAt, true), index === 0 && chip('Latest', 'accent')), h('p', { class: 'row-sub mono-sm' }, `${timeAgo(entry.createdAt)} \u00b7 ${entry.name}`)),
            h('div', { class: 'cell col-hide' }, entry.valid ? summaryText(entry) : chip('Unreadable', 'danger')),
            h('div', { class: 'cell col-hide' }, h('span', { class: 'mono-sm' }, formatBytes(entry.size))),
            h('div', { class: 'row-actions' }, btn('View', { variant: 'ghost', small: true, iconName: 'eye', onClick: () => view(entry) }), btn('Restore', { variant: 'secondary', small: true, iconName: 'restore', disabled: !entry.valid, onClick: (event) => { const button = event.currentTarget; setBusy(button, true); restore(entry).finally(() => setBusy(button, false)); } }))
          )
        )
      )
    );
    body.replaceChildren(rows);
  }

  root.append(pageHeader({ title: 'Backups', description: 'A timestamped copy of the previous version is saved in data/backups before every successful save and restore. Backups are never deleted automatically.' }), body);
  load();
  return { el: root };
}
