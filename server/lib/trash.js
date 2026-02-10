const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

function safeRootTrashSegment(rootId) {
  const raw = String(rootId || '').trim();
  const normalized = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized && normalized !== '.' && normalized !== '..') {
    return normalized;
  }
  const suffix = crypto.createHash('sha1').update(raw || 'root').digest('hex').slice(0, 12);
  return `root-${suffix}`;
}

function trashRelName(rootId, relPath) {
  const base = path.basename(relPath || '') || 'item';
  const safeBase = base.replace(/[^\w.\-() ]+/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nonce = crypto.randomBytes(3).toString('hex');
  return path.join(safeRootTrashSegment(rootId), `${stamp}-${nonce}-${safeBase}`);
}

async function movePath(sourcePath, targetPath, isDir) {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.promises.rename(sourcePath, targetPath);
    return;
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
  }
  if (isDir) {
    await fs.promises.cp(sourcePath, targetPath, { recursive: true });
    await fs.promises.rm(sourcePath, { recursive: true, force: true });
  } else {
    await fs.promises.copyFile(sourcePath, targetPath);
    await fs.promises.unlink(sourcePath);
  }
}

async function removeTrashEntry({ db, config }, entry) {
  if (!entry?.trash_rel_path) {
    return;
  }
  const trashFull = path.join(config.trashDir, entry.trash_rel_path);
  try {
    const stats = await fs.promises.lstat(trashFull);
    if (stats.isDirectory()) {
      await fs.promises.rm(trashFull, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(trashFull);
    }
  } catch {
    // Ignore missing files.
  }
  db.deleteTrashById.run(entry.id);
}

async function purgeTrash({ db, config }, { rootId = null, olderThan = null } = {}) {
  let query = 'SELECT id, root_id, rel_path, is_dir, trash_rel_path FROM trash_entries';
  const params = [];
  const clauses = [];
  if (rootId) {
    clauses.push('root_id = ?');
    params.push(rootId);
  }
  if (typeof olderThan === 'number') {
    clauses.push('deleted_at < ?');
    params.push(olderThan);
  }
  if (clauses.length) {
    query += ` WHERE ${clauses.join(' AND ')}`;
  }
  const entries = db.db.prepare(query).all(...params);
  for (const entry of entries) {
    await removeTrashEntry({ db, config }, entry);
  }
  return entries.length;
}

module.exports = {
  trashRelName,
  movePath,
  removeTrashEntry,
  purgeTrash,
};
