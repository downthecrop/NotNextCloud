const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fdir } = require('fdir');
const mime = require('mime-types');

const { normalizeParent, normalizeRelPath } = require('./utils');

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

function toStatNumber(value) {
  return Number.isFinite(value) ? value : null;
}

async function hashFile(fullPath, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(fullPath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
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

function scoreCoverCandidate(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (!imageExts.has(ext)) {
    return null;
  }
  const base = path.parse(fileName).name.toLowerCase();
  let score = 0;
  if (coverNames.has(base)) {
    score = 100;
  } else if (base.includes('cover') || base.includes('album') || base.includes('art')) {
    score = 60;
  }
  return { score, name: fileName };
}

function updateFolderArtMap(folderArt, parentRel, fileName, fullPath) {
  const candidate = scoreCoverCandidate(fileName);
  if (!candidate) {
    return;
  }
  const normalizedName = candidate.name.toLowerCase();
  const existing = folderArt.get(parentRel);
  if (
    !existing ||
    candidate.score > existing.score ||
    (candidate.score === existing.score && normalizedName < existing.name)
  ) {
    folderArt.set(parentRel, {
      score: candidate.score,
      path: fullPath,
      name: normalizedName,
    });
  }
}

function buildFolderArtMap(entries) {
  const folderArt = new Map();
  for (const entry of entries) {
    if (entry.isDir) {
      continue;
    }
    const parentRel = normalizeParent(entry.relPath);
    updateFolderArtMap(folderArt, parentRel, entry.name, entry.fullPath);
  }
  return folderArt;
}

async function buildFolderArtMapForDir(rootPath, relPath, logger) {
  const folderArt = new Map();
  const targetPath = relPath ? path.join(rootPath, relPath) : rootPath;
  let dirents;
  try {
    dirents = await fs.promises.readdir(targetPath, { withFileTypes: true });
  } catch (error) {
    logger?.warn?.({ err: error, relPath }, 'Failed to read directory');
    return folderArt;
  }
  for (const dirent of dirents) {
    if (!dirent.isFile()) {
      continue;
    }
    updateFolderArtMap(folderArt, relPath, dirent.name, path.join(targetPath, dirent.name));
  }
  return folderArt;
}

function isUnderSkipPrefix(relPath, skipPrefixes) {
  if (!relPath) {
    return false;
  }
  let current = relPath;
  while (current) {
    if (skipPrefixes.has(current)) {
      return true;
    }
    current = normalizeParent(current);
  }
  return false;
}

async function collectEntries(rootPath, targetPath, logger) {
  let fullPaths;
  try {
    fullPaths = await new fdir().withFullPaths().withDirs().crawl(targetPath).withPromise();
  } catch (error) {
    const relPath = normalizeRelPath(path.relative(rootPath, targetPath));
    logger?.warn?.({ err: error, relPath }, 'Failed to read directory');
    return [];
  }

  const entries = [];
  for (const fullPath of fullPaths) {
    let stats;
    try {
      stats = await fs.promises.lstat(fullPath);
    } catch (error) {
      logger?.warn?.({ err: error, fullPath }, 'Failed to stat entry');
      continue;
    }
    if (stats.isSymbolicLink()) {
      continue;
    }
    const relPath = normalizeRelPath(path.relative(rootPath, fullPath));
    if (!relPath) {
      continue;
    }
    entries.push({
      fullPath,
      relPath,
      name: path.basename(fullPath),
      stats,
      isDir: stats.isDirectory(),
    });
  }
  return entries;
}

async function processEntry({
  rootId,
  relPath,
  name,
  fullPath,
  stats,
  scanId,
  db,
  logger,
  albumArtDir,
  folderArtMap,
  scanOptions,
  existing,
  sameStat,
}) {
  const options = scanOptions || {};
  const hashAlgorithm = options.hashAlgorithm || 'sha256';
  const hashFiles = options.hashFiles !== false;
  const forceHash = Boolean(options.forceHash);

  const isDir = stats.isDirectory();
  const entrySize = isDir ? 0 : stats.size;
  const entryMtime = Math.floor(stats.mtimeMs);
  const entryInode = toStatNumber(stats.ino);
  const entryDevice = toStatNumber(stats.dev);
  const ext = isDir ? '' : path.extname(name).toLowerCase();
  let mimeType = isDir ? null : mime.lookup(ext);
  if (!mimeType && ext === '.opus') {
    mimeType = 'audio/opus';
  }
  const safeMime = isDir ? null : mimeType || 'application/octet-stream';
  const parent = normalizeParent(relPath);
  const existingEntry = existing ?? db.getEntry.get(rootId, relPath);
  const isSameStat =
    sameStat ??
    (existingEntry &&
      existingEntry.size === entrySize &&
      existingEntry.mtime === entryMtime &&
      existingEntry.is_dir === (isDir ? 1 : 0) &&
      (existingEntry.inode ?? null) === entryInode &&
      (existingEntry.device ?? null) === entryDevice);
  let title = null;
  let artist = null;
  let album = null;
  let duration = null;
  let albumKey = null;
  let contentHash = existingEntry?.content_hash || null;
  let hashAlg = existingEntry?.hash_alg || null;

  if (!isDir && safeMime && safeMime.startsWith('audio/')) {
    if (existingEntry && isSameStat) {
      title = existingEntry.title;
      artist = existingEntry.artist;
      album = existingEntry.album;
      duration = existingEntry.duration;
      albumKey = existingEntry.album_key;
    }
    if (!existingEntry || !isSameStat) {
      title = null;
      artist = null;
      album = null;
      duration = null;
      albumKey = null;
      const metadataLib = await getMusicMetadata();
      if (metadataLib) {
        try {
          const metadata = await metadataLib.parseFile(fullPath, { duration: true });
          const common = metadata.common || {};
          const rawTitle = common.title || '';
          const rawArtist = common.artist || (Array.isArray(common.artists) ? common.artists[0] : '');
          const rawAlbum = common.album || '';
          const parentFolder = parent ? path.basename(parent) : '';
          title = rawTitle || path.parse(name).name;
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
          logger?.warn?.({ err: error, relPath }, 'Failed to parse audio metadata');
          const parentFolder = parent ? path.basename(parent) : '';
          title = path.parse(name).name;
          artist = 'Unknown Artist';
          album = parentFolder || 'Unknown Album';
          albumKey = albumKeyFor(artist, album);
        }
      } else {
        const parentFolder = parent ? path.basename(parent) : '';
        title = path.parse(name).name;
        artist = 'Unknown Artist';
        album = parentFolder || 'Unknown Album';
        albumKey = albumKeyFor(artist, album);
      }
    }

    const folderArtPath = folderArtMap?.get(parent)?.path || null;
    if (albumKey && folderArtPath) {
      const existingArt = db.getAlbumArt.get(albumKey);
      if (!existingArt?.path) {
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

  const needsHash =
    hashFiles &&
    !isDir &&
    (forceHash || !isSameStat || !contentHash || hashAlg !== hashAlgorithm);
  if (!isDir && needsHash) {
    try {
      contentHash = await hashFile(fullPath, hashAlgorithm);
      hashAlg = hashAlgorithm;
    } catch (error) {
      logger?.warn?.({ err: error, relPath }, 'Failed to hash file');
    }
  }
  if (!hashFiles && !isSameStat) {
    contentHash = null;
    hashAlg = null;
  }

  if (isSameStat && !needsHash && (!isDir || existingEntry)) {
    db.touchEntry.run(scanId, rootId, relPath);
  } else {
    db.upsertEntry.run({
      root_id: rootId,
      rel_path: relPath,
      parent,
      name,
      ext,
      size: entrySize,
      mtime: entryMtime,
      mime: safeMime,
      is_dir: isDir ? 1 : 0,
      scan_id: scanId,
      title,
      artist,
      album,
      duration,
      album_key: albumKey,
      content_hash: contentHash,
      hash_alg: hashAlg,
      inode: entryInode,
      device: entryDevice,
    });
  }
}

async function scanDirectory(rootId, rootPath, relPath, scanId, db, logger, albumArtDir, scanOptions) {
  const options = scanOptions || {};
  const fastScan = Boolean(options.fastScan);
  const targetPath = relPath ? path.join(rootPath, relPath) : rootPath;
  const entries = await collectEntries(rootPath, targetPath, logger);
  const folderArtMap = buildFolderArtMap(entries);
  const skipPrefixes = new Set();
  const dirEntries = entries.filter((entry) => entry.isDir);
  const fileEntries = entries.filter((entry) => !entry.isDir);

  dirEntries.sort((a, b) => {
    const depthA = a.relPath.split(/[\\/]/).length;
    const depthB = b.relPath.split(/[\\/]/).length;
    if (depthA !== depthB) {
      return depthA - depthB;
    }
    return a.relPath.localeCompare(b.relPath);
  });

  for (const entry of dirEntries) {
    if (fastScan && isUnderSkipPrefix(entry.relPath, skipPrefixes)) {
      continue;
    }
    const entryMtime = Math.floor(entry.stats.mtimeMs);
    const entryInode = toStatNumber(entry.stats.ino);
    const entryDevice = toStatNumber(entry.stats.dev);
    const existing = db.getEntry.get(rootId, entry.relPath);
    const sameStat =
      existing &&
      existing.size === 0 &&
      existing.mtime === entryMtime &&
      existing.is_dir === 1 &&
      (existing.inode ?? null) === entryInode &&
      (existing.device ?? null) === entryDevice;

    if (fastScan && sameStat) {
      db.touchPrefix.run(scanId, rootId, entry.relPath, `${entry.relPath}/%`);
      skipPrefixes.add(entry.relPath);
      continue;
    }

    await processEntry({
      rootId,
      relPath: entry.relPath,
      name: entry.name,
      fullPath: entry.fullPath,
      stats: entry.stats,
      scanId,
      db,
      logger,
      albumArtDir,
      folderArtMap,
      scanOptions,
      existing,
      sameStat,
    });
  }

  for (const entry of fileEntries) {
    if (fastScan && isUnderSkipPrefix(entry.relPath, skipPrefixes)) {
      continue;
    }
    await processEntry({
      rootId,
      relPath: entry.relPath,
      name: entry.name,
      fullPath: entry.fullPath,
      stats: entry.stats,
      scanId,
      db,
      logger,
      albumArtDir,
      folderArtMap,
      scanOptions,
    });
  }
}

async function scanRoot(root, scanId, db, logger, previewDir, scanOptions) {
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
    content_hash: null,
    hash_alg: null,
    inode: toStatNumber(rootStats.ino),
    device: toStatNumber(rootStats.dev),
  });

  if (rootStats.isDirectory()) {
    const albumArtDir = previewDir ? path.join(previewDir, 'album-art') : null;
    await scanDirectory(root.id, root.absPath, '', scanId, db, logger, albumArtDir, scanOptions);
  }

  db.cleanupOld.run(root.id, scanId);
}

function createIndexer(config, db, logger) {
  let scanInProgress = false;
  let scanId = Date.now();
  let lastScanAt = null;
  let scanTimer = null;
  let fullScanTimer = null;

  const scanAll = async ({ forceHash = false, fastScan = false } = {}) => {
    if (scanInProgress) {
      return;
    }
    scanInProgress = true;
    scanId += 1;
    const scanOptions = {
      hashAlgorithm: config.hashAlgorithm || 'sha256',
      hashFiles: config.hashFiles !== false,
      forceHash,
      fastScan,
    };

    for (const root of config.roots) {
      await scanRoot(root, scanId, db, logger, config.previewDir, scanOptions);
    }

    lastScanAt = Date.now();
    scanInProgress = false;
  };

  const scanPath = async ({ root, relPath = '', forceHash = false, fastScan = false } = {}) => {
    if (scanInProgress) {
      return;
    }
    if (!root?.absPath) {
      return;
    }
    scanInProgress = true;
    scanId += 1;
    const scanOptions = {
      hashAlgorithm: config.hashAlgorithm || 'sha256',
      hashFiles: config.hashFiles !== false,
      forceHash,
      fastScan,
    };
    const normalized = relPath || '';
    const targetPath = path.join(root.absPath, normalized);
    let stats;
    try {
      stats = await fs.promises.stat(targetPath);
    } catch (error) {
      logger?.warn?.({ err: error, targetPath }, 'Scan path not accessible');
      scanInProgress = false;
      return;
    }
    const name = normalized ? path.basename(normalized) : root.name;
    const albumArtDir = config.previewDir ? path.join(config.previewDir, 'album-art') : null;
    let folderArtMap = null;
    if (!stats.isDirectory()) {
      const parentRel = normalizeParent(normalized);
      folderArtMap = await buildFolderArtMapForDir(root.absPath, parentRel, logger);
    }
    await processEntry({
      rootId: root.id,
      relPath: normalized,
      name,
      fullPath: targetPath,
      stats,
      scanId,
      db,
      logger,
      albumArtDir,
      folderArtMap,
      scanOptions,
    });
    if (stats.isDirectory()) {
      await scanDirectory(
        root.id,
        root.absPath,
        normalized,
        scanId,
        db,
        logger,
        albumArtDir,
        scanOptions
      );
      const prefixLike = normalized ? `${normalized}/%` : '%';
      if (normalized) {
        db.cleanupPrefix.run(root.id, normalized, prefixLike, scanId);
      } else {
        db.cleanupOld.run(root.id, scanId);
      }
    }
    lastScanAt = Date.now();
    scanInProgress = false;
  };

  const scheduleTimers = ({ runImmediate = false } = {}) => {
    if (scanTimer) {
      clearInterval(scanTimer);
    }
    if (fullScanTimer) {
      clearInterval(fullScanTimer);
    }
    if (runImmediate) {
      scanAll({ fastScan: config.fastScan }).catch((error) =>
        logger?.error?.({ err: error }, 'Initial scan failed')
      );
    }
    const intervalMs = Math.max(10, config.scanIntervalSeconds || 60) * 1000;
    scanTimer = setInterval(() => {
      scanAll({ fastScan: config.fastScan }).catch((error) =>
        logger?.error?.({ err: error }, 'Periodic scan failed')
      );
    }, intervalMs);
    const fullHours = Number(config.fullScanIntervalHours || 0);
    if (fullHours > 0) {
      const fullMs = Math.max(1, fullHours) * 60 * 60 * 1000;
      fullScanTimer = setInterval(() => {
        scanAll({ forceHash: true, fastScan: false }).catch((error) =>
          logger?.error?.({ err: error }, 'Full scan failed')
        );
      }, fullMs);
    }
  };

  const start = () => {
    scheduleTimers({ runImmediate: true });
  };

  return {
    scanAll,
    scanPath,
    start,
    reschedule: () => scheduleTimers({ runImmediate: false }),
    getStatus: () => ({
      lastScanAt,
      scanInProgress,
      scanIntervalSeconds: config.scanIntervalSeconds || 60,
      fastScan: Boolean(config.fastScan),
      fullScanIntervalHours: Number(config.fullScanIntervalHours || 0),
    }),
  };
}

module.exports = {
  createIndexer,
};
