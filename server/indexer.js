const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const { normalizeParent, normalizeRelPath } = require('./utils');
const { createAsyncQueue } = require('./lib/asyncQueue');
const { createBatchWriter } = require('./lib/indexer/batchWriter');
const { buildFolderArtMapForDir, updateFolderArtMap } = require('./lib/indexer/folderArt');
const { enrichAudioEntry } = require('./lib/indexer/audioEnrichment');

const IGNORED_ENTRY_NAMES = new Set(['.ds_store', '._.ds_store']);
const PREVIEW_CACHE_FILE_RE = /^[a-f0-9]{40}\.jpg$/i;

function toStatNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function isIgnoredEntryName(name) {
  return typeof name === 'string' && IGNORED_ENTRY_NAMES.has(name.toLowerCase());
}

async function countPreviewCacheFiles(previewDir) {
  if (!previewDir) {
    return 0;
  }
  let dirents;
  try {
    dirents = await fs.promises.readdir(previewDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const dirent of dirents) {
    if (dirent.isFile() && PREVIEW_CACHE_FILE_RE.test(dirent.name)) {
      count += 1;
    }
  }
  return count;
}

function updateProgress(progress, relPath, isDir) {
  if (!progress) {
    return;
  }
  progress.processedEntries += 1;
  if (isDir) {
    progress.processedDirs += 1;
  } else {
    progress.processedFiles += 1;
  }
  if (typeof relPath === 'string') {
    progress.currentPath = relPath;
  }
}

function hasMissingOrZeroDuration(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (value === 0) {
    return true;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return true;
    }
    const parsed = Number(trimmed);
    return !Number.isFinite(parsed) || parsed <= 0;
  }
  if (typeof value === 'number') {
    return !Number.isFinite(value) || value <= 0;
  }
  return false;
}

function hasTrimMismatch(value) {
  return typeof value === 'string' && value.trim() !== value;
}

function isSameNullableValue(left, right) {
  if (left === undefined || left === null || left === '') {
    return right === undefined || right === null || right === '';
  }
  if (right === undefined || right === null || right === '') {
    return false;
  }
  return left === right;
}

function isPreviewMimeType(mimeType) {
  return (
    typeof mimeType === 'string' &&
    (mimeType.startsWith('image/') || mimeType.startsWith('video/'))
  );
}

function createPreviewWarmup({
  config,
  previewQueue,
  previewCachePath,
  logger,
  enabled,
}) {
  if (
    !enabled ||
    typeof previewQueue !== 'function' ||
    typeof previewCachePath !== 'function'
  ) {
    return null;
  }
  const schedule = async ({ rootId, relPath, mtime, fullPath, mimeType, isDir }) => {
    if (isDir || !rootId || !relPath || !fullPath || !isPreviewMimeType(mimeType)) {
      return;
    }
    const previewPath = previewCachePath(config.previewDir, rootId, relPath, mtime);
    if (fs.existsSync(previewPath)) {
      return;
    }
    previewQueue(
      previewPath,
      { fullPath, previewPath, mimeType },
      { priority: 'low' }
    )
      .catch((error) => {
        logger?.debug?.({ err: error, rootId, relPath }, 'Preview warmup failed');
      });
  };

  return {
    schedule,
  };
}

function needsAudioMetadataBackfill({ existingEntry, isSameStat, safeMime, scanOptions }) {
  if (!existingEntry || !isSameStat) {
    return false;
  }
  if (!safeMime || !safeMime.startsWith('audio/')) {
    return false;
  }
  if (scanOptions?.extractAudioMetadata === false) {
    return false;
  }
  if (
    !existingEntry.title ||
    !existingEntry.artist ||
    !existingEntry.album ||
    !existingEntry.album_key ||
    hasTrimMismatch(existingEntry.title) ||
    hasTrimMismatch(existingEntry.artist) ||
    hasTrimMismatch(existingEntry.album)
  ) {
    return true;
  }
  return hasMissingOrZeroDuration(existingEntry.duration);
}

function buildAudioBackfillDirSet(db, rootId) {
  if (!db?.listAudioBackfillParents) {
    return null;
  }
  const rows = db.listAudioBackfillParents.all(rootId);
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  const dirs = new Set();
  for (const row of rows) {
    let current = typeof row?.parent === 'string' ? row.parent : '';
    while (true) {
      dirs.add(current);
      if (!current) {
        break;
      }
      const slash = current.lastIndexOf('/');
      current = slash === -1 ? '' : current.slice(0, slash);
    }
  }
  return dirs;
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
  writer,
}) {
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
  const existingEntry = existing === undefined ? db.getEntry.get(rootId, relPath) || null : existing;
  const isSameStat =
    sameStat ??
    (existingEntry &&
      existingEntry.size === entrySize &&
      existingEntry.mtime === entryMtime &&
      existingEntry.is_dir === (isDir ? 1 : 0) &&
      (existingEntry.inode ?? null) === entryInode &&
      (existingEntry.device ?? null) === entryDevice);
  const shouldBackfillAudioMetadata = needsAudioMetadataBackfill({
    existingEntry,
    isSameStat,
    safeMime,
    scanOptions,
  });
  const reuseExistingMetadata = isSameStat && !shouldBackfillAudioMetadata;
  let title = null;
  let artist = null;
  let album = null;
  let duration = null;
  let albumKey = null;
  ({ title, artist, album, duration, albumKey } = await enrichAudioEntry({
    safeMime,
    existingEntry,
    isSameStat: reuseExistingMetadata,
    extractMetadata: scanOptions?.extractAudioMetadata !== false,
    fullPath,
    fileSize: entrySize,
    relPath,
    parent,
    name,
    folderArtMap,
    albumArtDir,
    albumArtCache: scanOptions?.albumArtCache,
    db,
    logger,
  }));
  const metadataChangedOnSameStat =
    Boolean(existingEntry) &&
    Boolean(isSameStat) &&
    Boolean(safeMime && safeMime.startsWith('audio/')) &&
    (!isSameNullableValue(existingEntry.title, title) ||
      !isSameNullableValue(existingEntry.artist, artist) ||
      !isSameNullableValue(existingEntry.album, album) ||
      !isSameNullableValue(existingEntry.duration, duration) ||
      !isSameNullableValue(existingEntry.album_key, albumKey));

  if (reuseExistingMetadata && !metadataChangedOnSameStat && (!isDir || existingEntry)) {
    if (writer) {
      writer.enqueue(() => db.touchEntry.run(scanId, rootId, relPath));
    } else {
      db.touchEntry.run(scanId, rootId, relPath);
    }
  } else {
    const payload = {
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
      inode: entryInode,
      device: entryDevice,
    };
    if (writer) {
      writer.enqueue(() => db.upsertEntry.run(payload));
    } else {
      db.upsertEntry.run(payload);
    }
  }

  if (scanOptions?.previewWarmup?.schedule) {
    await scanOptions.previewWarmup.schedule({
      rootId,
      relPath,
      mtime: entryMtime,
      fullPath,
      mimeType: safeMime,
      isDir,
    });
  }
}

async function scanDirectory(
  rootId,
  rootPath,
  relPath,
  scanId,
  db,
  logger,
  albumArtDir,
  scanOptions,
  progress
) {
  const options = scanOptions || {};
  const fastScan = Boolean(options.fastScan);
  const batchSize = Number.isFinite(options.batchSize) ? options.batchSize : 1;
  const fsConcurrency = Number.isFinite(options.fsConcurrency) ? Math.max(1, options.fsConcurrency) : 1;
  const preloadMaxEntriesPerDir = Number.isFinite(options.preloadMaxEntriesPerDir)
    ? Math.max(0, options.preloadMaxEntriesPerDir)
    : 0;
  const writer = createBatchWriter(db, logger, batchSize, options.reportError);
  const enqueueFs = createAsyncQueue(fsConcurrency);
  const stack = [relPath || ''];

  while (stack.length) {
    const currentRel = stack.pop();
    const targetPath = currentRel ? path.join(rootPath, currentRel) : rootPath;
    let dirHandle;
    try {
      dirHandle = await fs.promises.opendir(targetPath);
    } catch (error) {
      const rel = normalizeRelPath(path.relative(rootPath, targetPath));
      logger?.warn?.({ err: error, relPath: rel }, 'Failed to read directory');
      options.reportError?.({
        error,
        operation: 'readdir',
        relPath: rel,
        fullPath: targetPath,
        rootId,
      });
      continue;
    }

    let existingByRelPath = null;
    if (preloadMaxEntriesPerDir > 0) {
      const existingCount = db.countChildren.get(rootId, currentRel || '')?.count || 0;
      if (existingCount <= preloadMaxEntriesPerDir) {
        existingByRelPath = new Map();
        const existingEntries = db.listScanEntriesByParent.all(rootId, currentRel || '');
        for (const row of existingEntries) {
          existingByRelPath.set(row.rel_path, row);
        }
      }
    }

    const folderArtMap = new Map();

    const resolveDirent = (dirent) =>
      enqueueFs(async () => {
        if (isIgnoredEntryName(dirent.name)) {
          return null;
        }
        if (dirent.isSymbolicLink()) {
          return null;
        }
        const fullPath = path.join(targetPath, dirent.name);
        try {
          const stats = await fs.promises.lstat(fullPath);
          if (stats.isSymbolicLink()) {
            return null;
          }
          return {
            dirent,
            fullPath,
            stats,
            nextRel: currentRel ? `${currentRel}/${dirent.name}` : dirent.name,
          };
        } catch (error) {
          logger?.warn?.({ err: error, fullPath }, 'Failed to stat entry');
          options.reportError?.({
            error,
            operation: 'lstat',
            relPath: currentRel ? `${currentRel}/${dirent.name}` : dirent.name,
            fullPath,
            rootId,
          });
          return null;
        }
      });

    const entryBatchSize = Math.max(32, fsConcurrency * 8);
    const processDirentBatch = async (batch) => {
      const filteredBatch = batch.filter((dirent) => !isIgnoredEntryName(dirent.name));
      for (const dirent of filteredBatch) {
        if (dirent.isFile()) {
          updateFolderArtMap(folderArtMap, currentRel, dirent.name, path.join(targetPath, dirent.name));
        }
      }

      const resolvedEntries = await Promise.all(filteredBatch.map((dirent) => resolveDirent(dirent)));
      for (const entry of resolvedEntries) {
        if (!entry) {
          continue;
        }
        const { dirent, fullPath, stats, nextRel } = entry;
        const existing =
          existingByRelPath !== null
            ? existingByRelPath.get(nextRel) || null
            : db.getEntry.get(rootId, nextRel) || null;
        updateProgress(progress, nextRel, stats.isDirectory());
        if (stats.isDirectory()) {
          const entryMtime = Math.floor(stats.mtimeMs);
          const entryInode = toStatNumber(stats.ino);
          const entryDevice = toStatNumber(stats.dev);
          const sameStat =
            existing &&
            existing.size === 0 &&
            existing.mtime === entryMtime &&
            existing.is_dir === 1 &&
            (existing.inode ?? null) === entryInode &&
            (existing.device ?? null) === entryDevice;

          const shouldForceScanDir = options.audioBackfillDirs?.has(nextRel);
          if (fastScan && sameStat && !shouldForceScanDir) {
            db.touchPrefix.run(scanId, rootId, nextRel, `${nextRel}/%`);
            continue;
          }

          await processEntry({
            rootId,
            relPath: nextRel,
            name: dirent.name,
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
            writer,
          });
          stack.push(nextRel);
          continue;
        }

        await processEntry({
          rootId,
          relPath: nextRel,
          name: dirent.name,
          fullPath,
          stats,
          scanId,
          db,
          logger,
          albumArtDir,
          folderArtMap,
          scanOptions,
          existing,
          writer,
        });
      }
    };

    try {
      let batch = [];
      for await (const dirent of dirHandle) {
        batch.push(dirent);
        if (batch.length >= entryBatchSize) {
          await processDirentBatch(batch);
          batch = [];
        }
      }
      if (batch.length) {
        await processDirentBatch(batch);
      }
    } finally {
      if (dirHandle) {
        try {
          await dirHandle.close();
        } catch {
          // opendir handles may already be closed by iterator completion
        }
      }
    }
  }

  writer.flush();
}

async function scanRoot(root, scanId, db, logger, previewDir, scanOptions, progress) {
  if (!root.absPath) {
    logger?.warn?.({ root }, 'Root path missing');
    return;
  }

  try {
    await fs.promises.access(root.absPath, fs.constants.R_OK);
  } catch (error) {
    logger?.warn?.({ err: error, root: root.absPath }, 'Root not accessible');
    scanOptions?.reportError?.({
      error,
      operation: 'root_access',
      rootId: root.id,
      rootName: root.name,
      fullPath: root.absPath,
    });
    return;
  }

  let rootStats;
  try {
    rootStats = await fs.promises.stat(root.absPath);
  } catch (error) {
    logger?.warn?.({ err: error, root: root.absPath }, 'Failed to stat root');
    scanOptions?.reportError?.({
      error,
      operation: 'root_stat',
      rootId: root.id,
      rootName: root.name,
      fullPath: root.absPath,
    });
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
    inode: toStatNumber(rootStats.ino),
    device: toStatNumber(rootStats.dev),
  });
  updateProgress(progress, '', rootStats.isDirectory());

  if (rootStats.isDirectory()) {
    if (scanOptions?.fastScan && scanOptions?.extractAudioMetadata !== false) {
      scanOptions.audioBackfillDirs = buildAudioBackfillDirSet(db, root.id);
    } else if (scanOptions) {
      scanOptions.audioBackfillDirs = null;
    }
    const albumArtDir = previewDir ? path.join(previewDir, 'album-art') : null;
    await scanDirectory(
      root.id,
      root.absPath,
      '',
      scanId,
      db,
      logger,
      albumArtDir,
      scanOptions,
      progress
    );
  }

  db.cleanupOld.run(root.id, scanId);
}

function createIndexer(config, db, logger, runtime = {}) {
  const { previewQueue = null, previewCachePath = null } = runtime;
  let scanInProgress = false;
  let scanId = Date.now();
  let lastScanAt = null;
  let scanTimer = null;
  let fullScanTimer = null;
  let progress = null;
  let lastScanStats = null;
  let scanErrorSeq = 0;
  let scanErrorCount = 0;
  let scanErrors = [];
  let rootScanStats = [];
  const countEntriesByRoot = db.db.prepare('SELECT COUNT(*) as count FROM entries WHERE root_id = ?');
  const countPreviewCandidates = db.db.prepare(`
    SELECT COUNT(*) as count
    FROM entries
    WHERE is_dir = 0 AND (mime LIKE 'image/%' OR mime LIKE 'video/%')
  `);
  const maxScanErrors = 50;
  const previewStatsMinRefreshMs = 15000;
  let previewStatsLastRefreshAt = 0;
  let previewStatsRefreshInFlight = null;
  let thumbnailStats = {
    created: null,
    cachedFiles: null,
    total: null,
    queued: 0,
    running: 0,
    workersTotal: 0,
    workersBusy: 0,
    lastUpdatedAt: null,
  };

  const estimateTotalForRoots = (roots) =>
    roots.reduce((sum, root) => sum + (countEntriesByRoot.get(root.id)?.count || 0), 0);

  const buildProgress = ({ mode, scope, expectedTotal, totalRoots }) => ({
    scanId,
    startedAt: Date.now(),
    mode,
    scope,
    expectedTotal: Number.isFinite(expectedTotal) ? expectedTotal : null,
    processedEntries: 0,
    processedFiles: 0,
    processedDirs: 0,
    currentRootId: null,
    currentRootName: null,
    currentPath: '',
    totalRoots: totalRoots || 0,
    currentRootIndex: 0,
  });

  const updatePreviewQueueStats = () => {
    const stats = previewQueue?.getStats?.();
    if (!stats) {
      thumbnailStats = {
        ...thumbnailStats,
        queued: 0,
        running: 0,
        workersTotal: 0,
        workersBusy: 0,
      };
      return;
    }
    thumbnailStats = {
      ...thumbnailStats,
      queued: Number(stats.queuedTotal || 0),
      running: Number(stats.runningJobs || 0),
      workersTotal: Number(stats.workersTotal || 0),
      workersBusy: Number(stats.workersBusy || 0),
    };
  };

  const refreshThumbnailStats = ({ force = false } = {}) => {
    updatePreviewQueueStats();
    if (previewStatsRefreshInFlight) {
      return previewStatsRefreshInFlight;
    }
    const now = Date.now();
    if (!force && now - previewStatsLastRefreshAt < previewStatsMinRefreshMs) {
      return null;
    }
    previewStatsLastRefreshAt = now;
    previewStatsRefreshInFlight = (async () => {
      const [cachedFiles, total] = await Promise.all([
        countPreviewCacheFiles(config.previewDir),
        Promise.resolve(countPreviewCandidates.get()?.count || 0),
      ]);
      const created = Number.isFinite(total) ? Math.min(cachedFiles, total) : cachedFiles;
      thumbnailStats = {
        ...thumbnailStats,
        created,
        cachedFiles,
        total,
        lastUpdatedAt: Date.now(),
      };
    })()
      .catch((error) => {
        logger?.debug?.({ err: error }, 'Failed to refresh thumbnail stats');
      })
      .finally(() => {
        previewStatsRefreshInFlight = null;
      });
    return previewStatsRefreshInFlight;
  };

  const createScanOptions = (fastScan) => {
    return {
      fastScan,
      batchSize: Number.isFinite(config.scanBatchSize) ? Math.max(1, config.scanBatchSize) : 1,
      fsConcurrency: Number.isFinite(config.scanFsConcurrency)
        ? Math.max(1, config.scanFsConcurrency)
        : 8,
      preloadMaxEntriesPerDir: Number.isFinite(config.scanPreloadMaxEntriesPerDir)
        ? Math.max(0, config.scanPreloadMaxEntriesPerDir)
        : 0,
      extractAudioMetadata: config.scanExtractAudioMetadata !== false,
      albumArtCache: new Map(),
      previewWarmup: createPreviewWarmup({
        config,
        previewQueue,
        previewCachePath,
        logger,
        enabled: true,
      }),
      reportError,
    };
  };

  const setProgressRoot = (root, index, currentPath = '') => {
    if (!progress) {
      return;
    }
    progress.currentRootId = root.id;
    progress.currentRootName = root.name;
    progress.currentRootIndex = index;
    progress.currentPath = currentPath;
  };

  const finalizeScanStats = ({ indexedTotal = null } = {}) => {
    lastScanAt = Date.now();
    if (!progress) {
      return;
    }
    lastScanStats = {
      scanId: progress.scanId,
      finishedAt: lastScanAt,
      durationMs: lastScanAt - progress.startedAt,
      mode: progress.mode,
      scope: progress.scope,
      processedEntries: progress.processedEntries,
      processedFiles: progress.processedFiles,
      processedDirs: progress.processedDirs,
      expectedTotal: progress.expectedTotal,
      indexedTotal,
      errorCount: scanErrors.filter((entry) => entry.scanId === progress.scanId).length,
      errorCodes: summarizeErrorCodes(scanErrors.filter((entry) => entry.scanId === progress.scanId)),
      roots: rootScanStats,
    };
  };

  const summarizeErrorCodes = (errors) => {
    if (!Array.isArray(errors) || !errors.length) {
      return [];
    }
    const counts = new Map();
    for (const entry of errors) {
      const code = entry?.code || 'UNKNOWN';
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 8);
  };

  const formatErrorMessage = (error) => {
    if (!error) {
      return 'Unknown indexing error';
    }
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }
    return String(error);
  };

  const reportError = ({
    error,
    operation = 'scan',
    rootId = null,
    rootName = null,
    relPath = '',
    fullPath = null,
  } = {}) => {
    const code = (error && typeof error.code === 'string' && error.code) || 'UNKNOWN';
    const message = formatErrorMessage(error);
    const at = Date.now();
    scanErrorSeq += 1;
    scanErrorCount += 1;
    scanErrors.push({
      id: `${at}-${scanErrorSeq}`,
      at,
      code,
      message,
      operation,
      scanId,
      mode: progress?.mode || null,
      rootId,
      rootName,
      relPath: relPath || '',
      fullPath: fullPath || null,
    });
    if (scanErrors.length > maxScanErrors) {
      scanErrors = scanErrors.slice(scanErrors.length - maxScanErrors);
    }
  };

  const runScan = async ({ mode, scope, expectedTotal, totalRoots, operation, onRun, onError }) => {
    if (scanInProgress) {
      return;
    }
    scanInProgress = true;
    scanId += 1;
    progress = buildProgress({ mode, scope, expectedTotal, totalRoots });
    rootScanStats = [];
    try {
      const result = await onRun();
      if (result?.skipFinalize) {
        return;
      }
      finalizeScanStats({ indexedTotal: result?.indexedTotal ?? null });
    } catch (error) {
      reportError({
        error,
        operation,
        ...(onError ? onError() : {}),
      });
      throw error;
    } finally {
      progress = null;
      scanInProgress = false;
    }
  };

  const scanAll = async ({ fastScan = false } = {}) => {
    const mode = fastScan ? 'fast' : 'full';
    await runScan({
      mode,
      scope: 'all',
      expectedTotal: estimateTotalForRoots(config.roots),
      totalRoots: config.roots.length,
      operation: 'scan_all',
      onRun: async () => {
        const scanOptions = createScanOptions(fastScan);
        let index = 0;
        for (const root of config.roots) {
          index += 1;
          const rootStartAt = Date.now();
          const beforeEntries = progress?.processedEntries || 0;
          const beforeFiles = progress?.processedFiles || 0;
          const beforeDirs = progress?.processedDirs || 0;
          const beforeErrors = scanErrors.filter((entry) => entry.scanId === scanId).length;
          setProgressRoot(root, index);
          await scanRoot(root, scanId, db, logger, config.previewDir, scanOptions, progress);
          const afterErrors = scanErrors.filter((entry) => entry.scanId === scanId).length;
          rootScanStats.push({
            rootId: root.id,
            rootName: root.name,
            scope: 'root',
            durationMs: Date.now() - rootStartAt,
            processedEntries: Math.max(0, (progress?.processedEntries || 0) - beforeEntries),
            processedFiles: Math.max(0, (progress?.processedFiles || 0) - beforeFiles),
            processedDirs: Math.max(0, (progress?.processedDirs || 0) - beforeDirs),
            errorCount: Math.max(0, afterErrors - beforeErrors),
          });
        }
        return { indexedTotal: estimateTotalForRoots(config.roots) };
      },
    });
  };

  const scanPath = async ({ root, relPath = '', fastScan = false } = {}) => {
    if (!root?.absPath) {
      return;
    }
    const mode = fastScan ? 'fast' : 'full';
    await runScan({
      mode,
      scope: 'path',
      expectedTotal: null,
      totalRoots: 1,
      operation: 'scan_path',
      onError: () => ({
        rootId: root.id,
        rootName: root.name,
        relPath: relPath || '',
      }),
      onRun: async () => {
        setProgressRoot(root, 1, relPath || '');
        const scanOptions = createScanOptions(fastScan);
        if (scanOptions.fastScan && scanOptions.extractAudioMetadata !== false) {
          scanOptions.audioBackfillDirs = buildAudioBackfillDirSet(db, root.id);
        }
        const normalized = relPath || '';
        if (normalized && isIgnoredEntryName(path.basename(normalized))) {
          db.deleteEntryByPath.run(root.id, normalized);
          return;
        }
        const targetPath = path.join(root.absPath, normalized);
        let stats;
        try {
          stats = await fs.promises.stat(targetPath);
        } catch (error) {
          logger?.warn?.({ err: error, targetPath }, 'Scan path not accessible');
          reportError({
            error,
            operation: 'path_stat',
            rootId: root.id,
            rootName: root.name,
            relPath: normalized,
            fullPath: targetPath,
          });
          return { skipFinalize: true };
        }
        const name = normalized ? path.basename(normalized) : root.name;
        const albumArtDir = config.previewDir ? path.join(config.previewDir, 'album-art') : null;
        let folderArtMap = null;
        if (!stats.isDirectory()) {
          const parentRel = normalizeParent(normalized);
          folderArtMap = await buildFolderArtMapForDir(root.absPath, parentRel, logger);
        }
        const writer = createBatchWriter(db, logger, scanOptions.batchSize, reportError);
        const existing = db.getEntry.get(root.id, normalized) || null;
        const rootStartAt = Date.now();
        const beforeEntries = progress?.processedEntries || 0;
        const beforeFiles = progress?.processedFiles || 0;
        const beforeDirs = progress?.processedDirs || 0;
        const beforeErrors = scanErrors.filter((entry) => entry.scanId === scanId).length;
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
          existing,
          writer,
        });
        updateProgress(progress, normalized, stats.isDirectory());
        writer.flush();
        if (stats.isDirectory()) {
          await scanDirectory(
            root.id,
            root.absPath,
            normalized,
            scanId,
            db,
            logger,
            albumArtDir,
            scanOptions,
            progress
          );
          const prefixLike = normalized ? `${normalized}/%` : '%';
          if (normalized) {
            db.cleanupPrefix.run(root.id, normalized, prefixLike, scanId);
          } else {
            db.cleanupOld.run(root.id, scanId);
          }
        }
        const afterErrors = scanErrors.filter((entry) => entry.scanId === scanId).length;
        rootScanStats.push({
          rootId: root.id,
          rootName: root.name,
          scope: 'path',
          relPath: normalized,
          durationMs: Date.now() - rootStartAt,
          processedEntries: Math.max(0, (progress?.processedEntries || 0) - beforeEntries),
          processedFiles: Math.max(0, (progress?.processedFiles || 0) - beforeFiles),
          processedDirs: Math.max(0, (progress?.processedDirs || 0) - beforeDirs),
          errorCount: Math.max(0, afterErrors - beforeErrors),
        });
      },
    });
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
        scanAll({ fastScan: false }).catch((error) =>
          logger?.error?.({ err: error }, 'Full scan failed')
        );
      }, fullMs);
    }
  };

  const start = () => {
    scheduleTimers({ runImmediate: true });
    refreshThumbnailStats({ force: true });
  };

  return {
    scanAll,
    scanPath,
    start,
    reschedule: () => scheduleTimers({ runImmediate: false }),
    getStatus: () => {
      refreshThumbnailStats();
      return {
        lastScanAt,
        scanInProgress,
        scanIntervalSeconds: config.scanIntervalSeconds || 60,
        fastScan: Boolean(config.fastScan),
        scanFsConcurrency: Number(config.scanFsConcurrency || 8),
        fullScanIntervalHours: Number(config.fullScanIntervalHours || 0),
        scanErrorCount,
        scanErrors,
        progress: progress
          ? {
              ...progress,
              percent:
                progress.expectedTotal && progress.mode !== 'fast'
                  ? Math.min(
                      100,
                      Math.floor((progress.processedEntries / progress.expectedTotal) * 100)
                    )
                  : null,
            }
          : null,
        lastScanStats,
        thumbnailStats: { ...thumbnailStats },
      };
    },
  };
}

module.exports = {
  createIndexer,
};
