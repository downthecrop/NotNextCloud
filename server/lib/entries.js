const mime = require('mime-types');

function normalizeMimeValue(row) {
  if (!row || row.is_dir) {
    return null;
  }
  const rawMime = typeof row.mime === 'string' ? row.mime : null;
  if (rawMime && rawMime !== 'application/octet-stream') {
    return rawMime;
  }
  const ext = typeof row.ext === 'string' ? row.ext.toLowerCase() : '';
  let fallback = ext ? mime.lookup(ext) : null;
  if (!fallback && ext === '.opus') {
    fallback = 'audio/opus';
  }
  return fallback || rawMime || 'application/octet-stream';
}

function toEntry(row) {
  if (!row) {
    return null;
  }
  return {
    rootId: row.root_id,
    path: row.rel_path,
    name: row.name,
    size: row.size,
    mtime: row.mtime,
    mime: normalizeMimeValue(row),
    ext: row.ext,
    isDir: Boolean(row.is_dir),
    title: row.title || null,
    artist: row.artist || null,
    album: row.album || null,
    duration: row.duration || null,
    albumKey: row.album_key || null,
  };
}

function toEntryList(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map(toEntry).filter(Boolean);
}

module.exports = {
  toEntry,
  toEntryList,
};
