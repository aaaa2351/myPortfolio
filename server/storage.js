const fs = require('fs/promises');
const { ApiError } = require('./errors');
const { validateContent } = require('./validate');
const model = require('./content-model');

function createContentService({ repo, config, staticImages, now = () => new Date() }) {
  async function readSeed() {
    let raw;
    try {
      raw = await fs.readFile(config.dataFile, 'utf8');
    } catch {
      throw new ApiError(500, 'no_seed', 'No portfolio data exists yet and the bundled starter file is missing.');
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError(500, 'invalid_seed', 'The bundled starter file is not valid JSON.');
    }
    const result = validateContent(parsed, { keepServerFields: false });
    if (!result.ok) throw new ApiError(500, 'invalid_seed', 'The bundled starter file does not match the portfolio format.', result.errors.slice(0, 20));
    return result.value;
  }

  async function ensureDraft() {
    let row = await repo.getDraft();
    if (!row) {
      await repo.seedDraft(model.stamp(null, await readSeed(), now().toISOString()), 'system');
      row = await repo.getDraft();
    }
    return row;
  }

  async function loadDraft() {
    const row = await ensureDraft();
    const result = validateContent(row.content, { keepServerFields: true });
    if (!result.ok) {
      throw new ApiError(500, 'invalid_content', 'The saved portfolio data could not be loaded. Restore a backup to continue.', result.errors.slice(0, 20));
    }
    return { content: result.value, revision: row.revision, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }

  async function currentRevision() {
    return (await ensureDraft()).revision;
  }

  async function latestPublication(withContent = true) {
    const latest = await repo.getLatestPublication();
    if (!latest) return null;
    return withContent ? latest : { ...latest, content: undefined };
  }

  async function saveDraft(input, revision, actor) {
    const result = validateContent(input);
    if (!result.ok) throw new ApiError(422, 'validation_failed', 'Some fields need attention before this can be saved.', result.errors.slice(0, 50));
    if (!Number.isInteger(revision)) throw new ApiError(400, 'revision_required', 'The request must include the revision it was based on.');
    const current = await loadDraft();
    if (model.sameJson(model.bare(current.content), model.bare(result.value))) {
      return { content: current.content, revision: current.revision, unchanged: true, backup: null };
    }
    if (revision !== current.revision) {
      throw new ApiError(409, 'revision_conflict', 'The portfolio was changed somewhere else. Reload to get the latest version before saving.', { currentRevision: current.revision });
    }
    const next = model.stamp(current.content, result.value, now().toISOString());
    const saved = await repo.saveDraft({ content: next, expectedRevision: current.revision, actor, reason: 'save' });
    return { content: next, revision: saved.revision, unchanged: false, backup: saved.backupName };
  }

  async function listBackups() {
    const rows = await repo.listBackups(300);
    const entries = [];
    for (const row of rows) {
      const backup = await repo.getBackup(row.name);
      const result = backup ? validateContent(backup.content, { keepServerFields: true }) : { ok: false };
      entries.push({
        name: row.name,
        size: row.size,
        createdAt: row.createdAt,
        reason: row.reason,
        valid: result.ok,
        summary: result.ok ? model.summarize(result.value) : null
      });
    }
    return entries;
  }

  async function readBackup(name) {
    if (typeof name !== 'string' || !model.BACKUP_NAME_RE.test(name)) throw new ApiError(400, 'bad_backup_name', 'That is not a valid backup name.');
    const backup = await repo.getBackup(name);
    if (!backup) throw new ApiError(404, 'backup_not_found', 'That backup no longer exists.');
    const result = validateContent(backup.content, { keepServerFields: true });
    return {
      name,
      createdAt: backup.createdAt,
      size: backup.size,
      reason: backup.reason,
      valid: result.ok,
      errors: result.errors.slice(0, 20),
      summary: result.ok ? model.summarize(result.value) : null,
      content: backup.content
    };
  }

  async function restoreBackup(name, revision, actor) {
    const backup = await readBackup(name);
    const result = validateContent(backup.content, { keepServerFields: false });
    if (!result.ok) throw new ApiError(422, 'backup_invalid', 'That backup does not match the current portfolio format and cannot be restored.', result.errors.slice(0, 20));
    let previous = null;
    let expected;
    try {
      const current = await loadDraft();
      previous = current.content;
      expected = current.revision;
    } catch (error) {
      if (error.code !== 'invalid_content') throw error;
      expected = await currentRevision();
    }
    if (Number.isInteger(revision) && revision !== expected) {
      throw new ApiError(409, 'revision_conflict', 'The portfolio was changed somewhere else. Reload before restoring.', { currentRevision: expected });
    }
    const next = model.stamp(previous, result.value, now().toISOString());
    if (previous && model.sameJson(model.bare(previous), model.bare(next))) {
      return { content: previous, revision: expected, unchanged: true, backup: null, restoredFrom: name };
    }
    const saved = await repo.saveDraft({ content: next, expectedRevision: expected, actor, reason: 'restore' });
    return { content: next, revision: saved.revision, unchanged: false, backup: saved.backupName, restoredFrom: name };
  }

  async function publishingState() {
    const draft = await loadDraft();
    const latest = await latestPublication(true);
    const history = await repo.listPublications(50);
    return {
      draft: { revision: draft.revision, updatedAt: draft.updatedAt, updatedBy: draft.updatedBy },
      published: latest ? { id: latest.id, publishedAt: latest.publishedAt, publishedBy: latest.publishedBy, sourceRevision: latest.sourceRevision, note: latest.note, content: latest.content } : null,
      pending: !latest || !model.sameJson(latest.content, draft.content),
      history
    };
  }

  async function publish(revision, actor, note) {
    if (!Number.isInteger(revision)) throw new ApiError(400, 'revision_required', 'The request must include the draft revision being published.');
    const cleanNote = typeof note === 'string' ? note.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200) : '';
    const draft = await loadDraft();
    if (revision !== draft.revision) {
      throw new ApiError(409, 'revision_conflict', 'The draft changed since you reviewed it. Reload and review again.', { currentRevision: draft.revision });
    }
    const latest = await latestPublication(true);
    if (latest && model.sameJson(latest.content, draft.content)) return { unchanged: true, publication: { id: latest.id, publishedAt: latest.publishedAt } };
    const publication = await repo.publish({ expectedRevision: draft.revision, actor, note: cleanNote });
    return { unchanged: false, publication };
  }

  async function republish(id, actor, note) {
    if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'bad_publication', 'That is not a valid publication.');
    const cleanNote = typeof note === 'string' ? note.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200) : '';
    const source = await repo.getPublication(id);
    if (!source) throw new ApiError(404, 'not_found', 'That published version does not exist.');
    const result = validateContent(source.content, { keepServerFields: true });
    if (!result.ok) throw new ApiError(422, 'publication_invalid', 'That version does not match the current format and cannot be republished.', result.errors.slice(0, 20));
    return { publication: await repo.republish({ id, actor, note: cleanNote || `Republished version ${id}` }) };
  }

  async function readPublication(id) {
    if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'bad_publication', 'That is not a valid publication.');
    const publication = await repo.getPublication(id);
    if (!publication) throw new ApiError(404, 'not_found', 'That published version does not exist.');
    return publication;
  }

  async function publicContent() {
    const published = await repo.getPublished();
    if (!published) return null;
    const result = validateContent(published.content, { keepServerFields: true });
    return result.ok ? { content: result.value, publishedAt: published.publishedAt } : null;
  }

  async function referencedImages() {
    const references = new Set();
    try {
      for (const ref of model.imageReferences((await loadDraft()).content)) references.add(ref.path);
    } catch {
      return references;
    }
    const latest = await latestPublication(true);
    if (latest) {
      const result = validateContent(latest.content, { keepServerFields: true });
      if (result.ok) for (const ref of model.imageReferences(result.value)) references.add(ref.path);
    }
    return references;
  }

  async function status() {
    let draft = null;
    try {
      draft = await loadDraft();
    } catch {
      draft = null;
    }
    const known = await staticImages.paths();
    const missing = new Map();
    let referenced = 0;
    if (draft) {
      for (const reference of model.imageReferences(draft.content)) {
        if (/^https?:\/\//i.test(reference.path)) continue;
        referenced += 1;
        if (!known.has(reference.path)) {
          if (!missing.has(reference.path)) missing.set(reference.path, []);
          missing.get(reference.path).push(reference.label);
        }
      }
    }
    const latest = await latestPublication(true);
    return {
      dataValid: Boolean(draft),
      lastSavedAt: draft && draft.content.meta.updatedAt ? draft.content.meta.updatedAt : null,
      revision: draft ? draft.revision : null,
      contentBytes: draft ? Buffer.byteLength(JSON.stringify(draft.content)) : 0,
      backupCount: await repo.countBackups(),
      localImagesReferenced: referenced,
      missingImages: [...missing.entries()].map(([imagePath, usedBy]) => ({ path: imagePath, usedBy })),
      published: latest ? { id: latest.id, publishedAt: latest.publishedAt, sourceRevision: latest.sourceRevision } : null,
      unpublishedChanges: draft ? !latest || !model.sameJson(latest.content, draft.content) : false
    };
  }

  return { loadDraft, saveDraft, listBackups, readBackup, restoreBackup, publishingState, publish, republish, readPublication, publicContent, referencedImages, status };
}

module.exports = { createContentService };
