const fs = require('fs');
const path = require('path');

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

function buildFolderArtMapFromDirents(relPath, targetPath, dirents) {
  const folderArt = new Map();
  for (const dirent of dirents) {
    if (!dirent.isFile()) {
      continue;
    }
    updateFolderArtMap(folderArt, relPath, dirent.name, path.join(targetPath, dirent.name));
  }
  return folderArt;
}

async function buildFolderArtMapForDir(rootPath, relPath, logger) {
  const targetPath = relPath ? path.join(rootPath, relPath) : rootPath;
  let dirents;
  try {
    dirents = await fs.promises.readdir(targetPath, { withFileTypes: true });
  } catch (error) {
    logger?.warn?.({ err: error, relPath }, 'Failed to read directory');
    return new Map();
  }
  return buildFolderArtMapFromDirents(relPath, targetPath, dirents);
}

module.exports = {
  updateFolderArtMap,
  buildFolderArtMapFromDirents,
  buildFolderArtMapForDir,
};
