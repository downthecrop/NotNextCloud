const Database = require('better-sqlite3');

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
    CREATE INDEX IF NOT EXISTS idx_entries_root_parent ON entries (root_id, parent);
    CREATE INDEX IF NOT EXISTS idx_entries_root_name ON entries (root_id, name);
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
  `);

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

  const listChildren = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ? AND parent = ?
    ORDER BY is_dir DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countChildren = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ? AND parent = ?
  `);

  const searchByName = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ? AND name LIKE ?
    ORDER BY is_dir DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countSearch = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ? AND name LIKE ?
  `);

  const listPhotos = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countPhotos = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
  `);

  const listPhotosByPrefix = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
      AND rel_path LIKE ?
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countPhotosByPrefix = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
      AND rel_path LIKE ?
  `);

  const listMusic = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countMusic = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
  `);

  const listMusicByPrefix = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
      AND rel_path LIKE ?
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countMusicByPrefix = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
      AND rel_path LIKE ?
  `);

  const searchPhotos = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND name LIKE ?
      AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countSearchPhotos = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ?
      AND name LIKE ?
      AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
  `);

  const searchPhotosByPrefix = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND name LIKE ?
      AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
      AND rel_path LIKE ?
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countSearchPhotosByPrefix = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ?
      AND name LIKE ?
      AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
      AND rel_path LIKE ?
  `);

  const searchMusic = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND (
        name LIKE ?
        OR title LIKE ?
        OR artist LIKE ?
        OR album LIKE ?
      )
      AND mime LIKE 'audio/%'
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countSearchMusic = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ?
      AND (
        name LIKE ?
        OR title LIKE ?
        OR artist LIKE ?
        OR album LIKE ?
      )
      AND mime LIKE 'audio/%'
  `);

  const searchMusicByPrefix = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir, title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND (
        name LIKE ?
        OR title LIKE ?
        OR artist LIKE ?
        OR album LIKE ?
      )
      AND mime LIKE 'audio/%'
      AND rel_path LIKE ?
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `);

  const countSearchMusicByPrefix = db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE root_id = ?
      AND (
        name LIKE ?
        OR title LIKE ?
        OR artist LIKE ?
        OR album LIKE ?
      )
      AND mime LIKE 'audio/%'
      AND rel_path LIKE ?
  `);

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

  const listAlbumTracks = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir,
      title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND album_key = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
    ORDER BY name COLLATE NOCASE
  `);

  const listAlbumTracksByPrefix = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir,
      title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND album_key = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
      AND rel_path LIKE ?
    ORDER BY name COLLATE NOCASE
  `);

  const listArtistTracks = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir,
      title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND artist = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
    ORDER BY album COLLATE NOCASE, name COLLATE NOCASE
  `);

  const listArtistTracksByPrefix = db.prepare(`
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir,
      title, artist, album, duration, album_key
    FROM entries
    WHERE root_id = ?
      AND artist = ?
      AND is_dir = 0
      AND mime LIKE 'audio/%'
      AND rel_path LIKE ?
    ORDER BY album COLLATE NOCASE, name COLLATE NOCASE
  `);

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
    SELECT root_id, rel_path, parent, name, ext, size, mtime, mime, is_dir,
      title, artist, album, duration, album_key, content_hash, hash_alg, inode, device
    FROM entries
    WHERE root_id = ? AND rel_path = ?
  `);

  const touchEntry = db.prepare(`
    UPDATE entries
    SET scan_id = ?
    WHERE root_id = ? AND rel_path = ?
  `);

  const cleanupOld = db.prepare(`
    DELETE FROM entries
    WHERE root_id = ? AND scan_id != ?
  `);

  return {
    db,
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
    cleanupOld,
  };
}

module.exports = {
  initDb,
};
