const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const { normalizeParent, normalizeRelPath } = require('./utils');
const { createAsyncQueue } = require('./lib/asyncQueue');
const { createBatchWriter } = require('./lib/indexer/batchWriter');
const { buildFolderArtMapForDir, buildFolderArtMapFromDirents } = require('./lib/indexer/folderArt');
const { enrichAudioEntry } = require('./lib/indexer/audioEnrichment');

function toStatNumber(value) {
  return Number.isFinite(value) ? value : null;
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
  ({ title, artist, album, duration, albumKey } = await enrichAudioEntry({
    safeMime,
    existingEntry,
    isSameStat,
    fullPath,
    relPath,
    parent,
    name,
    folderArtMap,
    albumArtDir,
    albumArtCache: scanOptions?.albumArtCache,
    db,
    logger,
  }));

  if (isSameStat && (!isDir || existingEntry)) {
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
  const writer = createBatchWriter(db, logger, batchSize, options.reportError);
  const enqueueFs = createAsyncQueue(fsConcurrency);
  const stack = [relPath || ''];

  while (stack.length) {
    const currentRel = stack.pop();
    const targetPath = currentRel ? path.join(rootPath, currentRel) : rootPath;
    let dirents;
    try {
      dirents = await fs.promises.readdir(targetPath, { withFileTypes: true });
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

    const existingByRelPath = new Map();
    const existingEntries = db.listScanEntriesByParent.all(rootId, currentRel || '');
    for (const row of existingEntries) {
      existingByRelPath.set(row.rel_path, row);
    }

    const folderArtMap = buildFolderArtMapFromDirents(currentRel, targetPath, dirents);

    const resolveDirent = (dirent) =>
      enqueueFs(async () => {
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
    for (let index = 0; index < dirents.length; index += entryBatchSize) {
      const batch = dirents.slice(index, index + entryBatchSize);
      const resolvedEntries = await Promise.all(batch.map((dirent) => resolveDirent(dirent)));

      for (const entry of resolvedEntries) {
        if (!entry) {
          continue;
        }
        const { dirent, fullPath, stats, nextRel } = entry;
        const existing = existingByRelPath.get(nextRel) || null;
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

          if (fastScan && sameStat) {
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

function createIndexer(config, db, logger) {
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
  const maxScanErrors = 50;

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

  const createScanOptions = (fastScan) => ({
    fastScan,
    batchSize: Number.isFinite(config.scanBatchSize) ? Math.max(1, config.scanBatchSize) : 1,
    fsConcurrency: Number.isFinite(config.scanFsConcurrency) ? Math.max(1, config.scanFsConcurrency) : 8,
    albumArtCache: new Map(),
    reportError,
  });

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
        const normalized = relPath || '';
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
        const existing = db.getEntry.get(root.id, normalized);
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
    }),
  };
}

module.exports = {
  createIndexer,
};
