const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('./errors');
const { validateContent, SECTION_KEYS } = require('./validate');

const COLLECTIONS = ['projectList', 'tools', 'wds'];
const BACKUP_NAME_RE = /^portfolio-(\d{8})-(\d{6})-(\d{3})\.json$/;

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

function backupNameFor(date) {
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `portfolio-${day}-${time}-${pad(date.getUTCMilliseconds(), 3)}.json`;
}

function backupDateFromName(name) {
  const match = BACKUP_NAME_RE.exec(name);
  if (!match) return null;
  const [, day, time, ms] = match;
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.${ms}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
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
    sections[key] = changed ? now : previous.meta.sections[key] || now;
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

function createStorage(config) {
  let queue = Promise.resolve();

  function exclusive(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  async function atomicWrite(file, data) {
    const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const handle = await fs.open(temp, 'wx');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }

  async function readRaw() {
    let raw;
    try {
      raw = await fs.readFile(config.dataFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false, parsed: null, parseError: null };
      throw error;
    }
    try {
      return { exists: true, parsed: JSON.parse(raw), parseError: null };
    } catch (error) {
      return { exists: true, parsed: null, parseError: error.message };
    }
  }

  async function readCurrent() {
    const { exists, parsed, parseError } = await readRaw();
    if (!exists) return { exists, content: null, errors: [{ path: '', message: 'portfolio.json does not exist.' }] };
    if (parseError) return { exists, content: null, errors: [{ path: '', message: `portfolio.json is not valid JSON: ${parseError}` }] };
    const result = validateContent(parsed, { keepServerFields: true });
    return { exists, content: result.ok ? result.value : null, errors: result.errors };
  }

  async function loadContent() {
    const { content, errors } = await readCurrent();
    if (!content) {
      throw new ApiError(500, 'invalid_content', 'The saved portfolio data could not be loaded. Restore a backup to continue.', errors.slice(0, 20));
    }
    return content;
  }

  async function createBackup() {
    await fs.mkdir(config.backupDir, { recursive: true });
    let date = new Date();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const name = backupNameFor(date);
      try {
        await fs.copyFile(config.dataFile, path.join(config.backupDir, name), fsConstants.COPYFILE_EXCL);
        return name;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        date = new Date(date.getTime() + 1);
      }
    }
    throw new ApiError(500, 'backup_failed', 'Could not create a unique backup file.');
  }

  async function commit(value, { restoredFrom = null } = {}) {
    const { exists, content: previous } = await readCurrent();
    const now = new Date().toISOString();
    const next = stamp(previous, value, now);

    if (previous && sameJson(bare(previous), bare(next))) {
      return { content: previous, unchanged: true, backup: null, restoredFrom };
    }

    let backup = null;
    if (exists) backup = await createBackup();
    await fs.mkdir(path.dirname(config.dataFile), { recursive: true });
    await atomicWrite(config.dataFile, `${JSON.stringify(next, null, 2)}\n`);
    return { content: next, unchanged: false, backup, restoredFrom };
  }

  function saveContent(input) {
    const result = validateContent(input);
    if (!result.ok) {
      throw new ApiError(422, 'validation_failed', 'Some fields need attention before this can be saved.', result.errors.slice(0, 50));
    }
    return exclusive(() => commit(result.value));
  }

  function assertBackupName(name) {
    if (typeof name !== 'string' || !BACKUP_NAME_RE.test(name)) {
      throw new ApiError(400, 'bad_backup_name', 'That is not a valid backup name.');
    }
    return path.join(config.backupDir, name);
  }

  async function readBackupFile(name) {
    const file = assertBackupName(name);
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new ApiError(404, 'backup_not_found', 'That backup no longer exists.');
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError(422, 'backup_invalid', 'That backup is not valid JSON.');
    }
    return { raw, parsed };
  }

  async function listBackups() {
    let names;
    try {
      names = await fs.readdir(config.backupDir);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const matching = names.filter((name) => BACKUP_NAME_RE.test(name)).sort().reverse().slice(0, 300);
    const entries = [];
    for (const name of matching) {
      const file = path.join(config.backupDir, name);
      const stat = await fs.stat(file);
      let summary = null;
      try {
        const result = validateContent(JSON.parse(await fs.readFile(file, 'utf8')), { keepServerFields: true });
        if (result.ok) summary = summarize(result.value);
      } catch {
        summary = null;
      }
      entries.push({ name, size: stat.size, createdAt: backupDateFromName(name), valid: summary !== null, summary });
    }
    return entries;
  }

  async function readBackup(name) {
    const { raw, parsed } = await readBackupFile(name);
    const result = validateContent(parsed, { keepServerFields: true });
    return {
      name,
      createdAt: backupDateFromName(name),
      size: Buffer.byteLength(raw),
      valid: result.ok,
      errors: result.errors.slice(0, 20),
      summary: result.ok ? summarize(result.value) : null,
      content: parsed
    };
  }

  function restoreBackup(name) {
    return exclusive(async () => {
      const { parsed } = await readBackupFile(name);
      const result = validateContent(parsed, { keepServerFields: false });
      if (!result.ok) {
        throw new ApiError(422, 'backup_invalid', 'That backup does not match the current portfolio format and cannot be restored.', result.errors.slice(0, 20));
      }
      return commit(result.value, { restoredFrom: name });
    });
  }

  async function resolveLocalImage(reference) {
    if (!reference.startsWith('images/') || reference.split('/').includes('..')) return null;
    const resolved = path.resolve(config.publicDir, reference);
    if (!resolved.startsWith(path.resolve(config.imagesDir) + path.sep)) return null;
    try {
      const stat = await fs.stat(resolved);
      return stat.isFile() ? resolved : null;
    } catch {
      return null;
    }
  }

  async function getStatus() {
    const { content } = await readCurrent();
    const backups = await listBackups();
    let fileBytes = 0;
    try {
      fileBytes = (await fs.stat(config.dataFile)).size;
    } catch {
      fileBytes = 0;
    }
    const missing = new Map();
    let referenced = 0;
    if (content) {
      for (const reference of imageReferences(content)) {
        if (/^https?:\/\//i.test(reference.path)) continue;
        referenced += 1;
        if (!(await resolveLocalImage(reference.path))) {
          if (!missing.has(reference.path)) missing.set(reference.path, []);
          missing.get(reference.path).push(reference.label);
        }
      }
    }
    return {
      dataValid: Boolean(content),
      lastSavedAt: content && content.meta.updatedAt ? content.meta.updatedAt : null,
      fileBytes,
      backupCount: backups.length,
      localImagesReferenced: referenced,
      missingImages: [...missing.entries()].map(([imagePath, usedBy]) => ({ path: imagePath, usedBy }))
    };
  }

  return { loadContent, saveContent, listBackups, readBackup, restoreBackup, getStatus, atomicWrite };
}

module.exports = { createStorage, BACKUP_NAME_RE };
