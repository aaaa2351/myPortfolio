import { h, $ } from './dom.js';
import { icon } from './icons.js';

let counter = 0;
const nextId = (prefix) => `${prefix}${++counter}`;

export function btn(label, options = {}) {
  const { variant = 'secondary', iconName, onClick, type = 'button', small = false, title, disabled = false, ariaLabel } = options;
  return h(
    'button',
    {
      type,
      class: `btn btn-${variant}${small ? ' btn-sm' : ''}${label ? '' : ' btn-icon'}`,
      title,
      disabled,
      'aria-label': ariaLabel || (label ? null : title),
      onclick: onClick
    },
    iconName && icon(iconName, small ? 16 : 18),
    label && h('span', {}, label)
  );
}

export function iconButton(iconName, label, onClick, options = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: `btn btn-ghost btn-icon btn-sm${options.danger ? ' is-danger' : ''}`,
      title: label,
      'aria-label': label,
      disabled: options.disabled,
      onclick: onClick
    },
    icon(iconName, 16)
  );
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  button.setAttribute('aria-busy', String(busy));
}

export function toast(message, options = {}) {
  const { kind = 'info', action, timeout = 5200 } = options;
  const host = $('#toasts');
  const iconName = kind === 'success' ? 'checkCircle' : kind === 'error' ? 'alert' : 'info';
  const node = h(
    'div',
    { class: `toast toast-${kind}` },
    icon(iconName, 18),
    h('span', { class: 'toast-text' }, message),
    action && h('button', { type: 'button', class: 'toast-action', onclick: () => { action.onClick(); dismiss(); } }, action.label),
    h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', onclick: () => dismiss() }, icon('x', 14))
  );
  function dismiss() {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 160);
  }
  host.append(node);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (timeout) setTimeout(dismiss, kind === 'error' ? Math.max(timeout, 8000) : timeout);
  return dismiss;
}

export function openModal({ title, description, body, footer, size = 'md', onClose }) {
  const titleId = nextId('modal-title');
  const dialog = h('dialog', { class: `modal modal-${size}`, 'aria-labelledby': titleId });
  const inner = h(
    'div',
    { class: 'modal-inner' },
    h(
      'header',
      { class: 'modal-head' },
      h('div', {}, h('h2', { id: titleId }, title), description && h('p', { class: 'muted' }, description)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('x', 18))
    ),
    h('div', { class: 'modal-body' }, body),
    footer && h('footer', { class: 'modal-foot' }, footer)
  );
  dialog.append(inner);

  let pressedOnBackdrop = false;
  dialog.addEventListener('mousedown', (event) => {
    pressedOnBackdrop = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && pressedOnBackdrop) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (onClose) onClose();
  });

  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close: () => dialog.close(), body: inner.querySelector('.modal-body') };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, detail }) {
  return new Promise((resolve) => {
    let answer = false;
    const confirmButton = btn(confirmLabel, { variant: danger ? 'danger' : 'primary', onClick: () => { answer = true; modal.close(); } });
    const modal = openModal({
      title,
      size: 'sm',
      body: [h('p', { class: 'confirm-text' }, message), detail && h('p', { class: 'muted confirm-detail' }, detail)],
      footer: [btn('Cancel', { variant: 'ghost', onClick: () => modal.close() }), confirmButton],
      onClose: () => resolve(answer)
    });
    confirmButton.focus();
  });
}

export function confirmTyped({ title, message, expected, confirmLabel = 'Confirm', danger = true, detail, hint }) {
  return new Promise((resolve) => {
    let answer = false;
    const input = h('input', { type: 'text', class: 'typed-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `Type ${expected} to confirm` });
    const confirmButton = btn(confirmLabel, { variant: danger ? 'danger' : 'primary', disabled: true, onClick: () => { answer = true; modal.close(); } });
    input.addEventListener('input', () => {
      confirmButton.disabled = input.value.trim() !== expected;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !confirmButton.disabled) confirmButton.click();
    });
    const modal = openModal({
      title,
      size: 'sm',
      body: [
        h('p', { class: 'confirm-text' }, message),
        detail && h('p', { class: 'muted confirm-detail' }, detail),
        h('label', { class: 'typed-label' }, hint || 'Type ', h('code', {}, expected), ' to confirm'),
        input
      ],
      footer: [btn('Cancel', { variant: 'ghost', onClick: () => modal.close() }), confirmButton],
      onClose: () => resolve(answer)
    });
    input.focus();
  });
}

export function emptyState({ iconName, title, text, action }) {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, 22)),
    h('h3', {}, title),
    h('p', { class: 'muted' }, text),
    action
  );
}

export function chip(label, tone = 'neutral') {
  return h('span', { class: `chip chip-${tone}` }, label);
}

export function pageHeader({ title, description, actions }) {
  return h(
    'header',
    { class: 'page-head' },
    h('div', {}, h('h1', {}, title), description && h('p', { class: 'muted' }, description)),
    actions && h('div', { class: 'page-actions' }, actions)
  );
}

export function panel({ title, description, body, actions, id }) {
  return h(
    'section',
    { class: 'panel', id },
    (title || actions) &&
      h(
        'header',
        { class: 'panel-head' },
        h('div', {}, title && h('h2', {}, title), description && h('p', { class: 'muted' }, description)),
        actions && h('div', { class: 'panel-actions' }, actions)
      ),
    h('div', { class: 'panel-body' }, body)
  );
}

export function textField(options) {
  const { label, value = '', hint, required = false, max, multiline = false, rows = 3, placeholder = '', mono = false, list, type = 'text', validate, onInput, span = false, hideLabel = false } = options;
  const id = nextId('field');
  const input = multiline
    ? h('textarea', { id, rows, placeholder })
    : h('input', { id, type, placeholder, autocomplete: 'off', spellcheck: mono ? 'false' : null, list });
  input.value = value;
  if (mono) input.classList.add('mono');

  const hintEl = hint ? h('p', { class: 'field-hint', id: `${id}-hint` }, hint) : null;
  const error = h('p', { class: 'field-error', id: `${id}-error`, hidden: true });
  const counter = max ? h('span', { class: 'counter' }) : null;
  input.setAttribute('aria-describedby', [hintEl && `${id}-hint`, `${id}-error`].filter(Boolean).join(' '));

  const el = h(
    'div',
    { class: `field${span ? ' span-2' : ''}` },
    h('div', { class: `field-top${hideLabel ? ' visually-hidden' : ''}` }, h('label', { for: id }, label, required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), counter),
    input,
    hintEl,
    error
  );

  function setError(message) {
    error.textContent = message || '';
    error.hidden = !message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    el.classList.toggle('has-error', Boolean(message));
  }

  function check() {
    const trimmed = input.value.trim();
    let message = '';
    if (required && !trimmed) message = `${label} is required.`;
    else if (max && input.value.length > max) message = `${label} must be ${max} characters or fewer.`;
    else if (validate) message = validate(trimmed) || '';
    setError(message);
    return !message;
  }

  function updateCounter() {
    if (!counter) return;
    counter.textContent = `${input.value.length}/${max}`;
    counter.classList.toggle('over', input.value.length > max);
  }

  input.addEventListener('input', () => {
    updateCounter();
    if (el.classList.contains('has-error')) check();
    if (onInput) onInput(input.value);
  });
  input.addEventListener('blur', check);
  updateCounter();

  return {
    el,
    input,
    get: () => input.value.trim(),
    set(next) {
      input.value = next;
      updateCounter();
    },
    check,
    setError,
    focus: () => input.focus()
  };
}

export function selectField({ label, options, value, onChange, hint, span = false, hideLabel = false }) {
  const id = nextId('field');
  const input = h(
    'select',
    { id },
    options.map((option) => h('option', { value: option.value }, option.label))
  );
  input.value = value;
  input.addEventListener('change', () => onChange && onChange(input.value));
  const el = h(
    'div',
    { class: `field${span ? ' span-2' : ''}` },
    h('div', { class: `field-top${hideLabel ? ' visually-hidden' : ''}` }, h('label', { for: id }, label)),
    h('div', { class: 'select-wrap' }, input, icon('chevron', 16)),
    hint && h('p', { class: 'field-hint' }, hint)
  );
  return { el, input, get: () => input.value, set: (next) => { input.value = next; } };
}

export function switchField({ label, hint, checked, onChange }) {
  const id = nextId('field');
  const input = h('input', { id, type: 'checkbox', role: 'switch' });
  input.checked = checked;
  input.addEventListener('change', () => onChange && onChange(input.checked));
  const el = h(
    'label',
    { class: 'switch-row', for: id },
    h('span', { class: 'switch-text' }, h('strong', {}, label), hint && h('small', {}, hint)),
    h('span', { class: 'switch' }, input, h('span', { class: 'switch-track' }))
  );
  return { el, input, get: () => input.checked };
}

export function segmented({ options, value, onChange, label }) {
  const group = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  function paint(current) {
    group.replaceChildren(
      ...options.map((option) =>
        h(
          'button',
          {
            type: 'button',
            class: 'segment',
            'aria-pressed': String(option.value === current),
            title: option.title,
            onclick: () => {
              paint(option.value);
              onChange(option.value);
            }
          },
          option.icon && icon(option.icon, 16),
          option.label && h('span', {}, option.label)
        )
      )
    );
  }
  paint(value);
  return group;
}

export function flashItem(root, id) {
  const node = root.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!node) return;
  node.classList.add('flash');
  node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  setTimeout(() => node.classList.remove('flash'), 1400);
}
