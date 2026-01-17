const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const { normalizeParent } = require('./utils');

let musicMetadata = null;
let musicMetadataLoading = null;

async function getMusicMetadata() {
  if (musicMetadata !== null) {
    return musicMetadata;
  }
  if (!musicMetadataLoading) {
    musicMetadataLoading = (async () => {
      try {
        const mod = await import('music-metadata');
        return mod.parseFile ? mod : mod.default || null;
      } catch {
        return null;
      }
    })();
  }
  musicMetadata = await musicMetadataLoading;
  return musicMetadata;
}

function albumKeyFor(artist, album) {
  const safeArtist = artist || 'Unknown Artist';
  const safeAlbum = album || 'Unknown Album';
  return crypto
    .createHash('sha1')
    .update(`${safeArtist.toLowerCase()}::${safeAlbum.toLowerCase()}`)
    .digest('hex');
}

async function ensureDir(targetPath) {
  if (!targetPath) {
    return;
  }
  await fs.promises.mkdir(targetPath, { recursive: true });
}

async function writeAlbumArt({ albumKey, album, artist, picture, albumArtDir, db, logger }) {
  if (!picture?.data || !albumArtDir) {
    return;
  }
  const existing = db.getAlbumArt.get(albumKey);
  if (existing?.path) {
    return;
  }
  try {
    await ensureDir(albumArtDir);
    const extension = mime.extension(picture.format || '') || 'jpg';
    const filePath = path.join(albumArtDir, `${albumKey}.${extension}`);
    await fs.promises.writeFile(filePath, picture.data);
    db.upsertAlbumArt.run({
      album_key: albumKey,
      album,
      artist,
      path: filePath,
      updated_at: Date.now(),
    });
  } catch (error) {
    logger?.warn?.({ err: error }, 'Failed to write album art');
  }
}

const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const coverNames = new Set(['cover', 'folder', 'album', 'artwork', 'front']);

function pickFolderArt(dirents, rootPath, relPath) {
  const candidates = [];
  for (const dirent of dirents) {
    if (!dirent.isFile()) {
      continue;
    }
    const ext = path.extname(dirent.name).toLowerCase();
    if (!imageExts.has(ext)) {
      continue;
    }
    const base = path.parse(dirent.name).name.toLowerCase();
    let score = 0;
    if (coverNames.has(base)) {
      score = 100;
    } else if (base.includes('cover') || base.includes('album') || base.includes('art')) {
      score = 60;
    }
    candidates.push({ name: dirent.name, score });
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  const pick = candidates[0];
  if (!pick) {
    return null;
  }
  return path.join(rootPath, relPath, pick.name);
}

async function walkDir(rootId, rootPath, relPath, scanId, db, logger, albumArtDir) {
  let dirents;
  try {
    dirents = await fs.promises.readdir(path.join(rootPath, relPath), {
      withFileTypes: true,
    });
  } catch (error) {
    logger?.warn?.({ err: error, relPath }, 'Failed to read directory');
    return;
  }

  const folderArtPath = pickFolderArt(dirents, rootPath, relPath);

  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) {
      continue;
    }

    const entryRel = relPath ? path.join(relPath, dirent.name) : dirent.name;
    const entryFull = path.join(rootPath, entryRel);
    let stats;
    try {
      stats = await fs.promises.stat(entryFull);
    } catch (error) {
      logger?.warn?.({ err: error, entryRel }, 'Failed to stat entry');
      continue;
    }

    const isDir = dirent.isDirectory();
    const ext = isDir ? '' : path.extname(dirent.name).toLowerCase();
    let mimeType = isDir ? null : mime.lookup(ext);
    if (!mimeType && ext === '.opus') {
      mimeType = 'audio/opus';
    }
    const safeMime = isDir ? null : mimeType || 'application/octet-stream';
    const parent = normalizeParent(entryRel);
    let title = null;
    let artist = null;
    let album = null;
    let duration = null;
    let albumKey = null;

    if (!isDir && safeMime && safeMime.startsWith('audio/')) {
      const metadataLib = await getMusicMetadata();
      if (metadataLib) {
        try {
          const metadata = await metadataLib.parseFile(entryFull, { duration: true });
          const common = metadata.common || {};
          const rawTitle = common.title || '';
          const rawArtist = common.artist || (Array.isArray(common.artists) ? common.artists[0] : '');
          const rawAlbum = common.album || '';
          const parentFolder = parent ? path.basename(parent) : '';
          title = rawTitle || path.parse(dirent.name).name;
          artist = rawArtist || 'Unknown Artist';
          album = rawAlbum || parentFolder || 'Unknown Album';
          duration = metadata.format?.duration || null;
          albumKey = albumKeyFor(artist, album);

          if (Array.isArray(common.picture) && common.picture.length && albumKey) {
            await writeAlbumArt({
              albumKey,
              album,
              artist,
              picture: common.picture[0],
              albumArtDir,
              db,
              logger,
            });
          }
        } catch (error) {
          logger?.warn?.({ err: error, entryRel }, 'Failed to parse audio metadata');
          const parentFolder = parent ? path.basename(parent) : '';
          title = path.parse(dirent.name).name;
          artist = 'Unknown Artist';
          album = parentFolder || 'Unknown Album';
          albumKey = albumKeyFor(artist, album);
        }
      } else {
        const parentFolder = parent ? path.basename(parent) : '';
        title = path.parse(dirent.name).name;
        artist = 'Unknown Artist';
        album = parentFolder || 'Unknown Album';
        albumKey = albumKeyFor(artist, album);
      }

      if (albumKey && folderArtPath) {
        const existing = db.getAlbumArt.get(albumKey);
        if (!existing?.path) {
          db.upsertAlbumArt.run({
            album_key: albumKey,
            album,
            artist,
            path: folderArtPath,
            updated_at: Date.now(),
          });
        }
      }
    }

    db.upsertEntry.run({
      root_id: rootId,
      rel_path: entryRel,
      parent,
      name: dirent.name,
      ext,
      size: isDir ? 0 : stats.size,
      mtime: Math.floor(stats.mtimeMs),
      mime: safeMime,
      is_dir: isDir ? 1 : 0,
      scan_id: scanId,
      title,
      artist,
      album,
      duration,
      album_key: albumKey,
    });

    if (isDir) {
      await walkDir(rootId, rootPath, entryRel, scanId, db, logger, albumArtDir);
    }
  }
}

async function scanRoot(root, scanId, db, logger, previewDir) {
  if (!root.absPath) {
    logger?.warn?.({ root }, 'Root path missing');
    return;
  }

  try {
    await fs.promises.access(root.absPath, fs.constants.R_OK);
  } catch (error) {
    logger?.warn?.({ err: error, root: root.absPath }, 'Root not accessible');
    return;
  }

  let rootStats;
  try {
    rootStats = await fs.promises.stat(root.absPath);
  } catch (error) {
    logger?.warn?.({ err: error, root: root.absPath }, 'Failed to stat root');
    return;
  }

  db.upsertEntry.run({
    root_id: root.id,
    rel_path: '',
    parent: null,
    name: root.name,
    ext: '',
    size: rootStats.isDirectory() ? 0 : rootStats.size,
    mtime: Math.floor(rootStats.mtimeMs),
    mime: null,
    is_dir: rootStats.isDirectory() ? 1 : 0,
    scan_id: scanId,
    title: null,
    artist: null,
    album: null,
    duration: null,
    album_key: null,
  });

  if (rootStats.isDirectory()) {
    const albumArtDir = previewDir ? path.join(previewDir, 'album-art') : null;
    await walkDir(root.id, root.absPath, '', scanId, db, logger, albumArtDir);
  }

  db.cleanupOld.run(root.id, scanId);
}

function createIndexer(config, db, logger) {
  let scanInProgress = false;
  let scanId = Date.now();
  let lastScanAt = null;

  const scanAll = async () => {
    if (scanInProgress) {
      return;
    }
    scanInProgress = true;
    scanId += 1;

    for (const root of config.roots) {
      await scanRoot(root, scanId, db, logger, config.previewDir);
    }

    lastScanAt = Date.now();
    scanInProgress = false;
  };

  const start = () => {
    scanAll().catch((error) => logger?.error?.({ err: error }, 'Initial scan failed'));
    const intervalMs = Math.max(10, config.scanIntervalSeconds || 60) * 1000;
    return setInterval(() => {
      scanAll().catch((error) => logger?.error?.({ err: error }, 'Periodic scan failed'));
    }, intervalMs);
  };

  return {
    scanAll,
    start,
    getStatus: () => ({
      lastScanAt,
      scanInProgress,
      scanIntervalSeconds: config.scanIntervalSeconds || 60,
    }),
  };
}

module.exports = {
  createIndexer,
};
