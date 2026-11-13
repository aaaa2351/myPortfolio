const { SECTION_KEYS } = require('./validate');

const COLLECTIONS = ['projectList', 'tools', 'wds'];
const BACKUP_NAME_RE = /^portfolio-(\d{8})-(\d{6})-(\d{3})\.json$/;

function backupDateFromName(name) {
  const match = BACKUP_NAME_RE.exec(name);
  if (!match) return null;
  const [, day, time, ms] = match;
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.${ms}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameJson(a, b) {
  return canonical(a) === canonical(b);
}

function stripItem(item) {
  const { updatedAt, ...rest } = item;
  return rest;
}

function bare(content) {
  const copy = { ...content };
  delete copy.meta;
  for (const key of COLLECTIONS) copy[key] = (content[key] || []).map(stripItem);
  return copy;
}

function stamp(previous, next, now) {
  const previousBare = previous ? bare(previous) : null;
  const nextBare = bare(next);
  const sections = {};
  for (const key of SECTION_KEYS) {
    const changed = !previousBare || !sameJson(previousBare[key], nextBare[key]);
    sections[key] = changed ? now : (previous.meta && previous.meta.sections && previous.meta.sections[key]) || now;
  }
  const result = { ...next, meta: { updatedAt: now, sections } };
  for (const key of COLLECTIONS) {
    const previousById = new Map((previous ? previous[key] : []).map((item) => [item.id, item]));
    result[key] = next[key].map((item) => {
      const old = previousById.get(item.id);
      const changed = !old || !sameJson(stripItem(old), item);
      return { ...item, updatedAt: changed ? now : old.updatedAt || now };
    });
  }
  return result;
}

function summarize(content) {
  return {
    projects: content.projectList.length,
    tools: content.tools.length,
    services: content.wds.length,
    savedAt: content.meta ? content.meta.updatedAt || null : null
  };
}

function imageReferences(content) {
  return [
    { path: content.hero.image, label: 'Hero image' },
    { path: content.profile.image, label: 'Profile image' },
    { path: content.contact.bannerImage, label: 'Contact banner' },
    ...content.projectList.map((item) => ({ path: item.imageSrc, label: `Project: ${item.name}` })),
    ...content.tools.map((item) => ({ path: item.logo, label: `Tool: ${item.name}` })),
    ...content.wds.map((item) => ({ path: item.logo, label: `Service: ${item.title}` }))
  ];
}

module.exports = { canonical, COLLECTIONS, BACKUP_NAME_RE, backupDateFromName, sameJson, bare, stamp, summarize, imageReferences };
