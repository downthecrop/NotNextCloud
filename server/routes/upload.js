const fs = require('fs');
const path = require('path');
const { sendOk, sendError } = require('../lib/response');
const {
  parseBoolean,
  parseSize,
  uploadIdFor,
  uploadTempPath,
  resolveUploadTarget,
  finalizeUpload,
  ensureEmptyFile,
  upsertUploadedFile,
} = require('../lib/uploads');

function registerUploadRoutes(fastify, ctx) {
  const { config, indexer, safeJoin, normalizeParent, uploadChunkBytes } = ctx;

  fastify.get('/api/upload/status', async (request, reply) => {
    if (!config.uploadEnabled) {
      return sendError(reply, 403, 'upload_disabled', 'Uploads are disabled.');
    }
    const rootId = request.query.root;
    const root = config.roots.find((item) => item.id === rootId);
    if (!root) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }

    const { targetRel, error: targetError } = resolveUploadTarget({
      basePath: request.query.path,
      filePath: request.query.file,
      target: request.query.target,
    });
    if (!targetRel) {
      return sendError(reply, 400, 'invalid_request', targetError || 'Missing file name');
    }

    const size = parseSize(request.query.size);
    if (size === null) {
      return sendError(reply, 400, 'invalid_request', 'Invalid size');
    }
    const overwrite = parseBoolean(request.query.overwrite, config.uploadOverwrite);

    const fullPath = safeJoin(root.absPath, targetRel);
    if (!fullPath) {
      return sendError(reply, 400, 'invalid_path', 'Invalid path');
    }

    if (size === 0) {
      try {
        const result = await ensureEmptyFile(fullPath, overwrite);
        if (!result.ok) {
          return sendError(reply, 409, 'exists', result.error, { status: 'exists' });
        }
        await upsertUploadedFile({ db: ctx.db, root, relPath: targetRel, fullPath });
        await indexer.scanPath({ root, relPath: normalizeParent(targetRel), fastScan: true });
        return sendOk({ status: 'complete', uploadId: null, offset: 0, size });
      } catch (error) {
        return sendError(reply, 500, 'upload_failed', 'Failed to create file');
      }
    }

    let existing = null;
    try {
      existing = await fs.promises.lstat(fullPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return sendError(reply, 500, 'upload_failed', 'Failed to access target');
      }
    }
    if (existing) {
      if (existing.isDirectory()) {
        return sendError(reply, 409, 'exists', 'Target is a directory', { status: 'exists' });
      }
      if (existing.isSymbolicLink()) {
        return sendError(reply, 409, 'exists', 'Target is a symlink', { status: 'exists' });
      }
      if (!overwrite) {
        return sendError(reply, 409, 'exists', 'File already exists', { status: 'exists' });
      }
    }

    const uploadId = uploadIdFor(rootId, targetRel, size);
    const partPath = uploadTempPath(config, uploadId);

    let offset = 0;
    try {
      const stats = await fs.promises.stat(partPath);
      offset = stats.size;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return sendError(reply, 500, 'upload_failed', 'Failed to inspect upload');
      }
    }

    if (offset > size) {
      try {
        await fs.promises.unlink(partPath);
      } catch {
        // ignore cleanup failures
      }
      offset = 0;
    }

    if (offset === size) {
      try {
        const result = await finalizeUpload({ partPath, fullPath, overwrite });
        if (!result.ok) {
          return sendError(reply, 409, 'exists', result.error, { status: 'exists' });
        }
        await upsertUploadedFile({ db: ctx.db, root, relPath: targetRel, fullPath });
      } catch (error) {
        return sendError(reply, 500, 'upload_failed', 'Failed to finalize upload');
      }
      return sendOk({ status: 'complete', uploadId, offset: size, size });
    }

    return sendOk({ status: 'ready', uploadId, offset, size });
  });

  fastify.post(
    '/api/upload/chunk',
    { bodyLimit: uploadChunkBytes + 1024 },
    async (request, reply) => {
      if (!config.uploadEnabled) {
        return sendError(reply, 403, 'upload_disabled', 'Uploads are disabled.');
      }
      const rootId = request.query.root;
      const root = config.roots.find((item) => item.id === rootId);
    if (!root) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }

      const { targetRel, error: targetError } = resolveUploadTarget({
        basePath: request.query.path,
        filePath: request.query.file,
        target: request.query.target,
      });
      if (!targetRel) {
        return sendError(reply, 400, 'invalid_request', targetError || 'Missing file name');
      }

      const size = parseSize(request.query.size);
      if (size === null) {
        return sendError(reply, 400, 'invalid_request', 'Invalid size');
      }
      const offset = parseSize(request.query.offset);
      if (offset === null) {
        return sendError(reply, 400, 'invalid_request', 'Invalid offset');
      }
      const overwrite = parseBoolean(request.query.overwrite, config.uploadOverwrite);

      const fullPath = safeJoin(root.absPath, targetRel);
      if (!fullPath) {
        return sendError(reply, 400, 'invalid_path', 'Invalid path');
      }

      if (size === 0) {
        try {
          const result = await ensureEmptyFile(fullPath, overwrite);
          if (!result.ok) {
            return sendError(reply, 409, 'exists', result.error, { status: 'exists' });
          }
          await upsertUploadedFile({ db: ctx.db, root, relPath: targetRel, fullPath });
          return sendOk({ offset: 0, complete: true });
        } catch (error) {
          return sendError(reply, 500, 'upload_failed', 'Failed to create file');
        }
      }

      let existing = null;
      try {
        existing = await fs.promises.lstat(fullPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          return sendError(reply, 500, 'upload_failed', 'Failed to access target');
        }
      }
      if (existing && !overwrite) {
        return sendError(reply, 409, 'exists', 'File already exists', { status: 'exists' });
      }

      const uploadId = uploadIdFor(rootId, targetRel, size);
      const partPath = uploadTempPath(config, uploadId);

      let currentSize = 0;
      try {
        const stats = await fs.promises.stat(partPath);
        currentSize = stats.size;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          return sendError(reply, 500, 'upload_failed', 'Failed to inspect upload');
        }
      }

      if (currentSize !== offset) {
        return sendError(reply, 409, 'offset_mismatch', 'Offset mismatch', {
          expectedOffset: currentSize,
        });
      }
      if (offset > size) {
        return sendError(reply, 400, 'invalid_request', 'Offset beyond file size');
      }

      try {
        await fs.promises.mkdir(path.dirname(partPath), { recursive: true });
        const body = request.body;
        if (!body || !(Buffer.isBuffer(body) || typeof body === 'string')) {
          return sendError(reply, 400, 'invalid_request', 'Missing chunk body');
        }
        const chunkBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        await fs.promises.writeFile(partPath, chunkBuffer, { flag: 'a' });
      } catch (error) {
        return sendError(reply, 500, 'upload_failed', 'Failed to write chunk');
      }

      let newSize = currentSize;
      try {
        newSize = (await fs.promises.stat(partPath)).size;
      } catch (error) {
        return sendError(reply, 500, 'upload_failed', 'Failed to read upload state');
      }

      if (newSize > size) {
        try {
          await fs.promises.unlink(partPath);
        } catch {
          // ignore cleanup failures
        }
        return sendError(reply, 400, 'invalid_request', 'Upload exceeded declared size');
      }

      if (newSize === size) {
        try {
          const result = await finalizeUpload({ partPath, fullPath, overwrite });
          if (!result.ok) {
            return sendError(reply, 409, 'exists', result.error, { status: 'exists' });
          }
        } catch (error) {
          return sendError(reply, 500, 'upload_failed', 'Failed to finalize upload');
        }
        await upsertUploadedFile({ db: ctx.db, root, relPath: targetRel, fullPath });
        await indexer.scanPath({ root, relPath: normalizeParent(targetRel), fastScan: true });
        return sendOk({ offset: newSize, complete: true });
      }

      return sendOk({ offset: newSize, complete: false });
    }
  );
}

module.exports = registerUploadRoutes;
