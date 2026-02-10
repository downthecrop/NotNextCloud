const path = require('path');
const ROOT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function normalizeRootId(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  return raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

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
    const providedId = typeof root?.id === 'string' ? root.id.trim() : '';
    if (providedId && !ROOT_ID_PATTERN.test(providedId)) {
      throw new Error('Root id must use only letters, numbers, underscores, or dashes.');
    }
    let id = providedId;
    if (!id) {
      id = normalizeRootId(name || path.basename(pathValue));
    }
    if (!id) {
      id = `root-${index + 1}`;
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
