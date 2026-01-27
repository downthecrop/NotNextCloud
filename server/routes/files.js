const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { sendError } = require('../lib/response');
const { safeAttachmentName } = require('../lib/paths');

function registerFileRoutes(fastify, ctx) {
  const { config, db, previewCachePath, ensurePreview, safeJoin, normalizeRelPath } = ctx;

  fastify.get('/api/file', async (request, reply) => {
    const rootId = request.query.root;
    const relPath = normalizeRelPath(request.query.path || '');
    const root = config.roots.find((item) => item.id === rootId);
    if (!root) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }

    const fullPath = safeJoin(root.absPath, relPath);
    if (!fullPath) {
      return sendError(reply, 400, 'invalid_path', 'Invalid path');
    }

    let stats;
    try {
      stats = await fs.promises.stat(fullPath);
    } catch (error) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }

    if (stats.isDirectory()) {
      return sendError(reply, 400, 'invalid_path', 'Directory requested');
    }

    const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
    const ext = path.extname(fullPath).toLowerCase();
    const resolvedMime = mimeType === 'application/octet-stream' && ext === '.opus'
      ? 'audio/opus'
      : mimeType;
    const wantsDownload = request.query.download === '1' || request.query.download === 'true';
    if (wantsDownload) {
      reply.header('Content-Disposition', `attachment; filename="${safeAttachmentName(relPath)}"`);
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

  fastify.get('/api/preview', async (request, reply) => {
    const rootId = request.query.root;
    const relPath = normalizeRelPath(request.query.path || '');
    const root = config.roots.find((item) => item.id === rootId);
    if (!root) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }

    const entry = db.getEntry.get(rootId, relPath);
    if (!entry || entry.is_dir) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }

    const fullPath = safeJoin(root.absPath, relPath);
    if (!fullPath) {
      return sendError(reply, 400, 'invalid_path', 'Invalid path');
    }

    const mimeType = entry.mime || mime.lookup(fullPath) || 'application/octet-stream';
    if (!mimeType.startsWith('image/')) {
      return sendError(reply, 415, 'unsupported_media', 'Preview only available for images');
    }

    const previewPath = previewCachePath(config.previewDir, rootId, relPath, entry.mtime);
    try {
      const cachedPath = await ensurePreview({
        fullPath,
        previewPath,
      });

      if (!cachedPath) {
        reply.header('X-Preview-Fallback', 'original');
        reply.header('Content-Type', mimeType);
        return reply.send(fs.createReadStream(fullPath));
      }

      reply.header('Content-Type', 'image/jpeg');
      return reply.send(fs.createReadStream(cachedPath));
    } catch (error) {
      return sendError(reply, 500, 'preview_failed', 'Preview generation failed');
    }
  });

  fastify.get('/api/album-art', async (request, reply) => {
    const rootId = request.query.root;
    const albumKey = request.query.key;
    const root = rootId === ctx.allRootsId ? true : config.roots.find((item) => item.id === rootId);
    if (!root || !albumKey) {
      return sendError(reply, 400, 'invalid_request', 'Invalid request');
    }
    const art = db.getAlbumArt.get(albumKey);
    if (!art || !art.path) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    if (!fs.existsSync(art.path)) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    reply.header('Content-Type', mime.lookup(art.path) || 'application/octet-stream');
    return reply.send(fs.createReadStream(art.path));
  });
}

module.exports = registerFileRoutes;
