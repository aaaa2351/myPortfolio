import { h, formatBytes } from './dom.js';
import { api } from './api.js';
import { store } from './state.js';
import { btn, openModal, toast, segmented, setBusy } from './ui.js';
import { imageRule } from './validators.js';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;
let cache = null;

export function imageSrc(reference) {
  if (!reference) return '';
  if (/^https?:\/\//i.test(reference)) return reference;
  return `/${reference.replace(/^\/+/, '')}`;
}

export async function getImages(force = false) {
  if (!cache || force) cache = (await api.images()).images;
  return cache;
}

function remember(image) {
  const entry = { ...image, folder: image.folder || 'uploads', modifiedAt: image.modifiedAt || new Date().toISOString() };
  cache = [entry, ...(cache || []).filter((item) => item.path !== image.path)];
}

export function fileProblem(file) {
  const max = (store.session && store.session.maxUploadBytes) || 4 * 1024 * 1024;
  if (!ALLOWED_EXT.test(file.name) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return `${file.name}: only JPG, PNG and WebP images can be uploaded.`;
  }
  if (file.size > max) return `${file.name}: images must be ${formatBytes(max)} or smaller (this one is ${formatBytes(file.size)}).`;
  return '';
}

export async function uploadFiles(files) {
  const uploaded = [];
  for (const file of files) {
    const problem = fileProblem(file);
    if (problem) {
      toast(problem, { kind: 'error' });
      continue;
    }
    try {
      const { image } = await api.upload(file);
      remember(image);
      uploaded.push(image);
    } catch (error) {
      toast(`${file.name}: ${error.message}`, { kind: 'error' });
    }
  }
  if (uploaded.length) toast(uploaded.length === 1 ? `Uploaded ${uploaded[0].name}` : `Uploaded ${uploaded.length} images`, { kind: 'success' });
  return uploaded;
}

export function pickFiles(multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: ACCEPT, multiple, class: 'visually-hidden', tabindex: '-1' });
    input.addEventListener('change', () => {
      resolve([...input.files]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function imageTile(image, { selected = false, onClick, onDoubleClick, meta } = {}) {
  const thumb = h('img', { src: imageSrc(image.path), alt: '', loading: 'lazy', draggable: 'false' });
  const tile = h(
    'button',
    { type: 'button', class: 'tile', 'aria-pressed': String(selected), dataset: { path: image.path }, onclick: onClick, ondblclick: onDoubleClick },
    h('span', { class: 'tile-thumb' }, thumb),
    h('span', { class: 'tile-name' }, image.name),
    h('span', { class: 'tile-meta' }, meta || formatBytes(image.size))
  );
  thumb.addEventListener('error', () => tile.querySelector('.tile-thumb').classList.add('is-missing'));
  return tile;
}

export function chooseImage({ current = '' } = {}) {
  return new Promise((resolve) => {
    let selected = current;
    let filter = 'all';
    let query = '';
    let result = null;
    const grid = h('div', { class: 'tile-grid' });
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Search images', 'aria-label': 'Search images' });
    const useButton = btn('Use image', { variant: 'primary', disabled: !selected, onClick: () => { result = selected; modal.close(); } });
    const uploadButton = btn('Upload', { iconName: 'upload', onClick: async () => {
      setBusy(uploadButton, true);
      const uploaded = await uploadFiles(await pickFiles(true));
      setBusy(uploadButton, false);
      if (uploaded.length) {
        selected = uploaded[0].path;
        paint();
      }
    } });

    async function paint() {
      let images;
      try {
        images = await getImages();
      } catch (error) {
        grid.replaceChildren(h('p', { class: 'field-error' }, error.message));
        return;
      }
      const visible = images.filter((image) => {
        if (filter === 'uploaded' && !image.uploaded) return false;
        if (filter === 'site' && image.uploaded) return false;
        return !query || image.path.toLowerCase().includes(query);
      });
      useButton.disabled = !selected;
      if (!visible.length) {
        grid.replaceChildren(
          h('div', { class: 'tile-empty' }, h('p', {}, images.length ? 'No images match this filter.' : 'No images in public/images yet. Upload one, or copy your existing images folder into public/images.'))
        );
        return;
      }
      grid.replaceChildren(
        ...visible.map((image) =>
          imageTile(image, {
            selected: image.path === selected,
            onClick: () => {
              selected = image.path;
              paint();
            },
            onDoubleClick: () => {
              result = image.path;
              modal.close();
            }
          })
        )
      );
    }

    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      paint();
    });

    const filters = segmented({
      label: 'Filter images',
      value: 'all',
      options: [
        { value: 'all', label: 'All' },
        { value: 'site', label: 'Site assets' },
        { value: 'uploaded', label: 'Uploaded' }
      ],
      onChange(value) {
        filter = value;
        paint();
      }
    });

    const body = h(
      'div',
      { class: 'picker' },
      h('div', { class: 'picker-bar' }, search, filters, uploadButton),
      grid,
      h('p', { class: 'field-hint' }, 'JPG, PNG or WebP up to 5 MB. Drop files anywhere in this window to upload.')
    );

    const modal = openModal({
      title: 'Choose an image',
      description: 'Images from public/images. Uploads are saved with a unique, safe filename.',
      size: 'lg',
      body,
      footer: [btn('Cancel', { variant: 'ghost', onClick: () => modal.close() }), useButton],
      onClose: () => resolve(result)
    });

    modal.dialog.addEventListener('dragover', (event) => {
      if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
    });
    modal.dialog.addEventListener('drop', async (event) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      const uploaded = await uploadFiles([...event.dataTransfer.files]);
      if (uploaded.length) {
        selected = uploaded[0].path;
        paint();
      }
    });

    paint();
  });
}

export function imageField({ label, value = '', required = true, hint, onChange, wide = false }) {
  let current = value;
  const img = h('img', { alt: '', draggable: 'false' });
  const previewBox = h('div', { class: `thumb-box${wide ? ' is-wide' : ''}` });
  const note = h('span', { class: 'thumb-note' });
  const pathInput = h('input', { type: 'text', class: 'mono', 'aria-label': `${label} path or URL`, placeholder: 'images/example.jpg', spellcheck: 'false', autocomplete: 'off' });
  const error = h('p', { class: 'field-error', hidden: true });
  const chooseButton = btn('Choose image', { iconName: 'image', small: true, onClick: async () => {
    const picked = await chooseImage({ current });
    if (picked) apply(picked);
  } });
  const uploadButton = btn('Upload', { iconName: 'upload', small: true, onClick: async () => {
    setBusy(uploadButton, true);
    const uploaded = await uploadFiles(await pickFiles(false));
    setBusy(uploadButton, false);
    if (uploaded.length) apply(uploaded[0].path);
  } });

  function paint() {
    previewBox.classList.remove('is-missing', 'is-empty');
    previewBox.replaceChildren(img, note);
    if (!current) {
      previewBox.classList.add('is-empty');
      note.textContent = 'No image selected';
      img.removeAttribute('src');
      return;
    }
    note.textContent = '';
    img.src = imageSrc(current);
  }

  img.addEventListener('error', () => {
    if (!current) return;
    previewBox.classList.add('is-missing');
    note.textContent = /^https?:/i.test(current) ? 'Could not load this URL' : 'File not found in public/';
  });

  function check() {
    const trimmed = current.trim();
    const message = !trimmed && required ? `${label} is required.` : imageRule(trimmed);
    error.textContent = message;
    error.hidden = !message;
    return !message;
  }

  function apply(next, notify = true) {
    current = next.trim();
    pathInput.value = current;
    paint();
    check();
    if (notify && onChange) onChange(current);
  }

  pathInput.value = current;
  pathInput.addEventListener('change', () => apply(pathInput.value));
  paint();

  const el = h(
    'div',
    { class: 'field image-field span-2' },
    h('div', { class: 'field-top' }, h('span', { class: 'label' }, label, required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'))),
    h(
      'div',
      { class: 'image-field-body' },
      previewBox,
      h('div', { class: 'image-field-controls' }, h('div', { class: 'btn-row' }, chooseButton, uploadButton), pathInput, hint && h('p', { class: 'field-hint' }, hint), error)
    )
  );

  return { el, get: () => current, set: (next) => apply(next, false), check };
}
