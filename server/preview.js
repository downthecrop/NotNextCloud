const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let sharpModule = null;
let ffmpegAvailable = null;
const PREVIEW_CACHE_VERSION = 'v3';
const DEFAULT_PREVIEW_MAX_SIZE = 140;
const DEFAULT_PREVIEW_JPEG_QUALITY = 70;
const DEFAULT_VIDEO_PREVIEW_QSCALE = 7;

function loadSharp() {
  if (sharpModule !== null) {
    return sharpModule;
  }
  try {
    sharpModule = require('sharp');
  } catch (error) {
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

function previewCacheKey(rootId, relPath, mtime) {
  return crypto
    .createHash('sha1')
    .update(
      `${PREVIEW_CACHE_VERSION}:${rootId}:${relPath}:${mtime}:${DEFAULT_PREVIEW_MAX_SIZE}:${DEFAULT_PREVIEW_JPEG_QUALITY}:${DEFAULT_VIDEO_PREVIEW_QSCALE}`
    )
    .digest('hex');
}

function previewCachePath(previewDir, rootId, relPath, mtime) {
  const hash = previewCacheKey(rootId, relPath, mtime);
  return path.join(previewDir, `${hash}.jpg`);
}

async function ensureVideoPreview({
  fullPath,
  previewPath,
  maxSize = DEFAULT_PREVIEW_MAX_SIZE,
  seekSeconds = 1,
}) {
  if (fs.existsSync(previewPath)) {
    return previewPath;
  }
  if (!hasFfmpeg()) {
    return null;
  }
  await fs.promises.mkdir(path.dirname(previewPath), { recursive: true });
  const safeSeek = Math.max(0, Number(seekSeconds) || 0);
  const args = [
    '-y',
    '-ss',
    String(safeSeek),
    '-i',
    fullPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${maxSize}:-2:force_original_aspect_ratio=decrease`,
    '-q:v',
    String(DEFAULT_VIDEO_PREVIEW_QSCALE),
    previewPath,
  ];
  try {
    await runFfmpeg(args);
    if (fs.existsSync(previewPath)) {
      return previewPath;
    }
  } catch {
    try {
      if (fs.existsSync(previewPath)) {
        await fs.promises.unlink(previewPath);
      }
    } catch {
      // ignore cleanup failures
    }
  }
  return null;
}

async function ensurePreview({
  fullPath,
  previewPath,
  maxSize = DEFAULT_PREVIEW_MAX_SIZE,
  mimeType = '',
}) {
  if (fs.existsSync(previewPath)) {
    return previewPath;
  }

  if (mimeType.startsWith('video/')) {
    return ensureVideoPreview({ fullPath, previewPath, maxSize });
  }

  const sharp = loadSharp();
  if (!sharp) {
    return null;
  }

  try {
    await sharp(fullPath)
      .resize(maxSize, maxSize, { fit: 'inside' })
      .jpeg({ quality: DEFAULT_PREVIEW_JPEG_QUALITY })
      .toFile(previewPath);
  } catch {
    try {
      if (fs.existsSync(previewPath)) {
        await fs.promises.unlink(previewPath);
      }
    } catch {
      // ignore cleanup failures
    }
    return null;
  }

  return previewPath;
}

module.exports = {
  loadSharp,
  previewCacheKey,
  previewCachePath,
  ensurePreview,
};
