import { clone, stable } from './dom.js';
import { api } from './api.js';

const COLLECTIONS = ['projectList', 'tools', 'wds'];
const SECTIONS = [
  { key: 'site', label: 'Page and navigation settings', route: 'homepage' },
  { key: 'hero', label: 'Homepage hero', route: 'homepage' },
  { key: 'profile', label: 'Profile and About', route: 'profile' },
  { key: 'contact', label: 'Contact banner', route: 'profile' },
  { key: 'socials', label: 'Social links', route: 'profile' },
  { key: 'footer', label: 'Footer', route: 'profile' }
];
const COLLECTION_INFO = {
  projectList: { noun: 'Project', plural: 'Projects', title: 'name', route: 'projects' },
  tools: { noun: 'Tool', plural: 'Tools', title: 'name', route: 'tools' },
  wds: { noun: 'Service', plural: 'Services', title: 'title', route: 'services' }
};

const listeners = new Set();

export const store = {
  saved: null,
  draft: null,
  status: null,
  session: null,
  saving: false
};

function comparable(content) {
  if (!content) return null;
  const copy = clone(content);
  delete copy.meta;
  for (const key of COLLECTIONS) copy[key] = copy[key].map(({ updatedAt, ...rest }) => rest);
  return copy;
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initContent(content) {
  store.saved = content ? clone(content) : null;
  store.draft = content ? clone(content) : null;
  emit();
}

export function update(mutator) {
  mutator(store.draft);
  emit();
}

export function discardChanges() {
  store.draft = clone(store.saved);
  emit();
}

export function isDirty() {
  if (!store.draft || !store.saved) return false;
  return stable(comparable(store.draft)) !== stable(comparable(store.saved));
}

export function setStatus(status) {
  store.status = status;
  emit();
}

export function diffContent(saved, draft) {
  if (!saved || !draft) return [];
  const before = comparable(saved);
  const after = comparable(draft);
  const changes = [];

  for (const section of SECTIONS) {
    if (stable(before[section.key]) !== stable(after[section.key])) {
      changes.push({ kind: 'edited', label: section.label, route: section.route });
    }
  }

  for (const key of COLLECTIONS) {
    const info = COLLECTION_INFO[key];
    const oldById = new Map(before[key].map((item) => [item.id, item]));
    const newById = new Map(after[key].map((item) => [item.id, item]));
    const name = (item) => `${info.noun} \u201c${item[info.title] || 'Untitled'}\u201d`;

    for (const item of after[key]) {
      const old = oldById.get(item.id);
      if (!old) changes.push({ kind: 'added', label: name(item), route: info.route });
      else if (stable(old) !== stable(item)) changes.push({ kind: 'edited', label: name(item), route: info.route });
    }
    for (const item of before[key]) {
      if (!newById.has(item.id)) changes.push({ kind: 'removed', label: name(item), route: info.route });
    }

    const orderBefore = before[key].filter((item) => newById.has(item.id)).map((item) => item.id).join();
    const orderAfter = after[key].filter((item) => oldById.has(item.id)).map((item) => item.id).join();
    if (orderBefore !== orderAfter) changes.push({ kind: 'reordered', label: `${info.plural} order`, route: info.route });
  }
  return changes;
}

export function contentWarnings(content) {
  if (!content) return [];
  const warnings = [];
  const emptySocials = content.socials.filter((item) => !item.url);
  if (emptySocials.length) {
    warnings.push({ message: `${emptySocials.length} social ${emptySocials.length === 1 ? 'link has' : 'links have'} no URL and point nowhere.`, route: 'profile' });
  }
  const byUrl = new Map();
  for (const project of content.projectList) {
    if (!project.liveUrl) continue;
    byUrl.set(project.liveUrl, [...(byUrl.get(project.liveUrl) || []), project.name]);
  }
  for (const [url, names] of byUrl) {
    if (names.length > 1) warnings.push({ message: `${names.join(', ')} share the same live URL (${url}).`, route: 'projects' });
  }
  const missingLive = content.projectList.filter((item) => !item.liveUrl);
  if (missingLive.length) {
    warnings.push({ message: `${missingLive.map((item) => item.name).join(', ')} ${missingLive.length === 1 ? 'has' : 'have'} no live URL, so the card has no link.`, route: 'projects' });
  }
  return warnings;
}

export async function refreshStatus() {
  try {
    setStatus(await api.status());
  } catch {
    store.status = null;
  }
}
