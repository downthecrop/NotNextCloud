const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const crypto = require('crypto');
const { normalizeParent } = require('../utils');

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

function parseSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function uploadIdFor(rootId, relPath, size) {
  return crypto
    .createHash('sha1')
    .update(`${rootId}::${relPath}::${size}`)
    .digest('hex');
}

function uploadTempPath(config, uploadId) {
  return path.join(config.uploadTempDir, `${uploadId}.part`);
}

async function finalizeUpload({ partPath, fullPath, overwrite }) {
  const targetDir = path.dirname(fullPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  let existing = null;
  try {
    existing = await fs.promises.lstat(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (existing) {
    if (existing.isDirectory()) {
      return { ok: false, error: 'Target is a directory', conflict: true };
    }
    if (existing.isSymbolicLink()) {
      return { ok: false, error: 'Target is a symlink', conflict: true };
    }
    if (!overwrite) {
      return { ok: false, error: 'File already exists', conflict: true };
    }
    await fs.promises.unlink(fullPath);
  }
  try {
    await fs.promises.rename(partPath, fullPath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
    await fs.promises.copyFile(partPath, fullPath);
    await fs.promises.unlink(partPath);
  }
  return { ok: true };
}

async function ensureEmptyFile(fullPath, overwrite) {
  const targetDir = path.dirname(fullPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  let existing = null;
  try {
    existing = await fs.promises.lstat(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (existing) {
    if (existing.isDirectory()) {
      return { ok: false, error: 'Target is a directory', conflict: true };
    }
    if (existing.isSymbolicLink()) {
      return { ok: false, error: 'Target is a symlink', conflict: true };
    }
    if (!overwrite) {
      return { ok: false, error: 'File already exists', conflict: true };
    }
    await fs.promises.unlink(fullPath);
  }
  await fs.promises.writeFile(fullPath, '');
  return { ok: true };
}

async function upsertUploadedFile({ db, root, relPath, fullPath }) {
  let stats;
  try {
    stats = await fs.promises.stat(fullPath);
  } catch {
    return;
  }
  if (!stats.isFile()) {
    return;
  }
  const name = path.basename(relPath);
  const ext = path.extname(name).toLowerCase();
  let mimeType = mime.lookup(ext) || null;
  if (!mimeType && ext === '.opus') {
    mimeType = 'audio/opus';
  }
  const safeMime = mimeType || 'application/octet-stream';
  db.upsertEntry.run({
    root_id: root.id,
    rel_path: relPath,
    parent: normalizeParent(relPath),
    name,
    ext,
    size: stats.size,
    mtime: Math.floor(stats.mtimeMs),
    mime: safeMime,
    is_dir: 0,
    scan_id: Date.now(),
    title: null,
    artist: null,
    album: null,
    duration: null,
    album_key: null,
    content_hash: null,
    hash_alg: null,
    inode: Number.isFinite(stats.ino) ? stats.ino : null,
    device: Number.isFinite(stats.dev) ? stats.dev : null,
  });
}

module.exports = {
  parseBoolean,
  parseSize,
  uploadIdFor,
  uploadTempPath,
  finalizeUpload,
  ensureEmptyFile,
  upsertUploadedFile,
};
