function listMediaAll({ db, entrySelect, rootIds, type, prefixLike, limit, offset, includeTotal }) {
  if (!rootIds.length) {
    return { rows: [], total: includeTotal === false ? null : 0 };
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
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
    total = db.prepare(countSql).get(...params)?.count || 0;
  } else {
    total = null;
  }
  const dataSql = `
    ${entrySelect}
    WHERE ${baseWhere}
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);
  return { rows, total };
}

function applyNameCursor({ where, params, cursor, prefix = '' }) {
  if (!cursor) {
    return { where, params };
  }
  const col = (name) => (prefix ? `${prefix}.${name}` : name);
  where += ` AND (
    ${col('is_dir')} < ?
    OR (${col('is_dir')} = ? AND ${col('name')} COLLATE NOCASE > ?)
    OR (${col('is_dir')} = ? AND ${col('name')} COLLATE NOCASE = ? AND ${col('root_id')} > ?)
    OR (${col('is_dir')} = ? AND ${col('name')} COLLATE NOCASE = ? AND ${col('root_id')} = ? AND ${col('rel_path')} > ?)
  )`;
  params.push(
    cursor.isDir,
    cursor.isDir,
    cursor.name,
    cursor.isDir,
    cursor.name,
    cursor.rootId,
    cursor.isDir,
    cursor.name,
    cursor.rootId,
    cursor.path
  );
  return { where, params };
}

function applyMtimeCursor({ where, params, cursor, prefix = '' }) {
  if (!cursor) {
    return { where, params };
  }
  const col = (name) => (prefix ? `${prefix}.${name}` : name);
  where += ` AND (
    ${col('mtime')} < ?
    OR (${col('mtime')} = ? AND ${col('name')} COLLATE NOCASE > ?)
    OR (${col('mtime')} = ? AND ${col('name')} COLLATE NOCASE = ? AND ${col('root_id')} > ?)
    OR (${col('mtime')} = ? AND ${col('name')} COLLATE NOCASE = ? AND ${col('root_id')} = ? AND ${col('rel_path')} > ?)
  )`;
  params.push(
    cursor.mtime,
    cursor.mtime,
    cursor.name,
    cursor.mtime,
    cursor.name,
    cursor.rootId,
    cursor.mtime,
    cursor.name,
    cursor.rootId,
    cursor.path
  );
  return { where, params };
}

function listChildrenCursor({ db, entrySelect, rootId, parent, limit, cursor }) {
  const orderBy = 'ORDER BY is_dir DESC, name COLLATE NOCASE, rel_path';
  let where = 'root_id = ? AND parent = ?';
  const params = [rootId, parent];
  if (cursor) {
    where += ` AND (
      is_dir < ?
      OR (is_dir = ? AND name COLLATE NOCASE > ?)
      OR (is_dir = ? AND name COLLATE NOCASE = ? AND rel_path > ?)
    )`;
    params.push(cursor.isDir, cursor.isDir, cursor.name, cursor.isDir, cursor.name, cursor.path);
  }
  const sql = `
    ${entrySelect}
    WHERE ${where}
    ${orderBy}
    LIMIT ?
  `;
  return db.prepare(sql).all(...params, limit);
}

function listChildrenAll({ db, entrySelect, rootIds, parent, limit, offset, includeTotal }) {
  if (!rootIds.length) {
    return { rows: [], total: includeTotal === false ? null : 0 };
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const baseWhere = `root_id IN (${placeholders}) AND parent = ?`;
  const params = [...rootIds, parent];
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
    total = db.prepare(countSql).get(...params)?.count || 0;
  } else {
    total = null;
  }
  const dataSql = `
    ${entrySelect}
    WHERE ${baseWhere}
    ORDER BY is_dir DESC, name COLLATE NOCASE, root_id, rel_path
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);
  return { rows, total };
}

function listChildrenAllRaw({
  db,
  entrySelectWithId,
  rootIds,
  parent,
  limit,
  offset,
  includeTotal,
  maxId,
}) {
  if (!rootIds.length) {
    return { rows: [], total: includeTotal === false ? null : 0 };
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const maxClause = Number.isFinite(maxId) && maxId > 0 ? ' AND id <= ?' : '';
  const baseWhere = `root_id IN (${placeholders}) AND parent = ?${maxClause}`;
  const params = [...rootIds, parent];
  if (maxClause) {
    params.push(maxId);
  }
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
    total = db.prepare(countSql).get(...params)?.count || 0;
  } else {
    total = null;
  }
  const dataSql = `
    ${entrySelectWithId}
    WHERE ${baseWhere}
    ORDER BY id
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);
  return { rows, total };
}

function listChildrenAllRawCursor({
  db,
  entrySelectWithId,
  rootIds,
  parent,
  limit,
  cursor,
  includeTotal,
  maxId,
}) {
  if (!rootIds.length) {
    return { rows: [], total: includeTotal === false ? null : 0 };
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const maxClause = Number.isFinite(maxId) && maxId > 0 ? ' AND id <= ?' : '';
  const baseWhere = `root_id IN (${placeholders}) AND parent = ?${maxClause}`;
  const baseParams = [...rootIds, parent];
  if (maxClause) {
    baseParams.push(maxId);
  }
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
    total = db.prepare(countSql).get(...baseParams)?.count || 0;
  } else {
    total = null;
  }
  const dataSql = `
    ${entrySelectWithId}
    WHERE ${baseWhere} AND id > ?
    ORDER BY id
    LIMIT ?
  `;
  const rows = db.prepare(dataSql).all(...baseParams, cursor.id, limit);
  return { rows, total };
}

function getMaxId({ db, rootId, parent }) {
  const row = db
    .prepare('SELECT MAX(id) as maxId FROM entries WHERE root_id = ? AND parent = ?')
    .get(rootId, parent);
  return Number(row?.maxId) || 0;
}

function getMaxIdAll({ db, rootIds, parent }) {
  if (!rootIds.length) {
    return 0;
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const sql = `SELECT MAX(id) as maxId FROM entries WHERE root_id IN (${placeholders}) AND parent = ?`;
  const row = db.prepare(sql).get(...rootIds, parent);
  return Number(row?.maxId) || 0;
}

function listChildrenAllCursor({ db, entrySelect, rootIds, parent, limit, cursor, includeTotal }) {
  if (!rootIds.length) {
    return { rows: [], total: includeTotal === false ? null : 0 };
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const baseWhere = `root_id IN (${placeholders}) AND parent = ?`;
  const baseParams = [...rootIds, parent];
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
    total = db.prepare(countSql).get(...baseParams)?.count || 0;
  } else {
    total = null;
  }
  let where = baseWhere;
  const dataParams = [...baseParams];
  ({ where, params: dataParams } = applyNameCursor({
    where,
    params: dataParams,
    cursor,
  }));
  const dataSql = `
    ${entrySelect}
    WHERE ${where}
    ORDER BY is_dir DESC, name COLLATE NOCASE, root_id, rel_path
    LIMIT ?
  `;
  const rows = db.prepare(dataSql).all(...dataParams, limit);
  return { rows, total };
}

function listMediaAllCursor({
  db,
  entrySelect,
  rootIds,
  type,
  prefixLike,
  limit,
  cursor,
  includeTotal,
}) {
  if (!rootIds.length) {
    return { rows: [], total: includeTotal === false ? null : 0 };
  }
  const typeFilter = type === 'photos'
    ? "(mime LIKE 'image/%' OR mime LIKE 'video/%')"
    : "mime LIKE 'audio/%'";
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootClause} AND is_dir = 0 AND ${typeFilter}${prefixClause}`;
  const baseParams = [...rootIds];
  if (prefixLike) {
    baseParams.push(prefixLike);
  }
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
    total = db.prepare(countSql).get(...baseParams)?.count || 0;
  } else {
    total = null;
  }
  let where = baseWhere;
  const dataParams = [...baseParams];
  ({ where, params: dataParams } = applyMtimeCursor({
    where,
    params: dataParams,
    cursor,
  }));
  const dataSql = `
    ${entrySelect}
    WHERE ${where}
    ORDER BY mtime DESC, name COLLATE NOCASE, root_id, rel_path
    LIMIT ?
  `;
  const rows = db.prepare(dataSql).all(...dataParams, limit);
  return { rows, total };
}

function sanitizeFtsTerm(term) {
  return (term || '')
    .replace(/["'`^~:\\/]/g, ' ')
    .replace(/[()]/g, ' ')
    .trim();
}

function buildFtsQuery(query, fields) {
  const terms = String(query || '')
    .trim()
    .split(/\s+/)
    .map((term) => sanitizeFtsTerm(term))
    .filter(Boolean);
  if (!terms.length) {
    return '';
  }
  return terms
    .map((term) => {
      const clauses = fields.map((field) => `${field}:${term}*`);
      if (clauses.length === 1) {
        return clauses[0];
      }
      return `(${clauses.join(' OR ')})`;
    })
    .join(' AND ');
}

function searchFtsAll({
  db,
  entryColumns,
  rootIds,
  type,
  ftsQuery,
  prefixLike,
  limit,
  offset,
  includeTotal,
}) {
  if (!rootIds.length || !ftsQuery) {
    return { rows: [], total: includeTotal === false ? null : 0 };
  }
  const select = `SELECT ${entryColumns.map((col) => `entries.${col}`).join(', ')} `;
  const join = 'FROM entries_fts JOIN entries ON entries.id = entries_fts.rowid';
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `entries.root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND entries.rel_path LIKE ?' : '';
  let typeClause = '';
  let orderBy = 'ORDER BY entries.is_dir DESC, entries.name COLLATE NOCASE';
  if (type === 'photos') {
    typeClause = " AND entries.is_dir = 0 AND (entries.mime LIKE 'image/%' OR entries.mime LIKE 'video/%')";
    orderBy = 'ORDER BY entries.mtime DESC, entries.name COLLATE NOCASE';
  } else if (type === 'music') {
    typeClause = " AND entries.is_dir = 0 AND entries.mime LIKE 'audio/%'";
    orderBy = 'ORDER BY entries.mtime DESC, entries.name COLLATE NOCASE';
  }
  const where = `entries_fts MATCH ? AND ${rootClause}${typeClause}${prefixClause}`;
  const params = [ftsQuery, ...rootIds];
  if (prefixLike) {
    params.push(prefixLike);
  }
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count ${join} WHERE ${where}`;
    total = db.prepare(countSql).get(...params)?.count || 0;
  } else {
    total = null;
  }
  const dataSql = `
    ${select}
    ${join}
    WHERE ${where}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);
  return { rows, total };
}

function searchFtsAllCursor({
  db,
  entryColumns,
  rootIds,
  type,
  ftsQuery,
  prefixLike,
  limit,
  cursor,
  includeTotal,
}) {
  if (!rootIds.length || !ftsQuery) {
    return { rows: [], total: includeTotal === false ? null : 0 };
  }
  const select = `SELECT ${entryColumns.map((col) => `entries.${col}`).join(', ')} `;
  const join = 'FROM entries_fts JOIN entries ON entries.id = entries_fts.rowid';
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `entries.root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND entries.rel_path LIKE ?' : '';
  let typeClause = '';
  let orderBy = 'ORDER BY entries.is_dir DESC, entries.name COLLATE NOCASE, entries.root_id, entries.rel_path';
  if (type === 'photos') {
    typeClause =
      " AND entries.is_dir = 0 AND (entries.mime LIKE 'image/%' OR entries.mime LIKE 'video/%')";
    orderBy = 'ORDER BY entries.mtime DESC, entries.name COLLATE NOCASE, entries.root_id, entries.rel_path';
  } else if (type === 'music') {
    typeClause = " AND entries.is_dir = 0 AND entries.mime LIKE 'audio/%'";
    orderBy = 'ORDER BY entries.mtime DESC, entries.name COLLATE NOCASE, entries.root_id, entries.rel_path';
  }
  const baseWhere = `entries_fts MATCH ? AND ${rootClause}${typeClause}${prefixClause}`;
  const baseParams = [ftsQuery, ...rootIds];
  if (prefixLike) {
    baseParams.push(prefixLike);
  }
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count ${join} WHERE ${baseWhere}`;
    total = db.prepare(countSql).get(...baseParams)?.count || 0;
  } else {
    total = null;
  }
  let where = baseWhere;
  const dataParams = [...baseParams];
  if (type === 'photos' || type === 'music') {
    ({ where, params: dataParams } = applyMtimeCursor({
      where,
      params: dataParams,
      cursor,
      prefix: 'entries',
    }));
  } else {
    ({ where, params: dataParams } = applyNameCursor({
      where,
      params: dataParams,
      cursor,
      prefix: 'entries',
    }));
  }
  const dataSql = `
    ${select}
    ${join}
    WHERE ${where}
    ${orderBy}
    LIMIT ?
  `;
  const rows = db.prepare(dataSql).all(...dataParams, limit);
  return { rows, total };
}

function searchAll({
  db,
  entrySelect,
  rootIds,
  type,
  like,
  prefixLike,
  limit,
  offset,
  includeTotal,
}) {
  if (!rootIds.length) {
    return { rows: [], total: includeTotal === false ? null : 0 };
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
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${where}`;
    total = db.prepare(countSql).get(...params)?.count || 0;
  } else {
    total = null;
  }
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

function searchAllCursor({
  db,
  entrySelect,
  rootIds,
  type,
  like,
  prefixLike,
  limit,
  cursor,
  includeTotal,
}) {
  if (!rootIds.length) {
    return { rows: [], total: includeTotal === false ? null : 0 };
  }
  const placeholders = rootIds.map(() => '?').join(', ');
  const rootClause = `root_id IN (${placeholders})`;
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  let baseWhere = '';
  let baseParams = [];
  let orderBy = 'ORDER BY is_dir DESC, name COLLATE NOCASE, root_id, rel_path';
  if (type === 'photos') {
    baseWhere = `${rootClause} AND name LIKE ? AND (mime LIKE 'image/%' OR mime LIKE 'video/%')${prefixClause}`;
    baseParams = [...rootIds, like];
    orderBy = 'ORDER BY mtime DESC, name COLLATE NOCASE, root_id, rel_path';
  } else if (type === 'music') {
    baseWhere = `${rootClause} AND (name LIKE ? OR title LIKE ? OR artist LIKE ? OR album LIKE ?) AND mime LIKE 'audio/%'${prefixClause}`;
    baseParams = [...rootIds, like, like, like, like];
    orderBy = 'ORDER BY mtime DESC, name COLLATE NOCASE, root_id, rel_path';
  } else {
    baseWhere = `${rootClause} AND name LIKE ?${prefixClause}`;
    baseParams = [...rootIds, like];
  }
  if (prefixLike) {
    baseParams.push(prefixLike);
  }
  let total = 0;
  if (includeTotal !== false) {
    const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
    total = db.prepare(countSql).get(...baseParams)?.count || 0;
  } else {
    total = null;
  }
  let where = baseWhere;
  const dataParams = [...baseParams];
  if (type === 'photos' || type === 'music') {
    ({ where, params: dataParams } = applyMtimeCursor({
      where,
      params: dataParams,
      cursor,
    }));
  } else {
    ({ where, params: dataParams } = applyNameCursor({
      where,
      params: dataParams,
      cursor,
    }));
  }
  const dataSql = `
    ${entrySelect}
    WHERE ${where}
    ${orderBy}
    LIMIT ?
  `;
  const rows = db.prepare(dataSql).all(...dataParams, limit);
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
  listChildrenCursor,
  listChildrenAll,
  listChildrenAllCursor,
  listChildrenAllRaw,
  listChildrenAllRawCursor,
  getMaxId,
  getMaxIdAll,
  listMediaAllCursor,
  searchAll,
  searchAllCursor,
  searchFtsAll,
  searchFtsAllCursor,
  buildFtsQuery,
  listAlbumsAll,
  listArtistsAll,
  listAlbumTracksAll,
  listArtistTracksAll,
};
