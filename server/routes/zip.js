const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { sendError } = require('../lib/response');
const { getRootById } = require('../lib/roots');

function registerZipRoutes(fastify, ctx) {
  const { config, safeJoin, normalizeRelPath } = ctx;

  fastify.post('/api/zip', async (request, reply) => {
    const { root: rootId, paths, flatten } = request.body || {};
    const root = getRootById(config.roots, rootId);
    if (!root || !Array.isArray(paths) || paths.length === 0) {
      return sendError(reply, 400, 'invalid_request', 'Invalid request');
    }

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename="files.zip"');
    reply.hijack();

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (error) => {
      reply.raw.destroy(error);
    });
    archive.pipe(reply.raw);

    const normalizeZipPath = (value) => (value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const normalizeZipDir = (dirPath) => {
      const normalized = normalizeZipPath(dirPath);
      if (!normalized || normalized === '.' || normalized === '/') {
        return '';
      }
      return normalized.replace(/\/+$/, '');
    };
    const appendSuffix = (fileName, index) => {
      const ext = path.posix.extname(fileName);
      const base = ext ? fileName.slice(0, -ext.length) : fileName;
      return `${base} (${index})${ext}`;
    };
    const reserveZipName = (desired, allowRename = false) => {
      if (!desired) {
        return null;
      }
      if (!includedNames.has(desired)) {
        includedNames.add(desired);
        return desired;
      }
      if (!allowRename) {
        return null;
      }
      let counter = 2;
      let candidate = appendSuffix(desired, counter);
      while (includedNames.has(candidate)) {
        counter += 1;
        candidate = appendSuffix(desired, counter);
      }
      includedNames.add(candidate);
      return candidate;
    };
    const commonDir = (dirs) => {
      if (!dirs.length) {
        return '';
      }
      const splitDirs = dirs.map((dir) => normalizeZipDir(dir).split('/').filter(Boolean));
      let common = splitDirs[0];
      for (const parts of splitDirs.slice(1)) {
        let i = 0;
        while (i < common.length && i < parts.length && common[i] === parts[i]) {
          i += 1;
        }
        common = common.slice(0, i);
        if (!common.length) {
          break;
        }
      }
      return common.join('/');
    };
    const isUnderPrefix = (target, prefix) => target === prefix || target.startsWith(`${prefix}/`);
    const includedNames = new Set();
    const selectedDirs = [];
    const selectedFiles = [];
    const seen = new Set();

    for (const relPathRaw of paths) {
      const relPath = normalizeRelPath(relPathRaw);
      if (!relPath || seen.has(relPath)) {
        continue;
      }
      seen.add(relPath);
      const fullPath = safeJoin(root.absPath, relPath);
      if (!fullPath) {
        continue;
      }
      let stats;
      try {
        stats = await fs.promises.lstat(fullPath);
      } catch {
        continue;
      }
      if (stats.isSymbolicLink()) {
        continue;
      }
      if (stats.isDirectory()) {
        selectedDirs.push({ relPath, fullPath });
      } else if (stats.isFile()) {
        selectedFiles.push({ relPath, fullPath });
      }
    }

    selectedDirs.sort((a, b) => a.relPath.length - b.relPath.length);
    const dirEntries = [];
    for (const dirEntry of selectedDirs) {
      const dirRel = normalizeZipPath(dirEntry.relPath);
      if (!dirRel) {
        dirEntries.push(dirEntry);
        continue;
      }
      if (dirEntries.some((entry) => isUnderPrefix(dirRel, normalizeZipPath(entry.relPath)))) {
        continue;
      }
      dirEntries.push(dirEntry);
    }

    const dirPrefixes = dirEntries.map((entry) => normalizeZipPath(entry.relPath));
    const fileEntries = selectedFiles.filter((entry) => {
      const rel = normalizeZipPath(entry.relPath);
      return !dirPrefixes.some((prefix) => prefix && isUnderPrefix(rel, prefix));
    });

    const addEmptyDir = (zipDir) => {
      const name = `${normalizeZipDir(zipDir)}/`;
      const reserved = reserveZipName(name);
      if (!reserved) {
        return;
      }
      archive.append('', { name: reserved });
    };

    const addFileEntry = (fullPath, zipName, options = {}) => {
      const name = normalizeZipPath(zipName);
      const reserved = reserveZipName(name, options.allowRename);
      if (!reserved) {
        return;
      }
      archive.file(fullPath, { name: reserved });
    };

    const addDirectoryContents = async (fullDir, zipBase) => {
      let dirents;
      try {
        dirents = await fs.promises.readdir(fullDir, { withFileTypes: true });
      } catch (error) {
        fastify.log.warn({ err: error, fullDir }, 'Failed to read zip directory');
        return false;
      }
      let hasFile = false;
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) {
          continue;
        }
        const childFull = path.join(fullDir, dirent.name);
        const childZip = zipBase ? `${zipBase}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          const childHasFile = await addDirectoryContents(childFull, childZip);
          if (childHasFile) {
            hasFile = true;
          } else {
            addEmptyDir(childZip);
          }
        } else if (dirent.isFile()) {
          addFileEntry(childFull, childZip);
          hasFile = true;
        }
      }
      if (!hasFile && zipBase) {
        addEmptyDir(zipBase);
      }
      return hasFile;
    };

    for (const entry of dirEntries) {
      const zipBase = normalizeZipPath(entry.relPath);
      await addDirectoryContents(entry.fullPath, zipBase);
    }

    const flattenFiles = Boolean(flatten) && dirEntries.length === 0;
    let baseDir = '';
    if (!flattenFiles && !dirEntries.length && fileEntries.length) {
      const parentDirs = fileEntries.map((entry) => normalizeZipDir(path.posix.dirname(entry.relPath)));
      const sharedDir = commonDir(parentDirs);
      baseDir = normalizeZipDir(path.posix.dirname(sharedDir));
    }

    for (const entry of fileEntries) {
      let name = entry.relPath;
      if (flattenFiles) {
        name = path.posix.basename(normalizeZipPath(entry.relPath));
      } else if (baseDir) {
        const relativeName = path.posix.relative(baseDir, entry.relPath);
        if (relativeName && !relativeName.startsWith('..')) {
          name = relativeName;
        }
      }
      addFileEntry(entry.fullPath, name, { allowRename: flattenFiles });
    }

    await archive.finalize();
  });
}

module.exports = registerZipRoutes;
