const fs = require('fs');
const { sendOk, sendError } = require('../lib/response');
const { resolveRootPathOrReply } = require('../lib/route');

function registerScanRoutes(fastify, ctx) {
  const { config, indexer, safeJoin, normalizeRelPath, clearPreviewCache } = ctx;

  fastify.post('/api/scan', async (request, reply) => {
    const mode = (request.body?.mode || request.query?.mode || 'incremental').toLowerCase();
    const rootId = request.body?.root || request.query?.root || '';
    const relPath = request.body?.path || request.query?.path || '';
    const fastScan = mode === 'fast' || (mode === 'incremental' && config.fastScan);
    const fullScan = mode === 'full';
    const scanOptions = { fastScan: fullScan ? false : fastScan };
    if (rootId) {
      const resolved = resolveRootPathOrReply({
        roots: config.roots,
        rootId,
        relPath,
        normalizeRelPath,
        safeJoin,
        reply,
      });
      if (!resolved) {
        return;
      }
      const root = resolved.root;
      const targetPath = resolved.fullPath;
      let stats;
      try {
        stats = await fs.promises.stat(targetPath);
      } catch (error) {
        return sendError(reply, 404, 'not_found', 'Path not found');
      }
      if (!stats.isDirectory()) {
        return sendError(reply, 400, 'invalid_path', 'Path must be a directory');
      }
      await indexer.scanPath({ root, relPath: resolved.relPath, ...scanOptions });
    } else {
      await indexer.scanAll(scanOptions);
    }
    return sendOk({ status: indexer.getStatus() });
  });

  fastify.get('/api/status', async () => {
    return sendOk(indexer.getStatus());
  });

  fastify.get('/api/scan/settings', async () => {
    return sendOk({
      scanIntervalSeconds: config.scanIntervalSeconds || 60,
      fastScan: Boolean(config.fastScan),
      scanFsConcurrency: config.scanFsConcurrency || 8,
      fullScanIntervalHours: Number(config.fullScanIntervalHours || 0),
    });
  });

  fastify.put('/api/scan/settings', async (request, reply) => {
    const scanIntervalSeconds = Math.max(10, parseInt(request.body?.scanIntervalSeconds, 10) || 60);
    const fastScan = request.body?.fastScan !== false;
    const scanFsConcurrency = Math.max(1, parseInt(request.body?.scanFsConcurrency, 10) || 8);
    const fullScanIntervalHours = Math.max(
      0,
      parseInt(request.body?.fullScanIntervalHours, 10) || 0
    );
    try {
      const nextConfig = ctx.readConfigFile();
      nextConfig.scanIntervalSeconds = scanIntervalSeconds;
      nextConfig.fastScan = fastScan;
      nextConfig.scanFsConcurrency = scanFsConcurrency;
      nextConfig.fullScanIntervalHours = fullScanIntervalHours;
      ctx.writeConfigFile(nextConfig);
      const reloaded = ctx.loadConfig(ctx.projectRoot);
      Object.assign(config, reloaded);
      indexer.reschedule?.();
      return sendOk(indexer.getStatus());
    } catch (error) {
      return sendError(reply, 500, 'config_write_failed', 'Failed to update scan settings.');
    }
  });

  fastify.post('/api/previews/rebuild', async () => {
    await clearPreviewCache(config.previewDir);
    ctx.db.db.exec('DELETE FROM album_art');
    return sendOk({ cleared: true });
  });
}

module.exports = registerScanRoutes;
