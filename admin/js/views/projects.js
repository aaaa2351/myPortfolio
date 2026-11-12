import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { textField, chip } from '../ui.js';
import { imageField } from '../picker.js';
import { LIMITS, optionalUrl } from '../validators.js';
import { createCollectionView, checkFields } from './collection.js';

const TYPES = ['Web App', 'Website', 'Mobile App', 'Open Source', 'Design', '3D Asset', 'Tool'];

function projectForm(item) {
  const name = textField({ label: 'Project name', value: item.name, required: true, max: LIMITS.projectName });
  const type = textField({ label: 'Type', value: item.appType, required: true, max: LIMITS.projectType, list: 'project-types', hint: 'Shown as the label on the project card.' });
  const description = textField({ label: 'Description', value: item.description, required: true, max: LIMITS.projectDescription, multiline: true, rows: 3, span: true });
  const live = textField({ label: 'Live URL', value: item.liveUrl, validate: optionalUrl, mono: true, placeholder: 'https://example.com', hint: 'The arrow on the card links here.' });
  const github = textField({ label: 'GitHub URL', value: item.githubUrl, validate: optionalUrl, mono: true, placeholder: 'https://github.com/you/repo', hint: 'Optional. Adds a GitHub icon to the card.' });
  const image = imageField({ label: 'Project image', value: item.imageSrc, hint: 'Landscape images around 600 \u00d7 400 work best.', wide: true });
  const fields = [name, type, description, live, github, image];

  return {
    el: h('div', { class: 'form-grid' }, h('datalist', { id: 'project-types' }, TYPES.map((value) => h('option', { value }))), name.el, type.el, description.el, live.el, github.el, image.el),
    check: () => checkFields(fields),
    values: () => ({ name: name.get(), appType: type.get(), description: description.get(), liveUrl: live.get(), githubUrl: github.get(), imageSrc: image.get() })
  };
}

function linkIcon(href, iconName, label) {
  return h('a', { class: 'link-icon', href, target: '_blank', rel: 'noopener noreferrer', title: label, 'aria-label': label }, icon(iconName, 16));
}

export const projectsView = createCollectionView({
  key: 'projectList',
  route: 'projects',
  title: 'Projects',
  noun: 'project',
  icon: 'layers',
  description: 'Drag to reorder. The order here is the order on your homepage.',
  addLabel: 'Add project',
  addDescription: 'Fill in the details shown on the homepage project card.',
  emptyTitle: 'No projects yet',
  emptyText: 'Add your first project to show it in the projects section of your portfolio.',
  layout: 'table',
  columnsTemplate: '24px minmax(0, 1fr) 104px 84px 92px auto',
  titleOf: (item) => item.name,
  subtitleOf: (item) => item.description,
  imageOf: (item) => item.imageSrc,
  newItem: () => ({ id: uid('project'), name: '', imageSrc: '', description: '', appType: 'Web App', liveUrl: '', githubUrl: '' }),
  columns: [
    { label: 'Type', className: 'col-type col-hide', render: (item) => chip(item.appType || 'None') },
    {
      label: 'Links',
      className: 'col-links col-hide',
      render: (item) => h('span', { class: 'link-icons' }, item.liveUrl ? linkIcon(item.liveUrl, 'globe', 'Open live site') : h('span', { class: 'muted-dash' }, 'None'), item.githubUrl && linkIcon(item.githubUrl, 'github', 'Open GitHub repository'))
    }
  ],
  form: projectForm
});
