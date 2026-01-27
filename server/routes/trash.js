const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { sendOk, sendError, sendList } = require('../lib/response');
const { safeAttachmentName } = require('../lib/paths');
const { trashRelName, movePath, removeTrashEntry, purgeTrash } = require('../lib/trash');

function registerTrashRoutes(fastify, ctx) {
  const { config, db, allRootsId, safeJoin, normalizeRelPath, normalizeParent } = ctx;

  fastify.get('/api/trash', async (request, reply) => {
    const rootId = request.query.root || allRootsId;
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
    const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
    const rootMap = new Map(config.roots.map((root) => [root.id, root]));

    let rows = [];
    let total = 0;
    if (rootId === allRootsId) {
      rows = db.listTrashAll.all(limit, offset);
      total = db.countTrashAll.get()?.count || 0;
    } else {
      const root = rootMap.get(rootId);
      if (!root) {
        return sendError(reply, 400, 'invalid_root', 'Invalid root');
      }
      rows = db.listTrashByRoot.all(rootId, limit, offset);
      total = db.countTrashByRoot.get(rootId)?.count || 0;
    }

    const items = rows.map((row) => ({
      trashId: row.id,
      rootId: row.root_id,
      rootName: rootMap.get(row.root_id)?.name || row.root_id,
      path: row.rel_path,
      name: row.name,
      size: row.size,
      mime: row.mime,
      ext: row.ext,
      isDir: Boolean(row.is_dir),
      deletedAt: row.deleted_at,
    }));

    return sendList(items, total, limit, offset);
  });

  fastify.get('/api/trash/file', async (request, reply) => {
    const trashId = parseInt(request.query.id || request.query.trashId, 10);
    if (!Number.isFinite(trashId)) {
      return sendError(reply, 400, 'invalid_request', 'Invalid trash id');
    }
    const entry = db.db
      .prepare(
        'SELECT id, rel_path, is_dir, mime, trash_rel_path FROM trash_entries WHERE id = ?'
      )
      .get(trashId);
    if (!entry) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    if (entry.is_dir) {
      return sendError(reply, 400, 'invalid_path', 'Directory requested');
    }
    const fullPath = path.join(config.trashDir, entry.trash_rel_path);
    let stats;
    try {
      stats = await fs.promises.stat(fullPath);
    } catch {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    const mimeType = entry.mime || mime.lookup(fullPath) || 'application/octet-stream';
    const ext = path.extname(entry.rel_path || '').toLowerCase();
    const resolvedMime = mimeType === 'application/octet-stream' && ext === '.opus'
      ? 'audio/opus'
      : mimeType;
    const wantsDownload = request.query.download === '1' || request.query.download === 'true';
    if (wantsDownload) {
      reply.header(
        'Content-Disposition',
        `attachment; filename="${safeAttachmentName(entry.rel_path)}"`
      );
    }
    const range = request.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : stats.size - 1;
        if (start >= stats.size || end >= stats.size) {
          reply.code(416);
          reply.header('Content-Range', `bytes */${stats.size}`);
          return;
        }
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${stats.size}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', end - start + 1);
        reply.header('Content-Type', resolvedMime);
        return reply.send(fs.createReadStream(fullPath, { start, end }));
      }
    }

    reply.header('Content-Type', resolvedMime);
    return reply.send(fs.createReadStream(fullPath));
  });

  fastify.post('/api/delete', async (request, reply) => {
    const { root: rootId, paths } = request.body || {};
    const root = config.roots.find((item) => item.id === rootId);
    if (!root || !Array.isArray(paths) || paths.length === 0) {
      return sendError(reply, 400, 'invalid_request', 'Invalid request');
    }

    const results = { moved: 0, skipped: 0, errors: [] };
    const touchedDirs = new Set();

    for (const relPathRaw of paths) {
      const relPath = normalizeRelPath(relPathRaw);
      if (!relPath) {
        results.skipped += 1;
        results.errors.push({ path: relPathRaw || '', error: 'Invalid path' });
        continue;
      }
      const fullPath = safeJoin(root.absPath, relPath);
      if (!fullPath) {
        results.skipped += 1;
        results.errors.push({ path: relPath, error: 'Invalid path' });
        continue;
      }
      let stats;
      try {
        stats = await fs.promises.lstat(fullPath);
      } catch {
        results.skipped += 1;
        results.errors.push({ path: relPath, error: 'Not found' });
        continue;
      }
      if (stats.isSymbolicLink()) {
        results.skipped += 1;
        results.errors.push({ path: relPath, error: 'Symlink not supported' });
        continue;
      }

      const trashRel = trashRelName(root.id, relPath);
      const trashFull = path.join(config.trashDir, trashRel);
      try {
        await movePath(fullPath, trashFull, stats.isDirectory());
      } catch (error) {
        results.skipped += 1;
        results.errors.push({ path: relPath, error: 'Failed to move to trash' });
        continue;
      }

      const ext = stats.isDirectory() ? '' : path.extname(relPath).toLowerCase();
      let mimeType = stats.isDirectory() ? null : mime.lookup(ext);
      if (!mimeType && ext === '.opus') {
        mimeType = 'audio/opus';
      }
      db.insertTrashEntry.run({
        root_id: root.id,
        rel_path: relPath,
        name: path.basename(relPath),
        ext,
        size: stats.isDirectory() ? 0 : stats.size,
        mime: stats.isDirectory() ? null : mimeType || 'application/octet-stream',
        is_dir: stats.isDirectory() ? 1 : 0,
        deleted_at: Date.now(),
        trash_rel_path: trashRel,
      });

      if (stats.isDirectory()) {
        const prefixLike = `${relPath}/%`;
        db.deleteEntriesByPrefix.run(root.id, relPath, prefixLike);
      } else {
        db.deleteEntryByPath.run(root.id, relPath);
      }
      results.moved += 1;
      touchedDirs.add(normalizeParent(relPath));
    }

    for (const relPath of touchedDirs) {
      await ctx.indexer.scanPath({ root, relPath, fastScan: true });
    }

    return sendOk({ rootId, ...results });
  });

  fastify.post('/api/trash/restore', async (request, reply) => {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids : [];
    if (!ids.length) {
      return sendError(reply, 400, 'invalid_request', 'No items selected');
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.db
      .prepare(
        `SELECT id, root_id, rel_path, is_dir, trash_rel_path FROM trash_entries WHERE id IN (${placeholders})`
      )
      .all(...ids);

    const results = { restored: 0, skipped: 0, errors: [] };
    for (const entry of rows) {
      const root = config.roots.find((item) => item.id === entry.root_id);
      if (!root) {
        results.skipped += 1;
        results.errors.push({ id: entry.id, error: 'Root not found' });
        continue;
      }
      const targetRel = normalizeRelPath(entry.rel_path);
      const fullPath = safeJoin(root.absPath, targetRel);
      if (!fullPath) {
        results.skipped += 1;
        results.errors.push({ id: entry.id, error: 'Invalid path' });
        continue;
      }
      let exists = false;
      try {
        const stats = await fs.promises.lstat(fullPath);
        if (stats) {
          exists = true;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          results.skipped += 1;
          results.errors.push({ id: entry.id, error: 'Failed to access target' });
          continue;
        }
      }
      if (exists) {
        results.skipped += 1;
        results.errors.push({ id: entry.id, error: 'Target already exists' });
        continue;
      }
      const trashFull = path.join(config.trashDir, entry.trash_rel_path);
      try {
        await movePath(trashFull, fullPath, Boolean(entry.is_dir));
        db.deleteTrashById.run(entry.id);
        await ctx.upsertUploadedFile({ db, root, relPath: targetRel, fullPath });
        await ctx.indexer.scanPath({ root, relPath: targetRel, fastScan: false });
        results.restored += 1;
      } catch (error) {
        results.skipped += 1;
        results.errors.push({ id: entry.id, error: 'Failed to restore' });
      }
    }

    return sendOk(results);
  });

  fastify.post('/api/trash/delete', async (request, reply) => {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids : [];
    if (!ids.length) {
      return sendError(reply, 400, 'invalid_request', 'No items selected');
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.db
      .prepare(
        `SELECT id, root_id, rel_path, is_dir, trash_rel_path FROM trash_entries WHERE id IN (${placeholders})`
      )
      .all(...ids);

    const results = { deleted: 0, skipped: 0, errors: [] };
    for (const entry of rows) {
      try {
        await removeTrashEntry({ db, config }, entry);
        results.deleted += 1;
      } catch {
        results.skipped += 1;
        results.errors.push({ id: entry.id, error: 'Failed to delete' });
      }
    }
    return sendOk(results);
  });

  fastify.post('/api/trash/clear', async (request, reply) => {
    const rootId = request.body?.root || allRootsId;
    if (rootId !== allRootsId && !config.roots.find((item) => item.id === rootId)) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }
    const count = await purgeTrash({ db, config }, { rootId: rootId === allRootsId ? null : rootId });
    return sendOk({ cleared: count });
  });
}

module.exports = registerTrashRoutes;
