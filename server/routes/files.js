const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
  const { config, db, previewCachePath, previewQueue, safeJoin, normalizeRelPath } =
    ctx;
  const statFileIfNotSymlink = async (fullPath) => {
    let linkStats;
    try {
      linkStats = await fs.promises.lstat(fullPath);
    } catch {
      return { missing: true };
    }
    if (linkStats.isSymbolicLink()) {
      return { symlink: true };
    }
    let stats;
    try {
      stats = await fs.promises.stat(fullPath);
    } catch {
      return { missing: true };
    }
    return { stats };
  };
  const resolveRootAndPath = (query, reply) =>
    resolveRootPathOrReply({
      roots: config.roots,
      rootId: query.root,
      relPath: query.path,
      normalizeRelPath,
      safeJoin,
      reply,
    });

  fastify.get('/thumbs/:key.jpg', async (request, reply) => {
    const key = String(request.params?.key || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(key)) {
      return sendError(reply, 400, 'invalid_thumb', 'Invalid thumbnail key');
    }
    const fullPath = path.join(config.previewDir, `${key}.jpg`);
    const { stats, missing, symlink } = await statFileIfNotSymlink(fullPath);
    if (missing || !stats?.isFile()) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    if (symlink) {
      return sendError(reply, 400, 'invalid_path', 'Symlinks are not supported');
    }
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(fs.createReadStream(fullPath));
  });

  fastify.get('/api/file', async (request, reply) => {
    const resolved = resolveRootAndPath(request.query, reply);
    if (!resolved) {
      return;
    }
    const { relPath, fullPath } = resolved;

    const { stats, missing, symlink } = await statFileIfNotSymlink(fullPath);
    if (missing) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    if (symlink) {
      return sendError(reply, 400, 'invalid_path', 'Symlinks are not supported');
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
    const requestedMtime = Number(request.query?.mtime);
    const hasRequestedMtime = Number.isFinite(requestedMtime) && requestedMtime > 0;
    const requestedMime =
      typeof request.query?.mime === 'string' && request.query.mime !== ''
        ? request.query.mime
        : null;
    let mtimeForPreview = hasRequestedMtime ? Math.floor(requestedMtime) : null;
    let storedMime = requestedMime && requestedMime !== 'application/octet-stream' ? requestedMime : null;
    let entry = null;
    if (!mtimeForPreview || !storedMime) {
      entry = db.getEntry.get(rootId, relPath);
      if (!entry || entry.is_dir) {
        return sendError(reply, 404, 'not_found', 'Not found');
      }
      if (!mtimeForPreview) {
        mtimeForPreview = Number.isFinite(entry.mtime) ? Math.floor(entry.mtime) : null;
      }
      if (!storedMime && entry.mime && entry.mime !== 'application/octet-stream') {
        storedMime = entry.mime;
      }
    }

    const { stats, missing, symlink } = await statFileIfNotSymlink(fullPath);
    if (missing || !stats?.isFile()) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    if (symlink) {
      return sendError(reply, 400, 'invalid_path', 'Symlinks are not supported');
    }

    if (!mtimeForPreview) {
      mtimeForPreview = Math.floor(stats.mtimeMs);
    }
    const mimeType = storedMime || mime.lookup(fullPath) || 'application/octet-stream';
    const isImage = mimeType.startsWith('image/');
    const isVideo = mimeType.startsWith('video/');
    if (!isImage && !isVideo) {
      return sendError(reply, 415, 'unsupported_media', 'Preview only available for images/videos');
    }

    const previewPath = previewCachePath(config.previewDir, rootId, relPath, mtimeForPreview);
    if (fs.existsSync(previewPath)) {
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(fs.createReadStream(previewPath));
    }
    const abortController = new AbortController();
    const abortPreview = () => abortController.abort();
    request.raw.once('aborted', abortPreview);
    request.raw.once('close', abortPreview);
    try {
      const cachedPath = await previewQueue(
        previewPath,
        {
          fullPath,
          previewPath,
          mimeType,
        },
        { signal: abortController.signal, priority: 'high' }
      );
      if (abortController.signal.aborted || reply.sent || reply.raw.destroyed) {
        return;
      }

      if (!cachedPath) {
        if (isImage) {
          reply.header('X-Preview-Fallback', 'original');
          reply.header('Content-Type', mimeType);
          return reply.send(fs.createReadStream(fullPath));
        }
        return sendError(reply, 415, 'unsupported_media', 'Preview not available for video');
      }

      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(fs.createReadStream(cachedPath));
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }
      return sendError(reply, 500, 'preview_failed', 'Preview generation failed');
    } finally {
      request.raw.off?.('aborted', abortPreview);
      request.raw.off?.('close', abortPreview);
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
    const { stats: artStats, missing, symlink } = await statFileIfNotSymlink(art.path);
    if (missing) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    if (symlink) {
      return sendError(reply, 400, 'invalid_path', 'Symlinks are not supported');
    }
    if (!artStats.isFile()) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    reply.header('Content-Type', mime.lookup(art.path) || 'application/octet-stream');
    return reply.send(fs.createReadStream(art.path));
  });
}

module.exports = registerFileRoutes;
