function listMediaAll({ db, entrySelect, rootIds, type, prefixLike, limit, offset }) {
  if (!rootIds.length) {
    return { rows: [], total: 0 };
  }
  const typeFilter = type === 'photos'
    ? "(mime LIKE 'image/%' OR mime LIKE 'video/%')"
    : "mime LIKE 'audio/%'";
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootClause} AND is_dir = 0 AND ${typeFilter}${prefixClause}`;
  const params = [...rootIds];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
  const total = db.prepare(countSql).get(...params)?.count || 0;
  const dataSql = `
    ${entrySelect}
    WHERE ${baseWhere}
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);
  return { rows, total };
}

function searchAll({ db, entrySelect, rootIds, type, like, prefixLike, limit, offset }) {
  if (!rootIds.length) {
    return { rows: [], total: 0 };
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  let where = '';
  let params = [];
  if (type === 'photos') {
    where = `${rootClause} AND name LIKE ? AND (mime LIKE 'image/%' OR mime LIKE 'video/%')${prefixClause}`;
    params = [...rootIds, like];
  } else if (type === 'music') {
    where = `${rootClause} AND (name LIKE ? OR title LIKE ? OR artist LIKE ? OR album LIKE ?) AND mime LIKE 'audio/%'${prefixClause}`;
    params = [...rootIds, like, like, like, like];
  } else {
    where = `${rootClause} AND name LIKE ?${prefixClause}`;
    params = [...rootIds, like];
  }
  if (prefixLike) {
    params.push(prefixLike);
  }
  const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${where}`;
  const total = db.prepare(countSql).get(...params)?.count || 0;
  const orderBy =
    type === 'photos' || type === 'music'
      ? 'ORDER BY mtime DESC, name COLLATE NOCASE'
      : 'ORDER BY is_dir DESC, name COLLATE NOCASE';
  const dataSql = `
    ${entrySelect}
    WHERE ${where}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);
  return { rows, total };
}

function listAlbumsAll({ db, rootIds, prefixLike, limit, offset }) {
  if (!rootIds.length) {
    return { rows: [], total: 0 };
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootClause} AND is_dir = 0 AND mime LIKE 'audio/%'${prefixClause}`;
  const params = [...rootIds];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const dataSql = `
    SELECT album_key, album, artist, COUNT(*) as tracks, MAX(mtime) as latest
    FROM entries
    WHERE ${baseWhere}
    GROUP BY album_key, album, artist
    ORDER BY latest DESC, album COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);
  const countSql = `
    SELECT COUNT(*) as count
    FROM (
      SELECT album_key
      FROM entries
      WHERE ${baseWhere}
      GROUP BY album_key
    ) AS albums
  `;
  const total = db.prepare(countSql).get(...params)?.count || 0;
  return { rows, total };
}

function listArtistsAll({ db, rootIds, prefixLike, limit, offset }) {
  if (!rootIds.length) {
    return { rows: [], total: 0 };
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootClause} AND is_dir = 0 AND mime LIKE 'audio/%'${prefixClause}`;
  const params = [...rootIds];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const dataSql = `
    SELECT artist, COUNT(*) as tracks, COUNT(DISTINCT album_key) as albums, MAX(mtime) as latest
    FROM entries
    WHERE ${baseWhere}
    GROUP BY artist
    ORDER BY latest DESC, artist COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);
  const countSql = `
    SELECT COUNT(*) as count
    FROM (
      SELECT artist
      FROM entries
      WHERE ${baseWhere}
      GROUP BY artist
    ) AS artists
  `;
  const total = db.prepare(countSql).get(...params)?.count || 0;
  return { rows, total };
}

function listAlbumTracksAll({ db, entrySelect, rootIds, albumKey, prefixLike }) {
  if (!rootIds.length) {
    return [];
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootClause} AND album_key = ? AND is_dir = 0 AND mime LIKE 'audio/%'${prefixClause}`;
  const params = [...rootIds, albumKey];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const sql = `
    ${entrySelect}
    WHERE ${baseWhere}
    ORDER BY name COLLATE NOCASE
  `;
  return db.prepare(sql).all(...params);
}

function listArtistTracksAll({ db, entrySelect, rootIds, artist, prefixLike }) {
  if (!rootIds.length) {
    return [];
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootClause} AND artist = ? AND is_dir = 0 AND mime LIKE 'audio/%'${prefixClause}`;
  const params = [...rootIds, artist];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const sql = `
    ${entrySelect}
    WHERE ${baseWhere}
    ORDER BY album COLLATE NOCASE, name COLLATE NOCASE
  `;
  return db.prepare(sql).all(...params);
}

module.exports = {
  listMediaAll,
  searchAll,
  listAlbumsAll,
  listArtistsAll,
  listAlbumTracksAll,
  listArtistTracksAll,
};
