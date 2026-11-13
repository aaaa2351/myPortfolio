import { h, formatBytes, formatDate } from '../dom.js';
import { store } from '../state.js';
import { api } from '../api.js';
import { pageHeader, btn, openModal, toast, emptyState, segmented, setBusy, confirmDialog } from '../ui.js';
import { getImages, imageTile, imageSrc, uploadFiles, pickFiles } from '../picker.js';

function usageOf(imagePath) {
  const d = store.draft;
  const uses = [];
  if (d.hero.image === imagePath) uses.push({ label: 'Hero image', route: 'homepage' });
  if (d.profile.image === imagePath) uses.push({ label: 'Profile image', route: 'profile' });
  if (d.contact.bannerImage === imagePath) uses.push({ label: 'Contact banner', route: 'profile' });
  d.projectList.forEach((item) => item.imageSrc === imagePath && uses.push({ label: `Project: ${item.name}`, route: 'projects' }));
  d.tools.forEach((item) => item.logo === imagePath && uses.push({ label: `Tool: ${item.name}`, route: 'tools' }));
  d.wds.forEach((item) => item.logo === imagePath && uses.push({ label: `Service: ${item.title}`, route: 'services' }));
  return uses;
}

function detail(image, onChange) {
  const uses = usageOf(image.path);
  const copyButton = btn('Copy path', {
    iconName: 'copy',
    small: true,
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(image.path);
        toast('Path copied', { kind: 'success', timeout: 2000 });
      } catch {
        toast('Copy is not available here. Select the path and copy it manually.', { kind: 'error' });
      }
    }
  });
  const modal = openModal({
    title: image.name,
    size: 'md',
    body: h(
      'div',
      { class: 'image-detail' },
      h('div', { class: 'image-detail-preview' }, h('img', { src: imageSrc(image.path), alt: '' })),
      h(
        'dl',
        { class: 'meta-list' },
        h('div', {}, h('dt', {}, 'Path'), h('dd', { class: 'mono-sm' }, image.path)),
        h('div', {}, h('dt', {}, 'Size'), h('dd', {}, formatBytes(image.size))),
        h('div', {}, h('dt', {}, 'Modified'), h('dd', {}, formatDate(image.modifiedAt, true))),
        h('div', {}, h('dt', {}, 'Used in'), h('dd', {}, uses.length ? h('ul', { class: 'plain-list' }, uses.map((use) => h('li', {}, h('a', { class: 'link', href: `#/${use.route}`, onclick: () => modal.close() }, use.label)))) : 'Not used by the current draft'))
      )
    ),
    footer: [
      image.deletable
        ? btn('Delete', {
            variant: 'danger',
            iconName: 'trash',
            small: true,
            disabled: uses.length > 0,
            title: uses.length ? 'Remove it from the draft first' : 'Delete this uploaded image',
            onClick: async () => {
              const ok = await confirmDialog({ title: 'Delete this image?', message: `${image.name} will be removed from storage permanently.`, detail: 'It is refused if the live site or the draft still uses it.', confirmLabel: 'Delete image', danger: true });
              if (!ok) return;
              try {
                await api.removeImage(image.id);
                modal.close();
                toast('Image deleted.', { kind: 'success' });
                if (onChange) onChange();
              } catch (error) {
                toast(error.message, { kind: 'error' });
              }
            }
          })
        : null,
      copyButton,
      btn('Close', { variant: 'primary', onClick: () => modal.close() })
    ]
  });
}

export function imagesView() {
  const root = h('div', { class: 'page' });
  let filter = 'all';
  let query = '';
  let images = [];
  const grid = h('div', { class: 'tile-grid tile-grid-lg' });
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search images', 'aria-label': 'Search images' });

  const uploadButton = btn('Upload images', {
    variant: 'primary',
    iconName: 'upload',
    onClick: async () => {
      setBusy(uploadButton, true);
      const uploaded = await uploadFiles(await pickFiles(true));
      setBusy(uploadButton, false);
      if (uploaded.length) load(true);
    }
  });

  function paint() {
    const visible = images.filter((image) => {
      if (filter === 'uploaded' && !image.uploaded) return false;
      if (filter === 'site' && image.uploaded) return false;
      return !query || image.path.toLowerCase().includes(query);
    });
    if (!visible.length) {
      grid.replaceChildren(
        emptyState({
          iconName: 'image',
          title: images.length ? 'No matching images' : 'No images yet',
          text: images.length ? 'Try a different search or filter.' : 'Use Upload images above. Files committed to public/images in the repository are listed too.'
        })
      );
      return;
    }
    grid.replaceChildren(
      ...visible.map((image) => {
        const uses = usageOf(image.path).length;
        return imageTile(image, { onClick: () => detail(image, () => load(true)), meta: `${formatBytes(image.size)} \u00b7 ${uses ? `used ${uses}\u00d7` : 'unused'}` });
      })
    );
  }

  async function load(force) {
    try {
      images = await getImages(force);
      paint();
    } catch (error) {
      grid.replaceChildren(h('p', { class: 'field-error' }, error.message));
    }
  }

  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    paint();
  });

  root.addEventListener('dragover', (event) => {
    if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
  });
  root.addEventListener('drop', async (event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    const uploaded = await uploadFiles([...event.dataTransfer.files]);
    if (uploaded.length) load(true);
  });

  root.append(
    pageHeader({ title: 'Images', description: 'Everything in public/images. Uploads go to public/images/uploads with a unique, safe filename. Drop files anywhere on this page to upload.', actions: uploadButton }),
    h(
      'div',
      { class: 'toolbar' },
      search,
      segmented({
        label: 'Filter images',
        value: filter,
        options: [
          { value: 'all', label: 'All' },
          { value: 'site', label: 'Site assets' },
          { value: 'uploaded', label: 'Uploaded' }
        ],
        onChange(value) {
          filter = value;
          paint();
        }
      })
    ),
    grid
  );

  load(true);
  return { el: root };
}
