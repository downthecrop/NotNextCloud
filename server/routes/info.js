const { sendOk } = require('../lib/response');
const { formatRootsResponse } = require('../lib/roots');

function registerInfoRoutes(fastify, ctx) {
  const { config, serverVersion, apiVersion, uploadChunkBytes, indexer, db } = ctx;

  const buildInfo = () => {
    const maxBytes = config.uploadMaxBytes > 0 ? config.uploadMaxBytes : null;
    const maxFiles = config.uploadMaxFiles > 0 ? config.uploadMaxFiles : null;
    return {
      apiVersion,
      serverVersion,
      devMode: config.devMode,
      serverTime: new Date().toISOString(),
      auth: {
        required: !config.devMode,
        mode: 'bearer',
        cookieName: config.sessionCookieName || 'lc_token',
        sessionTtlHours: config.sessionTtlHours || 0,
        queryToken: Boolean(config.allowQueryToken),
      },
      capabilities: {
        roots: true,
        search: true,
        media: true,
        albums: true,
        previews: {
          enabled: true,
          concurrency: config.previewConcurrency || 1,
        },
        zip: true,
        pagination: {
          cursor: true,
          includeTotal: true,
          maxLimit: 200,
        },
        searchConfig: {
          fts: Boolean(db?.ftsEnabled),
        },
        indexing: {
          scanBatchSize: config.scanBatchSize || 0,
          fastScan: Boolean(config.fastScan),
        },
        upload: {
          enabled: config.uploadEnabled,
          maxBytes,
          maxFiles,
          overwriteByDefault: config.uploadOverwrite,
          pathParam: true,
          chunked: true,
          resume: true,
          chunkBytes: uploadChunkBytes,
          protocol: 'chunked-v1',
        },
        trash: {
          enabled: true,
          retentionDays: config.trashRetentionDays || 0,
        },
      },
    };
  };

  fastify.get('/api/health', async () => {
    return sendOk({
      status: 'ok',
      devMode: config.devMode,
      apiVersion,
      serverVersion,
    });
  });

  fastify.get('/api/info', async () => {
    return sendOk(buildInfo());
  });

  fastify.get('/api/bootstrap', async () => {
    return sendOk({
      info: buildInfo(),
      roots: formatRootsResponse(config.roots),
      status: indexer?.getStatus ? indexer.getStatus() : null,
    });
  });
}

module.exports = registerInfoRoutes;
