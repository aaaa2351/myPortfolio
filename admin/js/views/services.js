import { h, uid } from '../dom.js';
import { textField } from '../ui.js';
import { imageField } from '../picker.js';
import { LIMITS } from '../validators.js';
import { createCollectionView, checkFields } from './collection.js';

function serviceForm(item) {
  const title = textField({ label: 'Title', value: item.title, required: true, max: LIMITS.serviceTitle, span: true });
  const description = textField({ label: 'Description', value: item.description, required: true, max: LIMITS.serviceDescription, multiline: true, rows: 3, span: true });
  const logo = imageField({ label: 'Icon', value: item.logo, hint: 'A simple square icon. SVG files in images/wds already match the current design.' });
  const fields = [title, description, logo];
  return {
    el: h('div', { class: 'form-grid' }, title.el, description.el, logo.el),
    check: () => checkFields(fields),
    values: () => ({ title: title.get(), description: description.get(), logo: logo.get() })
  };
}

export const servicesView = createCollectionView({
  key: 'wds',
  route: 'services',
  title: 'Services',
  noun: 'service',
  icon: 'briefcase',
  description: 'Shown in the \u201cWhat I do\u201d section. Drag to reorder.',
  addLabel: 'Add service',
  addDescription: 'Describe something you offer.',
  emptyTitle: 'No services yet',
  emptyText: 'Add the kinds of work you do. They appear in the \u201cWhat I do\u201d section.',
  layout: 'table',
  columnsTemplate: '24px minmax(0, 1fr) 92px auto',
  columns: [],
  titleOf: (item) => item.title,
  subtitleOf: (item) => item.description,
  imageOf: (item) => item.logo,
  newItem: () => ({ id: uid('service'), logo: '', title: '', description: '' }),
  form: serviceForm
});
