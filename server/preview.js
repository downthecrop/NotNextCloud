const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let sharpModule = null;

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

function previewCachePath(previewDir, rootId, relPath, mtime) {
  const hash = crypto
    .createHash('sha1')
    .update(`${rootId}:${relPath}:${mtime}`)
    .digest('hex');
  return path.join(previewDir, `${hash}.jpg`);
}

async function ensurePreview({ fullPath, previewPath, maxSize = 480 }) {
  if (fs.existsSync(previewPath)) {
    return previewPath;
  }

  const sharp = loadSharp();
  if (!sharp) {
    return null;
  }

  await sharp(fullPath)
    .resize(maxSize, maxSize, { fit: 'inside' })
    .jpeg({ quality: 80 })
    .toFile(previewPath);

  return previewPath;
}

module.exports = {
  loadSharp,
  previewCachePath,
  ensurePreview,
};
