import { h, uid, plural } from '../dom.js';
import { store, update } from '../state.js';
import { pageHeader, panel, textField, selectField, btn, iconButton, confirmDialog } from '../ui.js';
import { optionalUrl, emailRule } from '../validators.js';
import { moveItem } from '../sortable.js';
import { boundText, boundImage } from './bind.js';

const PLATFORMS = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'github', label: 'GitHub' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'x', label: 'X' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'dribbble', label: 'Dribbble' },
  { value: 'behance', label: 'Behance' }
];

function socialsBody() {
  const holder = h('div', { class: 'social-list' });

  function render() {
    const socials = store.draft.socials;
    holder.replaceChildren(
      ...socials.map((social, index) => {
        const platform = selectField({
          label: 'Platform',
          hideLabel: true,
          options: PLATFORMS,
          value: social.platform,
          onChange: (value) => update((draft) => { draft.socials[index].platform = value; })
        });
        const url = textField({
          label: `${PLATFORMS.find((item) => item.value === social.platform)?.label || 'Social'} profile URL`,
          hideLabel: true,
          value: social.url,
          mono: true,
          placeholder: 'https://',
          validate: optionalUrl,
          onInput: (value) => update((draft) => { draft.socials[index].url = value.trim(); })
        });
        return h(
          'div',
          { class: 'social-row', dataset: { id: social.id } },
          platform.el,
          url.el,
          h(
            'div',
            { class: 'row-actions' },
            iconButton('up', 'Move up', () => { update((draft) => moveItem(draft.socials, index, index - 1)); render(); }, { disabled: index === 0 }),
            iconButton('down', 'Move down', () => { update((draft) => moveItem(draft.socials, index, index + 1)); render(); }, { disabled: index === socials.length - 1 }),
            iconButton('trash', 'Remove link', async () => {
              const ok = await confirmDialog({
                title: 'Remove social link?',
                message: `The ${PLATFORMS.find((item) => item.value === social.platform)?.label || ''} link will be removed from your draft.`,
                confirmLabel: 'Remove link',
                danger: true
              });
              if (!ok) return;
              update((draft) => { draft.socials.splice(index, 1); });
              render();
            }, { danger: true })
          )
        );
      }),
      socials.length < 12 &&
        btn('Add social link', {
          iconName: 'plus',
          small: true,
          onClick: () => {
            const used = new Set(store.draft.socials.map((item) => item.platform));
            const next = PLATFORMS.find((item) => !used.has(item.value)) || PLATFORMS[0];
            update((draft) => { draft.socials.push({ id: uid('social'), platform: next.value, url: '' }); });
            render();
          }
        })
    );
  }

  render();
  return holder;
}

export function profileView() {
  const root = h('div', { class: 'page' });

  const name = boundText('profile.name', { label: 'Name', required: true, max: 60, hint: 'Shown in the About heading.' });
  const aboutHeading = boundText('profile.aboutHeading', { label: 'About heading lead-in', max: 60, hint: 'Appears before your name, for example \u201cI am\u201d.' });
  const aboutDescription = boundText('profile.aboutDescription', { label: 'About description', required: true, max: 800, multiline: true, rows: 5, span: true });
  const profileImage = boundImage('profile.image', { label: 'Profile image', hint: 'Portrait images (4:5) fit the About layout best.' });
  const profileAlt = boundText('profile.imageAlt', { label: 'Image description', max: 120, span: true });

  const contactTag = boundText('contact.tag', { label: 'Section label', max: 40 });
  let contactHighlight;
  const contactHeading = boundText('contact.heading', {
    label: 'Heading',
    required: true,
    max: 120,
    span: true,
    onInput: () => {
      if (contactHighlight && contactHighlight.get()) contactHighlight.check();
    }
  });
  contactHighlight = boundText('contact.highlight', {
    label: 'Highlighted text',
    max: 60,
    hint: 'Must match part of the heading exactly.',
    validate: (value) => (value && !contactHeading.get().includes(value) ? 'This text is not in the heading.' : '')
  });
  const contactText = boundText('contact.text', { label: 'Text', max: 300, multiline: true, rows: 3, span: true, hint: 'A new line becomes a line break on the site.' });
  const email = boundText('contact.email', { label: 'Contact email', required: true, max: 254, mono: true, validate: emailRule });
  const buttonLabel = boundText('contact.buttonLabel', { label: 'Email button text', required: true, max: 40 });
  const banner = boundImage('contact.bannerImage', { label: 'Contact banner image', wide: true });

  const brand = boundText('footer.brandName', { label: 'Footer brand name', required: true, max: 60 });
  const roles = textField({
    label: 'Roles',
    value: store.draft.footer.roles.join(', '),
    hint: 'Separate with commas. Up to 6.',
    validate: (value) => (value.split(',').filter((item) => item.trim()).length > 6 ? 'Use 6 roles or fewer.' : ''),
    onInput: (value) => update((draft) => { draft.footer.roles = value.split(',').map((item) => item.trim()).filter(Boolean); })
  });
  const copyright = boundText('footer.copyright', { label: 'Copyright text', required: true, max: 160, span: true });

  root.append(
    pageHeader({ title: 'Profile and contact', description: 'Your About section, contact banner, social links and footer.' }),
    h('div', { class: 'stack' },
      panel({ title: 'Profile', description: 'The About section.', body: h('div', { class: 'form-grid' }, name.el, aboutHeading.el, aboutDescription.el, profileImage.el, profileAlt.el) }),
      panel({ title: 'Contact banner', description: 'The call to action above the footer.', body: h('div', { class: 'form-grid' }, contactTag.el, contactHeading.el, contactHighlight.el, contactText.el, email.el, buttonLabel.el, banner.el) }),
      panel({ title: 'Social links', description: `${plural(store.draft.socials.length, 'link')}. Links without a URL stay on the page but go nowhere.`, body: socialsBody() }),
      panel({ title: 'Footer', body: h('div', { class: 'form-grid' }, brand.el, roles.el, copyright.el) })
    )
  );

  return { el: root };
}
