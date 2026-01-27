const { sendOk } = require('../lib/response');

function registerInfoRoutes(fastify, ctx) {
  const { config, serverVersion, apiVersion, uploadChunkBytes } = ctx;

  fastify.get('/api/health', async () => {
    return sendOk({
      status: 'ok',
      devMode: config.devMode,
      apiVersion,
      serverVersion,
    });
  });

  fastify.get('/api/info', async () => {
    const maxBytes = config.uploadMaxBytes > 0 ? config.uploadMaxBytes : null;
    const maxFiles = config.uploadMaxFiles > 0 ? config.uploadMaxFiles : null;
    return sendOk({
      apiVersion,
      serverVersion,
      devMode: config.devMode,
      serverTime: new Date().toISOString(),
      auth: {
        required: !config.devMode,
        mode: 'bearer',
      },
      capabilities: {
        roots: true,
        search: true,
        media: true,
        albums: true,
        previews: true,
        zip: true,
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
    });
  });
}

module.exports = registerInfoRoutes;
