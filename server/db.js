const Database = require('better-sqlite3');

const ENTRY_COLUMNS = [
  'root_id',
  'rel_path',
  'parent',
  'name',
  'ext',
  'size',
  'mtime',
  'mime',
  'is_dir',
  'title',
  'artist',
  'album',
  'duration',
  'album_key',
];
const ENTRY_DETAIL_COLUMNS = [...ENTRY_COLUMNS, 'content_hash', 'hash_alg', 'inode', 'device'];
const ENTRY_SELECT = `SELECT ${ENTRY_COLUMNS.join(', ')} FROM entries`;
const ENTRY_SELECT_WITH_ID = `SELECT id, ${ENTRY_COLUMNS.join(', ')} FROM entries`;
const ENTRY_DETAIL_SELECT = `SELECT ${ENTRY_DETAIL_COLUMNS.join(', ')} FROM entries`;
const ORDER_NAME = 'ORDER BY is_dir DESC, name COLLATE NOCASE';
const ORDER_MTIME = 'ORDER BY mtime DESC, name COLLATE NOCASE';
const ORDER_TRACK_NAME = 'ORDER BY name COLLATE NOCASE';
const ORDER_ARTIST_TRACK = 'ORDER BY album COLLATE NOCASE, name COLLATE NOCASE';
const WHERE_PHOTOS = "is_dir = 0 AND (mime LIKE 'image/%' OR mime LIKE 'video/%')";
const WHERE_MUSIC = "is_dir = 0 AND mime LIKE 'audio/%'";
const WHERE_MUSIC_SEARCH =
  "(name LIKE ? OR title LIKE ? OR artist LIKE ? OR album LIKE ?) AND mime LIKE 'audio/%'";

function entryListSql({ where, order, withPrefix = false }) {
  const prefixClause = withPrefix ? ' AND rel_path LIKE ?' : '';
  return `${ENTRY_SELECT} WHERE root_id = ? AND ${where}${prefixClause} ${order} LIMIT ? OFFSET ?`;
}

function entryCountSql({ where, withPrefix = false }) {
  const prefixClause = withPrefix ? ' AND rel_path LIKE ?' : '';
  return `SELECT COUNT(*) as count FROM entries WHERE root_id = ? AND ${where}${prefixClause}`;
}

function entrySelectSql({ where, order, withPrefix = false }) {
  const prefixClause = withPrefix ? ' AND rel_path LIKE ?' : '';
  return `${ENTRY_SELECT} WHERE root_id = ? AND ${where}${prefixClause} ${order}`;
}

function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      root_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      parent TEXT,
      name TEXT NOT NULL,
      ext TEXT,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      mime TEXT,
      is_dir INTEGER NOT NULL,
      scan_id INTEGER NOT NULL,
      title TEXT,
      artist TEXT,
      album TEXT,
      duration REAL,
      album_key TEXT,
      UNIQUE(root_id, rel_path)
    );
    CREATE TABLE IF NOT EXISTS album_art (
      album_key TEXT PRIMARY KEY,
      album TEXT,
      artist TEXT,
      path TEXT NOT NULL,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS trash_entries (
      id INTEGER PRIMARY KEY,
      root_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      name TEXT,
      ext TEXT,
      size INTEGER,
      mime TEXT,
      is_dir INTEGER NOT NULL,
      deleted_at INTEGER NOT NULL,
      trash_rel_path TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entries_root_parent ON entries (root_id, parent);
    CREATE INDEX IF NOT EXISTS idx_entries_root_name ON entries (root_id, name);
    CREATE INDEX IF NOT EXISTS idx_trash_root ON trash_entries (root_id, deleted_at);
  `);

  const columns = new Set(db.pragma('table_info(entries)').map((col) => col.name));
  const addColumn = (name, type) => {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE entries ADD COLUMN ${name} ${type}`);
      columns.add(name);
    }
  };
  addColumn('title', 'TEXT');
  addColumn('artist', 'TEXT');
  addColumn('album', 'TEXT');
  addColumn('duration', 'REAL');
  addColumn('album_key', 'TEXT');
  addColumn('content_hash', 'TEXT');
  addColumn('hash_alg', 'TEXT');
  addColumn('inode', 'INTEGER');
  addColumn('device', 'INTEGER');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_entries_root_album ON entries (root_id, album_key);
    CREATE INDEX IF NOT EXISTS idx_entries_root_artist ON entries (root_id, artist);
    CREATE INDEX IF NOT EXISTS idx_entries_hash ON entries (content_hash);
    CREATE INDEX IF NOT EXISTS idx_entries_root_rel ON entries (root_id, rel_path);
    CREATE INDEX IF NOT EXISTS idx_entries_root_mtime ON entries (root_id, mtime);
    CREATE INDEX IF NOT EXISTS idx_entries_root_parent_order
      ON entries (root_id, parent, is_dir DESC, name COLLATE NOCASE, rel_path);
    CREATE INDEX IF NOT EXISTS idx_entries_root_mtime_order
      ON entries (root_id, is_dir, mtime DESC, name COLLATE NOCASE, rel_path);
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      name,
      title,
      artist,
      album,
      root_id UNINDEXED,
      rel_path UNINDEXED,
      mime UNINDEXED,
      is_dir UNINDEXED,
      content='entries',
      content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts(rowid, name, title, artist, album, root_id, rel_path, mime, is_dir)
      VALUES (new.id, new.name, new.title, new.artist, new.album, new.root_id, new.rel_path, new.mime, new.is_dir);
    END;
    CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, name, title, artist, album, root_id, rel_path, mime, is_dir)
      VALUES ('delete', old.id, old.name, old.title, old.artist, old.album, old.root_id, old.rel_path, old.mime, old.is_dir);
    END;
    CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, name, title, artist, album, root_id, rel_path, mime, is_dir)
      VALUES ('delete', old.id, old.name, old.title, old.artist, old.album, old.root_id, old.rel_path, old.mime, old.is_dir);
      INSERT INTO entries_fts(rowid, name, title, artist, album, root_id, rel_path, mime, is_dir)
      VALUES (new.id, new.name, new.title, new.artist, new.album, new.root_id, new.rel_path, new.mime, new.is_dir);
    END;
  `);

  const ftsCount = db.prepare('SELECT COUNT(*) as count FROM entries_fts').get()?.count || 0;
  if (ftsCount === 0) {
    db.exec(`
      INSERT INTO entries_fts(rowid, name, title, artist, album, root_id, rel_path, mime, is_dir)
      SELECT id, name, title, artist, album, root_id, rel_path, mime, is_dir FROM entries
    `);
  }
  const ftsEnabled = true;

  const upsertEntry = db.prepare(`
    INSERT INTO entries (
      root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, scan_id,
      title, artist, album, duration, album_key, content_hash, hash_alg, inode, device
    ) VALUES (
      @root_id, @rel_path, @parent, @name, @ext, @size, @mtime, @mime, @is_dir, @scan_id,
      @title, @artist, @album, @duration, @album_key, @content_hash, @hash_alg, @inode, @device
    )
    ON CONFLICT(root_id, rel_path) DO UPDATE SET
      parent = excluded.parent,
      name = excluded.name,
      ext = excluded.ext,
      size = excluded.size,
      mtime = excluded.mtime,
      mime = excluded.mime,
      is_dir = excluded.is_dir,
      scan_id = excluded.scan_id,
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      duration = excluded.duration,
      album_key = excluded.album_key,
      content_hash = excluded.content_hash,
      hash_alg = excluded.hash_alg,
      inode = excluded.inode,
      device = excluded.device
  `);

  const listChildren = db.prepare(
    entryListSql({
      where: 'parent = ?',
      order: ORDER_NAME,
    })
  );

  const countChildren = db.prepare(
    entryCountSql({
      where: 'parent = ?',
    })
  );

  const searchByName = db.prepare(
    entryListSql({
      where: 'name LIKE ?',
      order: ORDER_NAME,
    })
  );

  const countSearch = db.prepare(
    entryCountSql({
      where: 'name LIKE ?',
    })
  );

  const listPhotos = db.prepare(
    entryListSql({
      where: WHERE_PHOTOS,
      order: ORDER_MTIME,
    })
  );

  const countPhotos = db.prepare(
    entryCountSql({
      where: WHERE_PHOTOS,
    })
  );

  const listPhotosByPrefix = db.prepare(
    entryListSql({
      where: WHERE_PHOTOS,
      order: ORDER_MTIME,
      withPrefix: true,
    })
  );

  const countPhotosByPrefix = db.prepare(
    entryCountSql({
      where: WHERE_PHOTOS,
      withPrefix: true,
    })
  );

  const listMusic = db.prepare(
    entryListSql({
      where: WHERE_MUSIC,
      order: ORDER_MTIME,
    })
  );

  const countMusic = db.prepare(
    entryCountSql({
      where: WHERE_MUSIC,
    })
  );

  const listMusicByPrefix = db.prepare(
    entryListSql({
      where: WHERE_MUSIC,
      order: ORDER_MTIME,
      withPrefix: true,
    })
  );

  const countMusicByPrefix = db.prepare(
    entryCountSql({
      where: WHERE_MUSIC,
      withPrefix: true,
    })
  );

  const searchPhotos = db.prepare(
    entryListSql({
      where: `name LIKE ? AND ${WHERE_PHOTOS}`,
      order: ORDER_MTIME,
    })
  );

  const countSearchPhotos = db.prepare(
    entryCountSql({
      where: `name LIKE ? AND ${WHERE_PHOTOS}`,
    })
  );

  const searchPhotosByPrefix = db.prepare(
    entryListSql({
      where: `name LIKE ? AND ${WHERE_PHOTOS}`,
      order: ORDER_MTIME,
      withPrefix: true,
    })
  );

  const countSearchPhotosByPrefix = db.prepare(
    entryCountSql({
      where: `name LIKE ? AND ${WHERE_PHOTOS}`,
      withPrefix: true,
    })
  );

  const searchMusic = db.prepare(
    entryListSql({
      where: WHERE_MUSIC_SEARCH,
      order: ORDER_MTIME,
    })
  );

  const countSearchMusic = db.prepare(
    entryCountSql({
      where: WHERE_MUSIC_SEARCH,
    })
  );

  const searchMusicByPrefix = db.prepare(
    entryListSql({
      where: WHERE_MUSIC_SEARCH,
      order: ORDER_MTIME,
      withPrefix: true,
    })
  );

  const countSearchMusicByPrefix = db.prepare(
    entryCountSql({
      where: WHERE_MUSIC_SEARCH,
      withPrefix: true,
    })
  );

  const listAlbums = db.prepare(`
    SELECT album_key, album, artist, COUNT(*) as tracks, MAX(mtime) as latest
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
    GROUP BY album_key, album, artist
    ORDER BY latest DESC, album COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countAlbums = db.prepare(`
    SELECT COUNT(*) as count
    FROM (
      SELECT album_key
      FROM entries
      WHERE root_id = ?
        AND is_dir = 0
        AND mime LIKE 'audio/%'
      GROUP BY album_key
    ) AS albums
  `);

  const listAlbumsByPrefix = db.prepare(`
    SELECT album_key, album, artist, COUNT(*) as tracks, MAX(mtime) as latest
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
      AND rel_path LIKE ?
    GROUP BY album_key, album, artist
    ORDER BY latest DESC, album COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countAlbumsByPrefix = db.prepare(`
    SELECT COUNT(*) as count
    FROM (
      SELECT album_key
      FROM entries
      WHERE root_id = ?
        AND is_dir = 0
        AND mime LIKE 'audio/%'
        AND rel_path LIKE ?
      GROUP BY album_key
    ) AS albums
  `);

  const listArtists = db.prepare(`
    SELECT artist, COUNT(*) as tracks, COUNT(DISTINCT album_key) as albums, MAX(mtime) as latest
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
    GROUP BY artist
    ORDER BY latest DESC, artist COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countArtists = db.prepare(`
    SELECT COUNT(*) as count
    FROM (
      SELECT artist
      FROM entries
      WHERE root_id = ?
        AND is_dir = 0
        AND mime LIKE 'audio/%'
      GROUP BY artist
    ) AS artists
  `);

  const listArtistsByPrefix = db.prepare(`
    SELECT artist, COUNT(*) as tracks, COUNT(DISTINCT album_key) as albums, MAX(mtime) as latest
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
      AND rel_path LIKE ?
    GROUP BY artist
    ORDER BY latest DESC, artist COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countArtistsByPrefix = db.prepare(`
    SELECT COUNT(*) as count
    FROM (
      SELECT artist
      FROM entries
      WHERE root_id = ?
        AND is_dir = 0
        AND mime LIKE 'audio/%'
        AND rel_path LIKE ?
      GROUP BY artist
    ) AS artists
  `);

  const listAlbumTracks = db.prepare(
    entrySelectSql({
      where: `album_key = ? AND ${WHERE_MUSIC}`,
      order: ORDER_TRACK_NAME,
    })
  );

  const listAlbumTracksByPrefix = db.prepare(
    entrySelectSql({
      where: `album_key = ? AND ${WHERE_MUSIC}`,
      order: ORDER_TRACK_NAME,
      withPrefix: true,
    })
  );

  const listArtistTracks = db.prepare(
    entrySelectSql({
      where: `artist = ? AND ${WHERE_MUSIC}`,
      order: ORDER_ARTIST_TRACK,
    })
  );

  const listArtistTracksByPrefix = db.prepare(
    entrySelectSql({
      where: `artist = ? AND ${WHERE_MUSIC}`,
      order: ORDER_ARTIST_TRACK,
      withPrefix: true,
    })
  );

  const upsertAlbumArt = db.prepare(`
    INSERT INTO album_art (album_key, album, artist, path, updated_at)
    VALUES (@album_key, @album, @artist, @path, @updated_at)
    ON CONFLICT(album_key) DO UPDATE SET
      album = excluded.album,
      artist = excluded.artist,
      path = excluded.path,
      updated_at = excluded.updated_at
  `);

  const getAlbumArt = db.prepare(`
    SELECT album_key, album, artist, path
    FROM album_art
    WHERE album_key = ?
  `);

  const getEntry = db.prepare(`
    ${ENTRY_DETAIL_SELECT}
    WHERE root_id = ? AND rel_path = ?
  `);

  const touchEntry = db.prepare(`
    UPDATE entries
    SET scan_id = ?
    WHERE root_id = ? AND rel_path = ?
  `);

  const touchPrefix = db.prepare(`
    UPDATE entries
    SET scan_id = ?
    WHERE root_id = ? AND (rel_path = ? OR rel_path LIKE ?)
  `);

  const touchAll = db.prepare(`
    UPDATE entries
    SET scan_id = ?
    WHERE root_id = ?
  `);

  const cleanupOld = db.prepare(`
    DELETE FROM entries
    WHERE root_id = ? AND scan_id != ?
  `);

  const cleanupPrefix = db.prepare(`
    DELETE FROM entries
    WHERE root_id = ?
      AND (rel_path = ? OR rel_path LIKE ?)
      AND scan_id != ?
  `);

  const insertTrashEntry = db.prepare(`
    INSERT INTO trash_entries (
      root_id, rel_path, name, ext, size, mime, is_dir, deleted_at, trash_rel_path
    ) VALUES (
      @root_id, @rel_path, @name, @ext, @size, @mime, @is_dir, @deleted_at, @trash_rel_path
    )
  `);

  const listTrashByRoot = db.prepare(`
    SELECT id, root_id, rel_path, name, ext, size, mime, is_dir, deleted_at, trash_rel_path
    FROM trash_entries
    WHERE root_id = ?
    ORDER BY deleted_at DESC
    LIMIT ? OFFSET ?
  `);

  const countTrashByRoot = db.prepare(`
    SELECT COUNT(*) as count FROM trash_entries WHERE root_id = ?
  `);

  const listTrashAll = db.prepare(`
    SELECT id, root_id, rel_path, name, ext, size, mime, is_dir, deleted_at, trash_rel_path
    FROM trash_entries
    ORDER BY deleted_at DESC
    LIMIT ? OFFSET ?
  `);

  const countTrashAll = db.prepare(`
    SELECT COUNT(*) as count FROM trash_entries
  `);

  const deleteTrashById = db.prepare(`
    DELETE FROM trash_entries WHERE id = ?
  `);

  const deleteEntryByPath = db.prepare(`
    DELETE FROM entries WHERE root_id = ? AND rel_path = ?
  `);

  const deleteEntriesByPrefix = db.prepare(`
    DELETE FROM entries
    WHERE root_id = ? AND (rel_path = ? OR rel_path LIKE ?)
  `);

  return {
    db,
    ftsEnabled,
    upsertEntry,
    listChildren,
    countChildren,
    searchByName,
    countSearch,
    listPhotos,
    countPhotos,
    listPhotosByPrefix,
    countPhotosByPrefix,
    listMusic,
    countMusic,
    listMusicByPrefix,
    countMusicByPrefix,
    searchPhotos,
    countSearchPhotos,
    searchPhotosByPrefix,
    countSearchPhotosByPrefix,
    searchMusic,
    countSearchMusic,
    searchMusicByPrefix,
    countSearchMusicByPrefix,
    listAlbums,
    countAlbums,
    listAlbumsByPrefix,
    countAlbumsByPrefix,
    listArtists,
    countArtists,
    listArtistsByPrefix,
    countArtistsByPrefix,
    listAlbumTracks,
    listAlbumTracksByPrefix,
    listArtistTracks,
    listArtistTracksByPrefix,
    upsertAlbumArt,
    getAlbumArt,
    getEntry,
    touchEntry,
    touchPrefix,
    touchAll,
    cleanupOld,
    cleanupPrefix,
    insertTrashEntry,
    listTrashByRoot,
    countTrashByRoot,
    listTrashAll,
    countTrashAll,
    deleteTrashById,
    deleteEntryByPath,
    deleteEntriesByPrefix,
  };
}

module.exports = {
  initDb,
  ENTRY_COLUMNS,
  ENTRY_SELECT,
  ENTRY_SELECT_WITH_ID,
  ENTRY_DETAIL_SELECT,
};
