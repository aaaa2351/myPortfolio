import { h, clone, timeAgo, plural } from '../dom.js';
import { icon } from '../icons.js';
import { store, update } from '../state.js';
import { btn, iconButton, confirmDialog, openModal, emptyState, pageHeader, toast, flashItem } from '../ui.js';
import { makeSortable, moveItem } from '../sortable.js';
import { imageSrc } from '../picker.js';

export function checkFields(fields) {
  let first = null;
  for (const field of fields) {
    if (!field.check() && !first) first = field;
  }
  if (first && first.focus) first.focus();
  return !first;
}

export function createCollectionView(config) {
  return function mount(context) {
    const root = h('div', { class: 'page' });
    const list = () => store.draft[config.key];

    function thumb(item) {
      const source = config.imageOf(item);
      const img = h('img', { src: imageSrc(source), alt: '', loading: 'lazy', draggable: 'false' });
      const box = h('span', { class: `row-thumb${config.layout === 'cards' ? ' is-logo' : ''}${source ? '' : ' is-missing'}` }, img);
      img.addEventListener('error', () => box.classList.add('is-missing'));
      return box;
    }

    function remove(item) {
      confirmDialog({
        title: `Delete ${config.noun}?`,
        message: `\u201c${config.titleOf(item)}\u201d will be removed from your draft.`,
        detail: 'Nothing changes on disk until you save, and the previous version is backed up automatically when you do.',
        confirmLabel: `Delete ${config.noun}`,
        danger: true
      }).then((confirmed) => {
        if (!confirmed) return;
        update((draft) => {
          draft[config.key] = draft[config.key].filter((entry) => entry.id !== item.id);
        });
        render();
        toast(`${config.titleOf(item)} deleted. Save changes to apply.`, { kind: 'info' });
      });
    }

    function move(from, to) {
      let moved = false;
      update((draft) => {
        moved = moveItem(draft[config.key], from, to);
      });
      if (moved) {
        render();
        flashItem(root, list()[to].id);
      }
    }

    function edit(item) {
      const isNew = !item;
      const working = item ? clone(item) : config.newItem();
      const form = config.form(working);
      const formEl = h('form', { novalidate: true, class: 'modal-form', onsubmit: (event) => { event.preventDefault(); submit(); } }, form.el);
      const submitLabel = isNew ? config.addLabel : `Update ${config.noun}`;

      function submit() {
        if (!form.check()) return;
        const values = form.values();
        update((draft) => {
          const entries = draft[config.key];
          const index = entries.findIndex((entry) => entry.id === working.id);
          const next = { ...(index >= 0 ? entries[index] : {}), ...values, id: working.id };
          if (index >= 0) entries[index] = next;
          else entries.push(next);
        });
        modal.close();
        render();
        flashItem(root, working.id);
        toast(`${config.titleOf(values)} ${isNew ? 'added' : 'updated'}. Save changes to apply.`, { kind: 'success' });
      }

      const modal = openModal({
        title: isNew ? config.addLabel : `Edit ${config.noun}`,
        description: isNew ? config.addDescription : config.titleOf(working),
        size: 'lg',
        body: formEl,
        footer: [btn('Cancel', { variant: 'ghost', onClick: () => modal.close() }), btn(submitLabel, { variant: 'primary', onClick: () => formEl.requestSubmit() })]
      });
      const firstInput = formEl.querySelector('input, textarea');
      if (firstInput) firstInput.focus();
    }

    function actions(item, index, horizontal) {
      const entries = list();
      return h(
        'div',
        { class: 'row-actions' },
        iconButton(horizontal ? 'left' : 'up', horizontal ? 'Move earlier' : 'Move up', () => move(index, index - 1), { disabled: index === 0 }),
        iconButton(horizontal ? 'right' : 'down', horizontal ? 'Move later' : 'Move down', () => move(index, index + 1), { disabled: index === entries.length - 1 }),
        iconButton('pencil', `Edit ${config.titleOf(item)}`, () => edit(item)),
        iconButton('trash', `Delete ${config.titleOf(item)}`, () => remove(item), { danger: true })
      );
    }

    function tableRow(item, index) {
      return h(
        'div',
        { class: 'row', draggable: 'true', dataset: { id: item.id } },
        h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip', 16)),
        h(
          'div',
          { class: 'cell-main' },
          thumb(item),
          h('div', { class: 'cell-text' }, h('button', { type: 'button', class: 'row-title', onclick: () => edit(item) }, config.titleOf(item)), h('p', { class: 'row-sub' }, config.subtitleOf(item)))
        ),
        config.columns.map((column) => h('div', { class: `cell ${column.className || ''}` }, column.render(item))),
        h('div', { class: 'cell col-updated col-hide' }, h('span', { class: 'mono-sm' }, timeAgo(item.updatedAt))),
        actions(item, index, false)
      );
    }

    function card(item, index) {
      return h(
        'div',
        { class: 'card-item', draggable: 'true', dataset: { id: item.id } },
        h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip', 16)),
        thumb(item),
        h('button', { type: 'button', class: 'row-title', onclick: () => edit(item) }, config.titleOf(item)),
        actions(item, index, true)
      );
    }

    function render() {
      root.replaceChildren();
      const addButton = btn(config.addLabel, { variant: 'primary', iconName: 'plus', onClick: () => edit(null) });
      root.append(pageHeader({ title: config.title, description: `${plural(list().length, config.noun)}. ${config.description}`, actions: addButton }));

      if (!list().length) {
        root.append(emptyState({ iconName: config.icon, title: config.emptyTitle, text: config.emptyText, action: btn(config.addLabel, { variant: 'primary', iconName: 'plus', onClick: () => edit(null) }) }));
        return;
      }

      const entries = list();
      if (config.layout === 'cards') {
        const grid = h('div', { class: 'card-grid' }, entries.map(card));
        makeSortable(grid, { itemSelector: '.card-item', orientation: 'horizontal', onMove: move });
        root.append(grid);
        return;
      }

      const rows = h('div', { class: 'rows', role: 'list' });
      rows.style.setProperty('--cols', config.columnsTemplate);
      rows.append(
        h(
          'div',
          { class: 'row row-head', 'aria-hidden': 'true' },
          h('span', {}),
          h('span', {}, config.noun[0].toUpperCase() + config.noun.slice(1)),
          config.columns.map((column) => h('span', { class: column.className || '' }, column.label)),
          h('span', { class: 'col-updated col-hide' }, 'Updated'),
          h('span', {})
        )
      );
      const body = h('div', { class: 'rows-body' }, entries.map(tableRow));
      makeSortable(body, { itemSelector: '.row', orientation: 'vertical', onMove: move });
      rows.append(body);
      root.append(rows);
    }

    render();
    if (context.params[0] === 'new') {
      history.replaceState(null, '', `#/${config.route}`);
      queueMicrotask(() => edit(null));
    }
    return { el: root };
  };
}
