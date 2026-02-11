const { sendError } = require('./response');
const { getRootById } = require('./roots');
const { parseBooleanFlag } = require('./boolean');

function resolveRootOrReply({ roots, rootId, reply }) {
  const root = getRootById(roots, rootId);
  if (!root) {
    sendError(reply, 400, 'invalid_root', 'Invalid root');
    return null;
  }
  return { rootId, root };
}

function resolveRootPathOrReply({
  roots,
  rootId,
  relPath,
  normalizeRelPath,
  safeJoin,
  reply,
}) {
  const resolvedRoot = resolveRootOrReply({ roots, rootId, reply });
  if (!resolvedRoot) {
    return null;
  }
  const normalizedRelPath = normalizeRelPath(relPath || '');
  const fullPath = safeJoin(resolvedRoot.root.absPath, normalizedRelPath);
  if (!fullPath) {
    sendError(reply, 400, 'invalid_path', 'Invalid path');
    return null;
  }
  return {
    ...resolvedRoot,
    relPath: normalizedRelPath,
    fullPath,
  };
}

module.exports = {
  parseBooleanFlag,
  resolveRootOrReply,
  resolveRootPathOrReply,
};
