const { ApiError } = require('../../server/errors');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

function nameFor(date) {
  return `portfolio-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}-${pad(date.getUTCMilliseconds(), 3)}.json`;
}

function createMemoryRepo({ now = () => new Date() } = {}) {
  const state = { draft: null, backups: [], publications: [], audit: [], assets: [], events: [], limits: new Map(), ids: { backup: 0, publication: 0, audit: 0, event: 0, asset: 0 } };
  const conflict = (current) => new ApiError(409, 'revision_conflict', 'The portfolio was changed somewhere else. Reload to get the latest version before continuing.', { currentRevision: current });
  const asset = (row) => ({ ...row });

  const repo = {
    state,
    async getDraft() {
      return state.draft ? clone(state.draft) : null;
    },
    async seedDraft(content, actor) {
      if (!state.draft) state.draft = { content: clone(content), revision: 1, updatedAt: now().toISOString(), updatedBy: actor };
      return state.draft.revision;
    },
    async saveDraft({ content, expectedRevision, actor, reason = 'save' }) {
      if (!state.draft) throw new ApiError(404, 'not_found', 'The requested item does not exist.');
      if (expectedRevision !== state.draft.revision) throw conflict(state.draft.revision);
      let time = now();
      let name = nameFor(time);
      while (state.backups.some((backup) => backup.name === name)) {
        time = new Date(time.getTime() + 1);
        name = nameFor(time);
      }
      state.backups.push({ id: ++state.ids.backup, name, content: clone(state.draft.content), reason, revision: state.draft.revision, size: Buffer.byteLength(JSON.stringify(state.draft.content)), createdAt: time.toISOString(), createdBy: actor });
      state.draft = { content: clone(content), revision: state.draft.revision + 1, updatedAt: now().toISOString(), updatedBy: actor };
      return { revision: state.draft.revision, backupName: name, updatedAt: state.draft.updatedAt };
    },
    async listBackups(limit = 300) {
      return [...state.backups].reverse().slice(0, limit).map(({ content, id, ...rest }) => rest);
    },
    async countBackups() {
      return state.backups.length;
    },
    async getBackup(name) {
      const found = state.backups.find((backup) => backup.name === name);
      if (!found) return null;
      const { id, ...rest } = clone(found);
      return rest;
    },
    async importBackup({ name, content, createdAt, actor }) {
      if (state.backups.some((backup) => backup.name === name)) return false;
      state.backups.push({ id: ++state.ids.backup, name, content: clone(content), reason: 'import', revision: null, size: Buffer.byteLength(JSON.stringify(content)), createdAt, createdBy: actor });
      return true;
    },
    async publish({ expectedRevision, actor, note }) {
      if (!state.draft) throw new ApiError(404, 'not_found', 'The requested item does not exist.');
      if (expectedRevision !== state.draft.revision) throw conflict(state.draft.revision);
      const row = { id: ++state.ids.publication, content: clone(state.draft.content), sourceRevision: state.draft.revision, republishedFrom: null, note: note || null, publishedAt: now().toISOString(), publishedBy: actor };
      state.publications.push(row);
      return { id: row.id, sourceRevision: row.sourceRevision, publishedAt: row.publishedAt };
    },
    async republish({ id, actor, note }) {
      const source = state.publications.find((row) => row.id === id);
      if (!source) throw new ApiError(404, 'not_found', 'The requested item does not exist.');
      const row = { id: ++state.ids.publication, content: clone(source.content), sourceRevision: source.sourceRevision, republishedFrom: id, note: note || null, publishedAt: now().toISOString(), publishedBy: actor };
      state.publications.push(row);
      return { id: row.id, sourceRevision: row.sourceRevision, publishedAt: row.publishedAt };
    },
    async listPublications(limit = 50) {
      return [...state.publications].reverse().slice(0, limit).map(({ content, ...rest }) => rest);
    },
    async getPublication(id) {
      const found = state.publications.find((row) => row.id === id);
      return found ? clone(found) : null;
    },
    async getLatestPublication() {
      const last = state.publications[state.publications.length - 1];
      return last ? clone(last) : null;
    },
    async getPublished() {
      const last = state.publications[state.publications.length - 1];
      return last ? { id: last.id, content: clone(last.content), publishedAt: last.publishedAt } : null;
    },
    async audit(entry) {
      state.audit.push({ id: ++state.ids.audit, at: now().toISOString(), actor: entry.actorEmail, action: entry.action, target: entry.target, outcome: entry.outcome, ip: entry.ip, details: entry.details || {} });
    },
    async listAudit(limit = 100) {
      return [...state.audit].reverse().slice(0, limit);
    },
    async insertAsset(input) {
      const row = { id: `00000000-0000-4000-8000-${String(++state.ids.asset).padStart(12, '0')}`, objectPath: input.objectPath, name: input.name, mime: input.mime, size: input.size, url: input.url, uploadedBy: input.uploadedBy, createdAt: now().toISOString() };
      state.assets.push(row);
      return asset(row);
    },
    async listAssets(limit = 500) {
      return [...state.assets].reverse().slice(0, limit).map(asset);
    },
    async getAsset(id) {
      const found = state.assets.find((row) => row.id === id);
      return found ? asset(found) : null;
    },
    async deleteAsset(id) {
      state.assets = state.assets.filter((row) => row.id !== id);
    },
    async insertEvent(event) {
      state.events.push({ id: ++state.ids.event, at: now().toISOString(), actor: event.actor, kind: event.kind, ref: event.ref || null, sha: event.sha || null, deploymentId: event.deploymentId || null, previousDeploymentId: event.previousDeploymentId || null, details: event.details || {} });
    },
    async listEvents(limit = 200) {
      return [...state.events].reverse().slice(0, limit);
    },
    async rateLimit(key, windowSeconds, max) {
      const time = Date.now();
      let entry = state.limits.get(key);
      if (!entry || entry.start + windowSeconds * 1000 <= time) entry = { start: time, hits: 0 };
      entry.hits += 1;
      state.limits.set(key, entry);
      return { allowed: entry.hits <= max, hits: entry.hits, retryAfter: Math.max(1, Math.ceil((entry.start + windowSeconds * 1000 - time) / 1000)) };
    }
  };
  return repo;
}

function createMemoryMedia() {
  const objects = new Map();
  return {
    objects,
    async put(objectPath, buffer, contentType) {
      objects.set(objectPath, { size: buffer.length, contentType });
      return `https://media.test/storage/v1/object/public/portfolio-images/${objectPath}`;
    },
    async remove(paths) {
      for (const item of paths) objects.delete(item);
    }
  };
}

module.exports = { createMemoryRepo, createMemoryMedia };
