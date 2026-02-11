const crypto = require('crypto');
const fs = require('fs');
const mime = require('mime-types');
const { sendError } = require('../lib/response');
const { resolveMimeType, sendFileResponse } = require('../lib/fileResponse');
const { safeAttachmentName } = require('../lib/paths');
const { parseBooleanFlag, resolveRootPathOrReply, resolveRootOrReply } = require('../lib/route');

function albumKeyFor(artist, album) {
  const safeArtist = artist || 'Unknown Artist';
  const safeAlbum = album || 'Unknown Album';
  return crypto
    .createHash('sha1')
    .update(`${safeArtist.toLowerCase()}::${safeAlbum.toLowerCase()}`)
    .digest('hex');
}

function registerFileRoutes(fastify, ctx) {
  const { config, db, previewCachePath, ensurePreview, previewQueue, safeJoin, normalizeRelPath } =
    ctx;
  const resolveRootAndPath = (query, reply) =>
    resolveRootPathOrReply({
      roots: config.roots,
      rootId: query.root,
      relPath: query.path,
      normalizeRelPath,
      safeJoin,
      reply,
    });

  fastify.get('/api/file', async (request, reply) => {
    const resolved = resolveRootAndPath(request.query, reply);
    if (!resolved) {
      return;
    }
    const { relPath, fullPath } = resolved;

    let stats;
    try {
      stats = await fs.promises.stat(fullPath);
    } catch (error) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }

    if (stats.isDirectory()) {
      return sendError(reply, 400, 'invalid_path', 'Directory requested');
    }

    const wantsDownload = parseBooleanFlag(request.query.download, false);
    const resolvedMime = resolveMimeType(fullPath);
    return sendFileResponse({
      reply,
      fullPath,
      stats,
      mimeType: resolvedMime,
      rangeHeader: request.headers.range,
      downloadName: wantsDownload ? safeAttachmentName(relPath) : null,
    });
  });

  fastify.get('/api/preview', async (request, reply) => {
    const resolved = resolveRootAndPath(request.query, reply);
    if (!resolved) {
      return;
    }
    const { rootId, relPath, fullPath } = resolved;

    const entry = db.getEntry.get(rootId, relPath);
    if (!entry || entry.is_dir) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }

    const mimeType = entry.mime || mime.lookup(fullPath) || 'application/octet-stream';
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');
    if (!isImage && !isVideo) {
      return sendError(reply, 415, 'unsupported_media', 'Preview only available for images/videos');
    }

    const previewPath = previewCachePath(config.previewDir, rootId, relPath, entry.mtime);
    try {
      const cachedPath = await previewQueue(previewPath, () =>
        ensurePreview({
          fullPath,
          previewPath,
          mimeType,
        })
      );

      if (!cachedPath) {
        if (isImage) {
          reply.header('X-Preview-Fallback', 'original');
          reply.header('Content-Type', mimeType);
          return reply.send(fs.createReadStream(fullPath));
        }
        return sendError(reply, 415, 'unsupported_media', 'Preview not available for video');
      }

      reply.header('Content-Type', 'image/jpeg');
      return reply.send(fs.createReadStream(cachedPath));
    } catch (error) {
      return sendError(reply, 500, 'preview_failed', 'Preview generation failed');
    }
  });

  fastify.get('/api/album-art', async (request, reply) => {
    const rootId = request.query.root;
    const albumKey =
      request.query.key || albumKeyFor(request.query.artist, request.query.album);
    let root = true;
    if (rootId !== ctx.allRootsId) {
      const resolvedRoot = resolveRootOrReply({ roots: config.roots, rootId, reply });
      if (!resolvedRoot) {
        return;
      }
      root = resolvedRoot.root;
    }
    if (!albumKey) {
      return sendError(reply, 400, 'invalid_request', 'Invalid request');
    }
    const art = db.getAlbumArt.get(albumKey);
    if (!art || !art.path) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    let artStats;
    try {
      artStats = await fs.promises.stat(art.path);
    } catch {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    if (!artStats.isFile()) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    reply.header('Content-Type', mime.lookup(art.path) || 'application/octet-stream');
    return reply.send(fs.createReadStream(art.path));
  });
}

module.exports = registerFileRoutes;
