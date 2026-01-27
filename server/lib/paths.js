const path = require('path');
const { normalizeRelPath } = require('../utils');

function makePrefixLike(rawPrefix) {
  const normalized = normalizeRelPath(rawPrefix || '');
  if (!normalized) {
    return null;
  }
  const normalizedSlash = normalized.replace(/\\/g, '/');
  return `${normalizedSlash}/%`;
}

function safeAttachmentName(relPath) {
  const base = path.basename(relPath || 'download');
  return base.replace(/"/g, "'");
}

module.exports = {
  makePrefixLike,
  safeAttachmentName,
};
