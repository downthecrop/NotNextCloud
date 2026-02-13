const fs = require('fs');
const path = require('path');
const { sendOk, sendError } = require('../lib/response');
const { resolveRootOrReply } = require('../lib/route');
const {
  parseBoolean,
  parseSize,
  uploadIdFor,
  uploadTempPath,
  resolveUploadTarget,
  finalizeUpload,
  ensureEmptyFile,
  upsertUploadedFile,
  maybeCompressUploadedMedia,
} = require('../lib/uploads');

function registerUploadRoutes(fastify, ctx) {
  const BATCH_STATUS_MAX_ITEMS = 500;
  const { config, indexer, safeJoin, normalizeParent, uploadChunkBytes } = ctx;
  const resolveUploadRoot = (query, reply) => {
    if (!config.uploadEnabled) {
      sendError(reply, 403, 'upload_disabled', 'Uploads are disabled.');
      return null;
    }
    return resolveRootOrReply({ roots: config.roots, rootId: query.root, reply });
  };
  const resolveTargetFromQuery = (query) =>
    resolveUploadTarget({
      basePath: query.path,
      filePath: query.file,
      target: query.target,
      camera: query.camera,
      cameraBasePath: config.uploadCameraBasePath,
      cameraMonth: query.cameraMonth,
      cameraDate: query.cameraDate,
      capturedAt: query.capturedAt,
      createdAt: query.createdAt,
      modifiedAt: query.modifiedAt,
      lastModified: query.lastModified,
    });

  async function finalizeAndIndexUpload({ root, targetRel, fullPath, partPath, overwrite }) {
    const result = await finalizeUpload({ partPath, fullPath, overwrite });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const processed = await maybeCompressUploadedMedia({
      config,
      relPath: targetRel,
      fullPath,
      overwrite,
      logger: fastify.log,
    });
    if (processed.relPath !== targetRel) {
      ctx.db.deleteEntryByPath.run(root.id, targetRel);
    }
    await upsertUploadedFile({
      db: ctx.db,
      root,
      relPath: processed.relPath,
      fullPath: processed.fullPath,
    });
    await indexer.scanPath({
      root,
      relPath: normalizeParent(processed.relPath),
      fastScan: true,
    });
    return { ok: true, processed };
  }

  async function resolveUploadStatus({ rootId, root, params }) {
    const { targetRel, error: targetError } = resolveTargetFromQuery(params || {});
    if (!targetRel) {
      return {
        ok: false,
        statusCode: 400,
        code: 'invalid_request',
        message: targetError || 'Missing file name',
      };
    }

    const size = parseSize(params?.size);
    if (size === null) {
      return {
        ok: false,
        statusCode: 400,
        code: 'invalid_request',
        message: 'Invalid size',
      };
    }

    const overwrite = parseBoolean(params?.overwrite, config.uploadOverwrite);
    const fullPath = safeJoin(root.absPath, targetRel);
    if (!fullPath) {
      return {
        ok: false,
        statusCode: 400,
        code: 'invalid_path',
        message: 'Invalid path',
      };
    }

    if (size === 0) {
      try {
        const result = await ensureEmptyFile(fullPath, overwrite);
        if (!result.ok) {
          return {
            ok: false,
            statusCode: 409,
            code: 'exists',
            message: result.error,
            details: { status: 'exists', path: targetRel },
          };
        }
        await upsertUploadedFile({ db: ctx.db, root, relPath: targetRel, fullPath });
        await indexer.scanPath({ root, relPath: normalizeParent(targetRel), fastScan: true });
        return {
          ok: true,
          data: { status: 'complete', uploadId: null, offset: 0, size, path: targetRel },
        };
      } catch (error) {
        return {
          ok: false,
          statusCode: 500,
          code: 'upload_failed',
          message: 'Failed to create file',
        };
      }
    }

    let existing = null;
    try {
      existing = await fs.promises.lstat(fullPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return {
          ok: false,
          statusCode: 500,
          code: 'upload_failed',
          message: 'Failed to access target',
        };
      }
    }
    if (existing) {
      if (existing.isDirectory()) {
        return {
          ok: false,
          statusCode: 409,
          code: 'exists',
          message: 'Target is a directory',
          details: { status: 'exists', path: targetRel },
        };
      }
      if (existing.isSymbolicLink()) {
        return {
          ok: false,
          statusCode: 409,
          code: 'exists',
          message: 'Target is a symlink',
          details: { status: 'exists', path: targetRel },
        };
      }
      if (!overwrite) {
        return {
          ok: false,
          statusCode: 409,
          code: 'exists',
          message: 'File already exists',
          details: { status: 'exists', path: targetRel },
        };
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
        return {
          ok: false,
          statusCode: 500,
          code: 'upload_failed',
          message: 'Failed to inspect upload',
        };
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
        const completed = await finalizeAndIndexUpload({
          root,
          targetRel,
          fullPath,
          partPath,
          overwrite,
        });
        if (!completed.ok) {
          return {
            ok: false,
            statusCode: 409,
            code: 'exists',
            message: completed.error,
            details: { status: 'exists', path: targetRel },
          };
        }
        const processed = completed.processed;
        return {
          ok: true,
          data: {
            status: 'complete',
            uploadId,
            offset: size,
            size,
            path: processed.relPath,
            compressed: processed.compressed === true,
            outputFormat: processed.outputFormat || null,
          },
        };
      } catch (error) {
        return {
          ok: false,
          statusCode: 500,
          code: 'upload_failed',
          message: 'Failed to finalize upload',
        };
      }
    }

    return { ok: true, data: { status: 'ready', uploadId, offset, size, path: targetRel } };
  }

  fastify.get('/api/upload/status', async (request, reply) => {
    const resolvedRoot = resolveUploadRoot(request.query, reply);
    if (!resolvedRoot) {
      return;
    }
    const { rootId, root } = resolvedRoot;
    const statusResult = await resolveUploadStatus({ rootId, root, params: request.query });
    if (!statusResult.ok) {
      return sendError(
        reply,
        statusResult.statusCode,
        statusResult.code,
        statusResult.message,
        statusResult.details
      );
    }
    return sendOk(statusResult.data);
  });

  fastify.post('/api/upload/status/batch', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const resolvedRoot = resolveUploadRoot(body, reply);
    if (!resolvedRoot) {
      return;
    }
    const { rootId, root } = resolvedRoot;
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return sendError(reply, 400, 'invalid_request', 'Missing items');
    }
    if (items.length > BATCH_STATUS_MAX_ITEMS) {
      return sendError(
        reply,
        400,
        'invalid_request',
        `Too many items (max ${BATCH_STATUS_MAX_ITEMS})`
      );
    }

    const defaults = {
      path: body.path,
      file: body.file,
      target: body.target,
      camera: body.camera,
      cameraMonth: body.cameraMonth,
      cameraDate: body.cameraDate,
      capturedAt: body.capturedAt,
      createdAt: body.createdAt,
      modifiedAt: body.modifiedAt,
      lastModified: body.lastModified,
      overwrite: body.overwrite,
      size: body.size,
    };

    const batchResults = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        batchResults.push({
          index,
          ok: false,
          status: 'error',
          error: { code: 'invalid_request', message: 'Invalid item payload' },
        });
        continue;
      }

      const params = { ...defaults, ...item };
      const statusResult = await resolveUploadStatus({ rootId, root, params });
      if (!statusResult.ok) {
        if (statusResult.code === 'exists') {
          batchResults.push({
            index,
            ok: false,
            status: 'exists',
            error: { code: statusResult.code, message: statusResult.message },
            path: statusResult.details?.path || null,
          });
          continue;
        }
        batchResults.push({
          index,
          ok: false,
          status: 'error',
          error: { code: statusResult.code, message: statusResult.message },
          path: statusResult.details?.path || null,
        });
        continue;
      }

      batchResults.push({
        index,
        ok: true,
        ...statusResult.data,
      });
    }

    return sendOk({ items: batchResults });
  });

  fastify.post(
    '/api/upload/chunk',
    { bodyLimit: uploadChunkBytes + 1024 },
    async (request, reply) => {
      const resolvedRoot = resolveUploadRoot(request.query, reply);
      if (!resolvedRoot) {
        return;
      }
      const { rootId, root } = resolvedRoot;

      const { targetRel, error: targetError } = resolveTargetFromQuery(request.query);
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
          await indexer.scanPath({ root, relPath: normalizeParent(targetRel), fastScan: true });
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
          const completed = await finalizeAndIndexUpload({
            root,
            targetRel,
            fullPath,
            partPath,
            overwrite,
          });
          if (!completed.ok) {
            return sendError(reply, 409, 'exists', completed.error, { status: 'exists' });
          }
          const processed = completed.processed;
          return sendOk({
            offset: newSize,
            complete: true,
            path: processed.relPath,
            compressed: processed.compressed === true,
            outputFormat: processed.outputFormat || null,
          });
        } catch (error) {
          return sendError(reply, 500, 'upload_failed', 'Failed to finalize upload');
        }
      }

      return sendOk({ offset: newSize, complete: false });
    }
  );
}

module.exports = registerUploadRoutes;
