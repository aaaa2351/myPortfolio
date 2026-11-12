const crypto = require('crypto');

const PLATFORMS = ['linkedin', 'github', 'instagram', 'x', 'youtube', 'facebook', 'dribbble', 'behance'];
const LIMITS = { projects: 60, tools: 60, services: 24, socials: 12, roles: 6 };
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const HASH_TARGET_RE = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const LOCAL_IMAGE_RE = /^images\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:jpe?g|png|webp|svg)$/i;
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const SECTION_KEYS = ['site', 'hero', 'profile', 'contact', 'socials', 'footer'];

class Context {
  constructor() {
    this.errors = [];
  }

  add(path, message) {
    this.errors.push({ path, message });
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function objectAt(ctx, path, value, label) {
  if (isObject(value)) return value;
  ctx.add(path, `${label} is missing or malformed.`);
  return {};
}

function arrayAt(ctx, path, value, label, max) {
  if (!Array.isArray(value)) {
    ctx.add(path, `${label} must be a list.`);
    return [];
  }
  if (value.length > max) {
    ctx.add(path, `${label} can contain at most ${max} entries.`);
    return value.slice(0, max);
  }
  return value;
}

function text(ctx, path, value, label, options = {}) {
  const { required = false, max = 200, multiline = false } = options;
  let result = value === undefined || value === null ? '' : value;
  if (typeof result !== 'string') {
    ctx.add(path, `${label} must be text.`);
    return '';
  }
  result = result.replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  result = multiline ? result.trim() : result.replace(/\n+/g, ' ').trim();
  if (required && !result) {
    ctx.add(path, `${label} is required.`);
    return result;
  }
  if (result.length > max) ctx.add(path, `${label} must be ${max} characters or fewer.`);
  return result;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function httpUrl(ctx, path, value, label, options = {}) {
  const result = text(ctx, path, value, label, { required: options.required, max: 2048 });
  if (result && !isHttpUrl(result)) ctx.add(path, `${label} must be a full URL starting with http:// or https://.`);
  return result;
}

function linkTarget(ctx, path, value, label) {
  const result = text(ctx, path, value, label, { required: true, max: 2048 });
  if (!result) return result;
  if (HASH_TARGET_RE.test(result) || isHttpUrl(result)) return result;
  if (/^mailto:/i.test(result) && EMAIL_RE.test(result.slice(7).split('?')[0])) return result;
  ctx.add(path, `${label} must be a section like #projects, a full http(s) URL, or a mailto: link.`);
  return result;
}

function imageRef(ctx, path, value, label, options = {}) {
  const result = text(ctx, path, value, label, { required: options.required !== false, max: 2048 });
  if (!result) return result;
  if (/^https?:\/\//i.test(result)) {
    if (!isHttpUrl(result)) ctx.add(path, `${label} is not a valid image URL.`);
    return result;
  }
  if (!LOCAL_IMAGE_RE.test(result)) {
    ctx.add(path, `${label} must be a JPG, PNG, WebP or SVG file inside images/, or an http(s) URL.`);
  }
  return result;
}

function email(ctx, path, value, label) {
  const result = text(ctx, path, value, label, { required: true, max: 254 });
  if (result && !EMAIL_RE.test(result)) ctx.add(path, `${label} must be a valid email address.`);
  return result;
}

function itemId(ctx, path, value, seen, prefix) {
  let id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    id = `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
  } else if (!ID_RE.test(id)) {
    ctx.add(path, 'ID must use lowercase letters, numbers, hyphens or underscores.');
  }
  if (seen.has(id)) ctx.add(path, 'ID is used more than once.');
  seen.add(id);
  return id;
}

function isoOrEmpty(value) {
  return typeof value === 'string' && ISO_RE.test(value) ? value : '';
}

function highlightCheck(ctx, path, heading, highlight, label) {
  if (highlight && heading && !heading.includes(highlight)) {
    ctx.add(path, `${label} must appear exactly as written in the heading.`);
  }
}

function cleanMeta(value) {
  const meta = isObject(value) ? value : {};
  const sections = isObject(meta.sections) ? meta.sections : {};
  const cleaned = {};
  for (const key of SECTION_KEYS) cleaned[key] = isoOrEmpty(sections[key]);
  return { updatedAt: isoOrEmpty(meta.updatedAt), sections: cleaned };
}

function validateButton(ctx, path, value, label) {
  const source = objectAt(ctx, path, value, label);
  return {
    label: text(ctx, `${path}.label`, source.label, `${label} text`, { required: true, max: 40 }),
    target: linkTarget(ctx, `${path}.target`, source.target, `${label} destination`)
  };
}

function validateContent(input, options = {}) {
  const keepServerFields = options.keepServerFields === true;
  const ctx = new Context();
  const source = isObject(input) ? input : (ctx.add('', 'Content must be an object.'), {});

  const site = objectAt(ctx, 'site', source.site, 'Site settings');
  const hero = objectAt(ctx, 'hero', source.hero, 'Hero');
  const profile = objectAt(ctx, 'profile', source.profile, 'Profile');
  const contact = objectAt(ctx, 'contact', source.contact, 'Contact');
  const footer = objectAt(ctx, 'footer', source.footer, 'Footer');

  const value = {
    schemaVersion: 1,
    meta: keepServerFields ? cleanMeta(source.meta) : undefined,
    site: {
      pageTitle: text(ctx, 'site.pageTitle', site.pageTitle, 'Page title', { required: true, max: 70 }),
      metaDescription: text(ctx, 'site.metaDescription', site.metaDescription, 'Meta description', { required: true, max: 300 }),
      navName: text(ctx, 'site.navName', site.navName, 'Navigation name', { required: true, max: 60 }),
      navButton: validateButton(ctx, 'site.navButton', site.navButton, 'Navigation button')
    },
    hero: {
      heading: text(ctx, 'hero.heading', hero.heading, 'Hero heading', { required: true, max: 120 }),
      highlight: text(ctx, 'hero.highlight', hero.highlight, 'Highlighted word', { max: 60 }),
      description: text(ctx, 'hero.description', hero.description, 'Hero description', { required: true, max: 300, multiline: true }),
      image: imageRef(ctx, 'hero.image', hero.image, 'Hero image'),
      imageAlt: text(ctx, 'hero.imageAlt', hero.imageAlt, 'Hero image description', { max: 120 }),
      available: typeof hero.available === 'boolean' ? hero.available : (ctx.add('hero.available', 'Availability must be on or off.'), false),
      statusText: text(ctx, 'hero.statusText', hero.statusText, 'Availability text', { max: 60 }),
      primaryButton: validateButton(ctx, 'hero.primaryButton', hero.primaryButton, 'Primary button'),
      secondaryButton: validateButton(ctx, 'hero.secondaryButton', hero.secondaryButton, 'Secondary button')
    },
    profile: {
      name: text(ctx, 'profile.name', profile.name, 'Name', { required: true, max: 60 }),
      image: imageRef(ctx, 'profile.image', profile.image, 'Profile image'),
      imageAlt: text(ctx, 'profile.imageAlt', profile.imageAlt, 'Profile image description', { max: 120 }),
      aboutHeading: text(ctx, 'profile.aboutHeading', profile.aboutHeading, 'About heading', { max: 60 }),
      aboutDescription: text(ctx, 'profile.aboutDescription', profile.aboutDescription, 'About description', { required: true, max: 800, multiline: true })
    },
    contact: {
      tag: text(ctx, 'contact.tag', contact.tag, 'Contact label', { max: 40 }),
      heading: text(ctx, 'contact.heading', contact.heading, 'Contact heading', { required: true, max: 120 }),
      highlight: text(ctx, 'contact.highlight', contact.highlight, 'Highlighted text', { max: 60 }),
      text: text(ctx, 'contact.text', contact.text, 'Contact text', { max: 300, multiline: true }),
      email: email(ctx, 'contact.email', contact.email, 'Contact email'),
      buttonLabel: text(ctx, 'contact.buttonLabel', contact.buttonLabel, 'Email button text', { required: true, max: 40 }),
      bannerImage: imageRef(ctx, 'contact.bannerImage', contact.bannerImage, 'Contact banner image')
    },
    socials: [],
    footer: {
      brandName: text(ctx, 'footer.brandName', footer.brandName, 'Footer brand name', { required: true, max: 60 }),
      roles: [],
      copyright: text(ctx, 'footer.copyright', footer.copyright, 'Copyright text', { required: true, max: 160 })
    },
    projectList: [],
    tools: [],
    wds: []
  };

  highlightCheck(ctx, 'hero.highlight', value.hero.heading, value.hero.highlight, 'Highlighted word');
  highlightCheck(ctx, 'contact.highlight', value.contact.heading, value.contact.highlight, 'Highlighted text');

  const roles = arrayAt(ctx, 'footer.roles', footer.roles, 'Footer roles', LIMITS.roles);
  roles.forEach((role, index) => {
    const cleaned = text(ctx, `footer.roles[${index}]`, role, 'Role', { required: true, max: 40 });
    if (cleaned) value.footer.roles.push(cleaned);
  });

  const socialIds = new Set();
  arrayAt(ctx, 'socials', source.socials, 'Social links', LIMITS.socials).forEach((entry, index) => {
    const path = `socials[${index}]`;
    const item = objectAt(ctx, path, entry, 'Social link');
    const platform = typeof item.platform === 'string' ? item.platform : '';
    if (!PLATFORMS.includes(platform)) ctx.add(`${path}.platform`, 'Choose a supported platform.');
    value.socials.push({
      id: itemId(ctx, `${path}.id`, item.id, socialIds, 'social'),
      platform,
      url: httpUrl(ctx, `${path}.url`, item.url, 'Profile URL')
    });
  });

  const projectIds = new Set();
  arrayAt(ctx, 'projectList', source.projectList, 'Projects', LIMITS.projects).forEach((entry, index) => {
    const path = `projectList[${index}]`;
    const item = objectAt(ctx, path, entry, 'Project');
    const project = {
      id: itemId(ctx, `${path}.id`, item.id, projectIds, 'project'),
      name: text(ctx, `${path}.name`, item.name, 'Project name', { required: true, max: 80 }),
      imageSrc: imageRef(ctx, `${path}.imageSrc`, item.imageSrc, 'Project image'),
      description: text(ctx, `${path}.description`, item.description, 'Project description', { required: true, max: 240 }),
      appType: text(ctx, `${path}.appType`, item.appType, 'Project type', { required: true, max: 30 }),
      liveUrl: httpUrl(ctx, `${path}.liveUrl`, item.liveUrl, 'Live URL'),
      githubUrl: httpUrl(ctx, `${path}.githubUrl`, item.githubUrl, 'GitHub URL')
    };
    if (keepServerFields) project.updatedAt = isoOrEmpty(item.updatedAt);
    value.projectList.push(project);
  });

  const toolIds = new Set();
  arrayAt(ctx, 'tools', source.tools, 'Tools', LIMITS.tools).forEach((entry, index) => {
    const path = `tools[${index}]`;
    const item = objectAt(ctx, path, entry, 'Tool');
    const tool = {
      id: itemId(ctx, `${path}.id`, item.id, toolIds, 'tool'),
      name: text(ctx, `${path}.name`, item.name, 'Tool name', { required: true, max: 40 }),
      logo: imageRef(ctx, `${path}.logo`, item.logo, 'Tool logo')
    };
    if (keepServerFields) tool.updatedAt = isoOrEmpty(item.updatedAt);
    value.tools.push(tool);
  });

  const serviceIds = new Set();
  arrayAt(ctx, 'wds', source.wds, 'Services', LIMITS.services).forEach((entry, index) => {
    const path = `wds[${index}]`;
    const item = objectAt(ctx, path, entry, 'Service');
    const service = {
      id: itemId(ctx, `${path}.id`, item.id, serviceIds, 'service'),
      logo: imageRef(ctx, `${path}.logo`, item.logo, 'Service icon'),
      title: text(ctx, `${path}.title`, item.title, 'Service title', { required: true, max: 60 }),
      description: text(ctx, `${path}.description`, item.description, 'Service description', { required: true, max: 300 })
    };
    if (keepServerFields) service.updatedAt = isoOrEmpty(item.updatedAt);
    value.wds.push(service);
  });

  if (!keepServerFields) delete value.meta;
  return { ok: ctx.errors.length === 0, errors: ctx.errors, value };
}

module.exports = { validateContent, isHttpUrl, PLATFORMS, SECTION_KEYS, LOCAL_IMAGE_RE };
