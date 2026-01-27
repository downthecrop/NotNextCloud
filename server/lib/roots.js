const path = require('path');

function resolveRootScope(rootId, roots, allRootsId) {
  if (!rootId) {
    return null;
  }
  if (rootId === allRootsId) {
    return { rootIds: roots.map((root) => root.id), isAll: true };
  }
  const root = roots.find((item) => item.id === rootId);
  if (!root) {
    return null;
  }
  return { rootIds: [rootId], isAll: false };
}

function buildRootFilter(rootIds) {
  const placeholders = rootIds.map(() => '?').join(', ');
  return {
    clause: `root_id IN (${placeholders})`,
    params: rootIds,
  };
}

function formatRootsResponse(roots) {
  return roots.map((root) => ({
    id: root.id,
    name: root.name,
    path: root.path,
    absPath: root.absPath,
  }));
}

function sanitizeRootPayload(rawRoots) {
  const results = [];
  const usedIds = new Set();
  rawRoots.forEach((root, index) => {
    const pathValue = typeof root?.path === 'string' ? root.path.trim() : '';
    if (!pathValue) {
      throw new Error('Each root needs a valid path.');
    }
    const name = typeof root?.name === 'string' ? root.name.trim() : '';
    let id = typeof root?.id === 'string' ? root.id.trim() : '';
    if (!id) {
      id = name || path.basename(pathValue) || `root-${index + 1}`;
    }
    let uniqueId = id;
    let suffix = 2;
    while (usedIds.has(uniqueId)) {
      uniqueId = `${id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(uniqueId);
    const entry = { id: uniqueId, path: pathValue };
    if (name) {
      entry.name = name;
    }
    results.push(entry);
  });
  return results;
}

module.exports = {
  resolveRootScope,
  buildRootFilter,
  formatRootsResponse,
  sanitizeRootPayload,
};
