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

function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config.json at ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const roots = Array.isArray(config.roots) ? config.roots : [];

  const resolvedRoots = roots.map((root, index) => {
    const absPath = resolvePath(projectRoot, root.path);
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
    scanIntervalSeconds: config.scanIntervalSeconds || 60,
    devMode: Boolean(config.devMode),
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
};
