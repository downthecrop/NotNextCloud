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
    mime: row.mime,
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
