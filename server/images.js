const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errors');

const UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UPLOAD_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const LIST_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
const MAX_LIST_DEPTH = 4;
const MAX_LIST_ITEMS = 1000;
const CACHE_MS = 30000;
const ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

function safeStem(originalName) {
  const stem = path.parse(String(originalName || '')).name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'image';
}

function createStaticImages(config, now = () => Date.now()) {
  let cache = null;

  async function walk(directory, depth, results) {
    if (depth > MAX_LIST_DEPTH || results.length >= MAX_LIST_ITEMS) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1, results);
      } else if (entry.isFile() && LIST_EXT.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(full);
        const relative = path.relative(config.publicDir, full).split(path.sep).join('/');
        results.push({
          id: null,
          path: relative,
          name: entry.name,
          folder: path.posix.dirname(relative),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          uploaded: relative.startsWith('images/uploads/'),
          deletable: false
        });
      }
      if (results.length >= MAX_LIST_ITEMS) return;
    }
  }

  async function list() {
    if (cache && cache.until > now()) return cache.items;
    const items = [];
    await walk(config.imagesDir, 0, items);
    cache = { items, until: now() + CACHE_MS };
    return items;
  }

  async function paths() {
    return new Set((await list()).map((item) => item.path));
  }

  return { list, paths };
}

function createImages({ config, repo, media, staticImages, isReferenced }) {
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 0, parts: 2 },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname || '').toLowerCase();
      if (!UPLOAD_MIME.has(file.mimetype) || !UPLOAD_EXT.has(extension)) {
        callback(new ApiError(415, 'unsupported_type', 'Only JPG, PNG and WebP images can be uploaded.'));
        return;
      }
      callback(null, true);
    }
  }).single('image');

  function receive(req, res) {
    return new Promise((resolve, reject) => {
      uploader(req, res, (error) => {
        if (!error) return resolve(req.file);
        if (error instanceof ApiError) return reject(error);
        if (error.code === 'LIMIT_FILE_SIZE') return reject(new ApiError(413, 'file_too_large', `Images must be ${Math.floor(config.maxUploadBytes / 1048576)} MB or smaller.`));
        if (error instanceof multer.MulterError) return reject(new ApiError(400, 'upload_failed', 'The upload could not be read. Choose one image and try again.'));
        return reject(error);
      });
    });
  }

  function toListItem(asset) {
    return {
      id: asset.id,
      path: asset.url,
      name: asset.name,
      folder: 'uploads',
      size: asset.size,
      modifiedAt: asset.createdAt,
      uploaded: true,
      deletable: true
    };
  }

  async function saveUpload(file, actor) {
    if (!file) throw new ApiError(400, 'no_file', 'Choose an image to upload.');
    const type = detectImageType(file.buffer);
    if (!type) throw new ApiError(415, 'unsupported_type', 'That file is not a real JPG, PNG or WebP image.');
    const name = `${safeStem(file.originalname)}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
    const objectPath = `uploads/${name}`;
    const url = await media.put(objectPath, file.buffer, type.mime);
    try {
      const asset = await repo.insertAsset({ objectPath, name, mime: type.mime, size: file.buffer.length, url, uploadedBy: actor });
      return toListItem(asset);
    } catch (error) {
      await media.remove([objectPath]).catch(() => {});
      throw error;
    }
  }

  async function listImages() {
    const [statics, assets] = await Promise.all([staticImages.list(), repo.listAssets(500)]);
    return [...assets.map(toListItem), ...statics].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  async function removeUpload(id) {
    if (typeof id !== 'string' || !ASSET_ID_RE.test(id)) throw new ApiError(400, 'bad_image_id', 'That is not a valid image.');
    const asset = await repo.getAsset(id);
    if (!asset) throw new ApiError(404, 'image_not_found', 'That image no longer exists.');
    if (await isReferenced(asset.url)) {
      throw new ApiError(409, 'image_in_use', 'This image is used by the draft or the published site. Replace it there first.');
    }
    await media.remove([asset.objectPath]);
    await repo.deleteAsset(id);
    return asset;
  }

  return { receive, saveUpload, listImages, removeUpload };
}

module.exports = { createImages, createStaticImages, detectImageType };
