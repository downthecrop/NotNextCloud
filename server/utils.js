const path = require('path');

function normalizeRelPath(relPath) {
  if (!relPath) {
    return '';
  }
  const stripped = relPath.replace(/^\/+/, '');
  const normalized = path.normalize(stripped);
  return normalized === '.' ? '' : normalized;
}

function safeJoin(rootPath, relPath) {
  if (!rootPath) {
    return null;
  }
  const normalized = normalizeRelPath(relPath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return null;
  }

  const fullPath = path.resolve(rootPath, normalized);
  const rootBase = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;

  if (fullPath === rootPath || fullPath.startsWith(rootBase)) {
    return fullPath;
  }

  return null;
}

function normalizeParent(relPath) {
  if (!relPath) {
    return '';
  }
  const parent = path.dirname(relPath);
  return parent === '.' ? '' : parent;
}

function formatBytes(bytes) {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const size = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, size);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[size]}`;
}

module.exports = {
  normalizeRelPath,
  safeJoin,
  normalizeParent,
  formatBytes,
};
