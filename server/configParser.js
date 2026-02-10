const fs = require('fs');
const path = require('path');

function resolvePath(rootDir, targetPath) {
  if (!targetPath) {
    return null;
  }
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(rootDir, targetPath);
}

function resolveRootPath(rootDir, hostFsRoot, targetPath) {
  if (!targetPath) {
    return null;
  }
  if (!path.isAbsolute(targetPath)) {
    return path.resolve(rootDir, targetPath);
  }
  if (!hostFsRoot) {
    return targetPath;
  }
  const hostRoot = path.resolve(hostFsRoot);
  const normalizedTarget = path.resolve(targetPath);
  if (normalizedTarget === hostRoot || normalizedTarget.startsWith(`${hostRoot}${path.sep}`)) {
    return normalizedTarget;
  }
  const rel = path.relative(path.parse(normalizedTarget).root, normalizedTarget);
  return path.join(hostRoot, rel);
}

function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config.json at ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const roots = Array.isArray(config.roots) ? config.roots : [];
  const hostFsRoot = config.hostFsRoot ? resolvePath(projectRoot, config.hostFsRoot) : null;

  const resolvedRoots = roots.map((root, index) => {
    const absPath = resolveRootPath(projectRoot, hostFsRoot, root.path);
    const fallbackId = root.id || root.name || path.basename(absPath || '') || `root-${index + 1}`;
    return {
      id: fallbackId,
      path: root.path,
      absPath,
      name: root.name || path.basename(absPath || root.path || fallbackId),
    };
  });

  return {
    host: config.host || '127.0.0.1',
    port: config.port || 4170,
    dbPath: resolvePath(projectRoot, config.dbPath || './data/files.db'),
    previewDir: resolvePath(projectRoot, config.previewDir || './data/previews'),
    previewConcurrency: Number.isFinite(config.previewConcurrency)
      ? Math.max(1, config.previewConcurrency)
      : 2,
    scanIntervalSeconds: config.scanIntervalSeconds || 60,
    fastScan: Boolean(config.fastScan),
    scanBatchSize: Number.isFinite(config.scanBatchSize) ? Math.max(1, config.scanBatchSize) : 500,
    scanFsConcurrency: Number.isFinite(config.scanFsConcurrency)
      ? Math.max(1, config.scanFsConcurrency)
      : 8,
    fullScanIntervalHours: Number.isFinite(config.fullScanIntervalHours)
      ? config.fullScanIntervalHours
      : 0,
    devMode: Boolean(config.devMode),
    uploadEnabled: config.uploadEnabled !== false,
    uploadMaxBytes: Number.isFinite(config.uploadMaxBytes) ? config.uploadMaxBytes : 0,
    uploadMaxFiles: Number.isFinite(config.uploadMaxFiles) ? config.uploadMaxFiles : 0,
    uploadTempDir: resolvePath(projectRoot, config.uploadTempDir || './data/uploads'),
    uploadOverwrite: Boolean(config.uploadOverwrite),
    trashDir: resolvePath(projectRoot, config.trashDir || './data/trash'),
    trashRetentionDays: Number.isFinite(config.trashRetentionDays) ? config.trashRetentionDays : 30,
    sessionTtlHours: Number.isFinite(config.sessionTtlHours) ? config.sessionTtlHours : 24,
    sessionCookieName: config.sessionCookieName || 'lc_token',
    allowQueryToken: Boolean(config.allowQueryToken),
    hostFsRoot,
    roots: resolvedRoots,
    auth: {
      user: config.auth?.user || 'admin',
      pass: config.auth?.pass || 'admin',
    },
  };
}

module.exports = {
  loadConfig,
  resolvePath,
  resolveRootPath,
};
