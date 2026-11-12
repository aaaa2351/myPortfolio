import { h, debounce } from './dom.js';
import { icon } from './icons.js';
import { store, subscribe } from './state.js';
import { segmented } from './ui.js';

const CHANNEL = 'portfolio-cms';
const VERSION = 1;
const DEVICES = { desktop: 1280, tablet: 820, mobile: 390 };

export function createPreview({ onVisibilityChange }) {
  const origin = window.location.origin;
  let iframe = null;
  let ready = false;
  let open = false;
  let device = 'desktop';
  let focusTarget = null;

  const stage = h('div', { class: 'preview-stage' });
  const frameWrap = h('div', { class: 'preview-frame' });
  stage.append(frameWrap);

  function layout() {
    if (!iframe) return;
    const width = DEVICES[device];
    const available = stage.clientWidth - 32;
    const scale = Math.min(1, Math.max(0.2, available / width));
    const height = Math.max(200, (stage.clientHeight - 32) / scale);
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    iframe.style.transform = `scale(${scale})`;
    frameWrap.style.width = `${width * scale}px`;
    frameWrap.style.height = `${height * scale}px`;
  }

  function post(message) {
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ channel: CHANNEL, version: VERSION, ...message }, origin);
  }

  function sendContent() {
    if (ready && store.draft) post({ type: 'content', payload: store.draft });
  }

  function sendFocus() {
    if (ready && focusTarget) post({ type: 'focus', target: focusTarget });
  }

  function mountFrame() {
    ready = false;
    iframe = h('iframe', { title: 'Portfolio preview', src: '/?cms-preview=1', class: 'preview-iframe', referrerpolicy: 'same-origin' });
    frameWrap.replaceChildren(iframe);
    layout();
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== origin || !iframe || event.source !== iframe.contentWindow) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || message.channel !== CHANNEL || message.version !== VERSION) return;
    if (message.type === 'ready') {
      ready = true;
      sendContent();
      sendFocus();
    }
  });

  subscribe(debounce(() => {
    if (open) sendContent();
  }, 120));

  new ResizeObserver(layout).observe(stage);

  const deviceControl = segmented({
    label: 'Preview size',
    value: device,
    options: [
      { value: 'desktop', icon: 'monitor', title: 'Desktop width' },
      { value: 'tablet', icon: 'tablet', title: 'Tablet width' },
      { value: 'mobile', icon: 'phone', title: 'Mobile width' }
    ],
    onChange(value) {
      device = value;
      layout();
    }
  });

  const closeButton = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Close preview', onclick: () => setOpen(false) }, icon('x', 16));
  const reloadButton = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Reload preview', title: 'Reload preview', onclick: () => mountFrame() }, icon('refresh', 16));

  const el = h(
    'aside',
    { class: 'preview', 'aria-label': 'Live preview', hidden: true },
    h('header', { class: 'preview-head' }, h('div', {}, h('h2', {}, 'Live preview'), h('p', { class: 'muted' }, 'Shows unsaved changes')), h('div', { class: 'preview-tools' }, deviceControl, reloadButton, closeButton)),
    stage
  );

  function setOpen(next) {
    open = next;
    el.hidden = !next;
    if (next && !iframe) mountFrame();
    if (next) requestAnimationFrame(layout);
    if (onVisibilityChange) onVisibilityChange(next);
  }

  return {
    el,
    toggle: () => setOpen(!open),
    isOpen: () => open,
    focus(target) {
      focusTarget = target;
      sendFocus();
    }
  };
}
