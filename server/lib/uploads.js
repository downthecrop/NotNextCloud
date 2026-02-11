const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { normalizeParent } = require('../utils');
const { resolveUploadTarget } = require('./uploadTarget');
const { parseBooleanFlag } = require('./boolean');

let sharpModule = null;
let ffmpegAvailable = null;

function loadSharp() {
  if (sharpModule !== null) {
    return sharpModule;
  }
  try {
    sharpModule = require('sharp');
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

function hasFfmpeg() {
  if (ffmpegAvailable !== null) {
    return ffmpegAvailable;
  }
  try {
    const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    ffmpegAvailable = result.status === 0;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with ${code}`));
      }
    });
  });
}

function replaceRelExtension(relPath, extension) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  const parsed = path.posix.parse(normalized);
  const nextName = `${parsed.name || parsed.base}${extension}`;
  return parsed.dir ? `${parsed.dir}/${nextName}` : nextName;
}

function randomTmpPath(targetPath) {
  return `${targetPath}.tmp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function moveOrCopyFile(sourcePath, targetPath) {
  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
    await fs.promises.copyFile(sourcePath, targetPath);
    await fs.promises.unlink(sourcePath);
  }
}

async function pathExists(targetPath) {
  try {
    await fs.promises.lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function replaceWithCompressedOutput({
  sourceFullPath,
  sourceRelPath,
  targetFullPath,
  targetRelPath,
  tmpFullPath,
  overwrite,
  logger,
}) {
  if (targetFullPath !== sourceFullPath) {
    const targetExists = await pathExists(targetFullPath);
    if (targetExists) {
      if (!overwrite) {
        try {
          await fs.promises.unlink(tmpFullPath);
        } catch {
          // ignore cleanup errors
        }
        logger?.warn?.(
          { source: sourceRelPath, target: targetRelPath },
          'Skipping upload compression because target already exists'
        );
        return {
          relPath: sourceRelPath,
          fullPath: sourceFullPath,
          compressed: false,
        };
      }
      await fs.promises.unlink(targetFullPath);
    }
  }
  await moveOrCopyFile(tmpFullPath, targetFullPath);
  if (targetFullPath !== sourceFullPath) {
    try {
      await fs.promises.unlink(sourceFullPath);
    } catch (error) {
      logger?.warn?.({ err: error, path: sourceFullPath }, 'Failed to remove source upload after compression');
    }
  }
  return {
    relPath: targetRelPath,
    fullPath: targetFullPath,
    compressed: true,
  };
}

async function compressImageToAvif({
  sourceRelPath,
  sourceFullPath,
  overwrite,
  quality,
  effort,
  logger,
}) {
  const sharp = loadSharp();
  if (!sharp) {
    logger?.warn?.('Skipping upload image compression because sharp is unavailable');
    return { relPath: sourceRelPath, fullPath: sourceFullPath, compressed: false };
  }
  const targetRelPath = replaceRelExtension(sourceRelPath, '.avif');
  const targetFullPath = path.join(path.dirname(sourceFullPath), path.basename(targetRelPath));
  const tmpFullPath = randomTmpPath(targetFullPath);
  try {
    await sharp(sourceFullPath)
      .rotate()
      .avif({ quality, effort })
      .toFile(tmpFullPath);
    const next = await replaceWithCompressedOutput({
      sourceFullPath,
      sourceRelPath,
      targetFullPath,
      targetRelPath,
      tmpFullPath,
      overwrite,
      logger,
    });
    return { ...next, outputFormat: 'avif' };
  } catch (error) {
    try {
      await fs.promises.unlink(tmpFullPath);
    } catch {
      // ignore cleanup errors
    }
    logger?.warn?.({ err: error, path: sourceRelPath }, 'Image compression failed');
    return { relPath: sourceRelPath, fullPath: sourceFullPath, compressed: false };
  }
}

async function compressVideoToMp4({
  sourceRelPath,
  sourceFullPath,
  overwrite,
  crf,
  preset,
  logger,
}) {
  if (!hasFfmpeg()) {
    logger?.warn?.('Skipping upload video compression because ffmpeg is unavailable');
    return { relPath: sourceRelPath, fullPath: sourceFullPath, compressed: false };
  }
  let sourceStats = null;
  try {
    sourceStats = await fs.promises.stat(sourceFullPath);
  } catch (error) {
    logger?.warn?.({ err: error, path: sourceRelPath }, 'Failed to stat source video before compression');
  }
  const targetRelPath = replaceRelExtension(sourceRelPath, '.mp4');
  const targetFullPath = path.join(path.dirname(sourceFullPath), path.basename(targetRelPath));
  const tmpFullPath = randomTmpPath(targetFullPath);
  try {
    await runFfmpeg([
      '-y',
      '-i',
      sourceFullPath,
      '-map_metadata',
      '-1',
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-crf',
      String(crf),
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      tmpFullPath,
    ]);
    if (sourceStats?.isFile()) {
      const tmpStats = await fs.promises.stat(tmpFullPath);
      if (!tmpStats.isFile() || tmpStats.size >= sourceStats.size) {
        try {
          await fs.promises.unlink(tmpFullPath);
        } catch {
          // ignore cleanup errors
        }
        logger?.info?.(
          {
            source: sourceRelPath,
            sourceBytes: sourceStats.size,
            transcodedBytes: tmpStats?.size || null,
          },
          'Skipping upload video compression result because it is not smaller'
        );
        return { relPath: sourceRelPath, fullPath: sourceFullPath, compressed: false };
      }
    }
    const next = await replaceWithCompressedOutput({
      sourceFullPath,
      sourceRelPath,
      targetFullPath,
      targetRelPath,
      tmpFullPath,
      overwrite,
      logger,
    });
    return { ...next, outputFormat: 'mp4' };
  } catch (error) {
    try {
      await fs.promises.unlink(tmpFullPath);
    } catch {
      // ignore cleanup errors
    }
    logger?.warn?.({ err: error, path: sourceRelPath }, 'Video compression failed');
    return { relPath: sourceRelPath, fullPath: sourceFullPath, compressed: false };
  }
}

async function compressAudioToOpus({
  sourceRelPath,
  sourceFullPath,
  overwrite,
  bitrateKbps,
  logger,
}) {
  if (!hasFfmpeg()) {
    logger?.warn?.('Skipping upload audio compression because ffmpeg is unavailable');
    return { relPath: sourceRelPath, fullPath: sourceFullPath, compressed: false };
  }
  let sourceStats = null;
  try {
    sourceStats = await fs.promises.stat(sourceFullPath);
  } catch (error) {
    logger?.warn?.({ err: error, path: sourceRelPath }, 'Failed to stat source audio before compression');
  }
  const targetRelPath = replaceRelExtension(sourceRelPath, '.opus');
  const targetFullPath = path.join(path.dirname(sourceFullPath), path.basename(targetRelPath));
  const tmpFullPath = randomTmpPath(targetFullPath);
  try {
    await runFfmpeg([
      '-y',
      '-i',
      sourceFullPath,
      '-map_metadata',
      '-1',
      '-vn',
      '-c:a',
      'libopus',
      '-b:a',
      `${bitrateKbps}k`,
      '-vbr',
      'on',
      '-compression_level',
      '10',
      '-application',
      'audio',
      tmpFullPath,
    ]);
    if (sourceStats?.isFile()) {
      const tmpStats = await fs.promises.stat(tmpFullPath);
      if (!tmpStats.isFile() || tmpStats.size >= sourceStats.size) {
        try {
          await fs.promises.unlink(tmpFullPath);
        } catch {
          // ignore cleanup errors
        }
        logger?.info?.(
          {
            source: sourceRelPath,
            sourceBytes: sourceStats.size,
            transcodedBytes: tmpStats?.size || null,
          },
          'Skipping upload audio compression result because it is not smaller'
        );
        return { relPath: sourceRelPath, fullPath: sourceFullPath, compressed: false };
      }
    }
    const next = await replaceWithCompressedOutput({
      sourceFullPath,
      sourceRelPath,
      targetFullPath,
      targetRelPath,
      tmpFullPath,
      overwrite,
      logger,
    });
    return { ...next, outputFormat: 'opus' };
  } catch (error) {
    try {
      await fs.promises.unlink(tmpFullPath);
    } catch {
      // ignore cleanup errors
    }
    logger?.warn?.({ err: error, path: sourceRelPath }, 'Audio compression failed');
    return { relPath: sourceRelPath, fullPath: sourceFullPath, compressed: false };
  }
}

async function maybeCompressUploadedMedia({
  config,
  relPath,
  fullPath,
  overwrite,
  logger,
}) {
  const compression = config?.uploadMediaCompression || {};
  if (!compression.enabled) {
    return { relPath, fullPath, compressed: false };
  }
  const ext = path.extname(relPath || '').toLowerCase();
  const mediaMime = mime.lookup(ext) || '';
  if (typeof mediaMime !== 'string') {
    return { relPath, fullPath, compressed: false };
  }
  if (mediaMime.startsWith('image/')) {
    return compressImageToAvif({
      sourceRelPath: relPath,
      sourceFullPath: fullPath,
      overwrite,
      quality: compression.imageAvifQuality,
      effort: compression.imageAvifEffort,
      logger,
    });
  }
  if (mediaMime.startsWith('video/')) {
    return compressVideoToMp4({
      sourceRelPath: relPath,
      sourceFullPath: fullPath,
      overwrite,
      crf: compression.videoCrf,
      preset: compression.videoPreset,
      logger,
    });
  }
  if (mediaMime.startsWith('audio/')) {
    if (ext === '.opus') {
      return { relPath, fullPath, compressed: false };
    }
    return compressAudioToOpus({
      sourceRelPath: relPath,
      sourceFullPath: fullPath,
      overwrite,
      bitrateKbps: compression.audioOpusBitrateKbps,
      logger,
    });
  }
  return { relPath, fullPath, compressed: false };
}

const parseBoolean = parseBooleanFlag;

function parseSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function uploadIdFor(rootId, relPath, size) {
  return crypto
    .createHash('sha1')
    .update(`${rootId}::${relPath}::${size}`)
    .digest('hex');
}

function uploadTempPath(config, uploadId) {
  return path.join(config.uploadTempDir, `${uploadId}.part`);
}

async function finalizeUpload({ partPath, fullPath, overwrite }) {
  const targetDir = path.dirname(fullPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  let existing = null;
  try {
    existing = await fs.promises.lstat(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (existing) {
    if (existing.isDirectory()) {
      return { ok: false, error: 'Target is a directory', conflict: true };
    }
    if (existing.isSymbolicLink()) {
      return { ok: false, error: 'Target is a symlink', conflict: true };
    }
    if (!overwrite) {
      return { ok: false, error: 'File already exists', conflict: true };
    }
    await fs.promises.unlink(fullPath);
  }
  try {
    await fs.promises.rename(partPath, fullPath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
    await fs.promises.copyFile(partPath, fullPath);
    await fs.promises.unlink(partPath);
  }
  return { ok: true };
}

async function ensureEmptyFile(fullPath, overwrite) {
  const targetDir = path.dirname(fullPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  let existing = null;
  try {
    existing = await fs.promises.lstat(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (existing) {
    if (existing.isDirectory()) {
      return { ok: false, error: 'Target is a directory', conflict: true };
    }
    if (existing.isSymbolicLink()) {
      return { ok: false, error: 'Target is a symlink', conflict: true };
    }
    if (!overwrite) {
      return { ok: false, error: 'File already exists', conflict: true };
    }
    await fs.promises.unlink(fullPath);
  }
  await fs.promises.writeFile(fullPath, '');
  return { ok: true };
}

async function upsertUploadedFile({ db, root, relPath, fullPath }) {
  let stats;
  try {
    stats = await fs.promises.stat(fullPath);
  } catch {
    return;
  }
  if (!stats.isFile()) {
    return;
  }
  const name = path.basename(relPath);
  const ext = path.extname(name).toLowerCase();
  let mimeType = mime.lookup(ext) || null;
  if (!mimeType && ext === '.opus') {
    mimeType = 'audio/opus';
  }
  const safeMime = mimeType || 'application/octet-stream';
  db.upsertEntry.run({
    root_id: root.id,
    rel_path: relPath,
    parent: normalizeParent(relPath),
    name,
    ext,
    size: stats.size,
    mtime: Math.floor(stats.mtimeMs),
    mime: safeMime,
    is_dir: 0,
    scan_id: Date.now(),
    title: null,
    artist: null,
    album: null,
    duration: null,
    album_key: null,
    inode: Number.isFinite(stats.ino) ? stats.ino : null,
    device: Number.isFinite(stats.dev) ? stats.dev : null,
  });
}

module.exports = {
  parseBoolean,
  parseSize,
  uploadIdFor,
  uploadTempPath,
  resolveUploadTarget,
  finalizeUpload,
  ensureEmptyFile,
  upsertUploadedFile,
  maybeCompressUploadedMedia,
};
