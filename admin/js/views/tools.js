import { h, uid } from '../dom.js';
import { textField } from '../ui.js';
import { imageField } from '../picker.js';
import { LIMITS } from '../validators.js';
import { createCollectionView, checkFields } from './collection.js';

function toolForm(item) {
  const name = textField({ label: 'Tool name', value: item.name, required: true, max: LIMITS.toolName });
  const logo = imageField({ label: 'Logo', value: item.logo, hint: 'Square logos work best. SVG, PNG, JPG and WebP files already in images/ can be selected.' });
  const fields = [name, logo];
  return {
    el: h('div', { class: 'form-grid' }, name.el, logo.el),
    check: () => checkFields(fields),
    values: () => ({ name: name.get(), logo: logo.get() })
  };
}

export const toolsView = createCollectionView({
  key: 'tools',
  route: 'tools',
  title: 'Tools and technologies',
  noun: 'tool',
  icon: 'wrench',
  description: 'Shown in the About section. Drag cards or use the arrows to reorder.',
  addLabel: 'Add tool',
  addDescription: 'Add a technology you work with.',
  emptyTitle: 'No tools yet',
  emptyText: 'Add the languages and tools you work with. They appear next to your About section.',
  layout: 'cards',
  titleOf: (item) => item.name,
  imageOf: (item) => item.logo,
  newItem: () => ({ id: uid('tool'), name: '', logo: '' }),
  form: toolForm
});
