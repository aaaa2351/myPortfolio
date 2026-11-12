import { h } from '../dom.js';
import { pageHeader, panel } from '../ui.js';
import { targetRule } from '../validators.js';
import { boundText, boundImage, boundSwitch } from './bind.js';

const TARGET_HINT = 'A section such as #projects, a full link, or a mailto: link.';

export function homepageView() {
  const root = h('div', { class: 'page' });

  const pageTitle = boundText('site.pageTitle', { label: 'Page title', required: true, max: 70, hint: 'Shown in the browser tab.' });
  const metaDescription = boundText('site.metaDescription', { label: 'Meta description', required: true, max: 300, multiline: true, rows: 3, span: true, hint: 'Search engines usually show the first 155 characters or so.' });
  const navName = boundText('site.navName', { label: 'Navigation name', required: true, max: 60, hint: 'The name at the top left of the site.' });
  const navLabel = boundText('site.navButton.label', { label: 'Button text', required: true, max: 40 });
  const navTarget = boundText('site.navButton.target', { label: 'Button destination', required: true, mono: true, list: 'link-targets', validate: targetRule, hint: TARGET_HINT });

  let highlight;
  const heading = boundText('hero.heading', {
    label: 'Heading',
    required: true,
    max: 120,
    span: true,
    onInput: () => {
      if (highlight && highlight.get()) highlight.check();
    }
  });
  highlight = boundText('hero.highlight', {
    label: 'Highlighted word',
    max: 60,
    hint: 'Must match part of the heading exactly. It is shown in the accent colour.',
    validate: (value) => (value && !heading.get().includes(value) ? 'This text is not in the heading.' : '')
  });
  const description = boundText('hero.description', { label: 'Description', required: true, max: 300, multiline: true, rows: 3, span: true });
  const image = boundImage('hero.image', { label: 'Hero image', hint: 'Shown beside the heading. Landscape images around 1000 \u00d7 800 work best.', wide: true });
  const imageAlt = boundText('hero.imageAlt', { label: 'Image description', max: 120, hint: 'Read aloud by screen readers.', span: true });
  const available = boundSwitch('hero.available', { label: 'Available for work', hint: 'Turns the status dot green. When off it turns grey.' });
  const statusText = boundText('hero.statusText', { label: 'Availability text', max: 60, hint: 'Leave empty to hide the badge.' });
  const primaryLabel = boundText('hero.primaryButton.label', { label: 'Primary button text', required: true, max: 40 });
  const primaryTarget = boundText('hero.primaryButton.target', { label: 'Primary button destination', required: true, mono: true, list: 'link-targets', validate: targetRule, hint: TARGET_HINT });
  const secondaryLabel = boundText('hero.secondaryButton.label', { label: 'Secondary button text', required: true, max: 40 });
  const secondaryTarget = boundText('hero.secondaryButton.target', { label: 'Secondary button destination', required: true, mono: true, list: 'link-targets', validate: targetRule, hint: TARGET_HINT });

  root.append(
    pageHeader({ title: 'Homepage', description: 'Changes show in the preview straight away. Use Save changes to write them to your portfolio.' }),
    h('div', { class: 'stack' },
      panel({ title: 'Page and navigation', description: 'Browser tab, search result text and the top bar.', body: h('div', { class: 'form-grid' }, pageTitle.el, navName.el, metaDescription.el, navLabel.el, navTarget.el) }),
      panel({ title: 'Hero', description: 'The first thing visitors see.', body: h('div', { class: 'form-grid' }, heading.el, highlight.el, description.el, image.el, imageAlt.el) }),
      panel({ title: 'Availability', body: h('div', { class: 'form-grid' }, available.el, statusText.el) }),
      panel({ title: 'Hero buttons', description: 'Where each button sends visitors.', body: h('div', { class: 'form-grid' }, primaryLabel.el, primaryTarget.el, secondaryLabel.el, secondaryTarget.el) })
    )
  );

  return { el: root };
}
