const { sendOk, sendError } = require('../lib/response');
const { formatRootsResponse, sanitizeRootPayload } = require('../lib/roots');

function registerRootsRoutes(fastify, ctx) {
  const { config, indexer } = ctx;

  fastify.get('/api/roots', async () => {
    return sendOk(formatRootsResponse(config.roots));
  });

  fastify.put('/api/roots', async (request, reply) => {
    if (!Array.isArray(request.body?.roots)) {
      return sendError(reply, 400, 'invalid_request', 'Roots must be an array.');
    }
    let sanitized;
    try {
      sanitized = sanitizeRootPayload(request.body.roots);
    } catch (error) {
      return sendError(reply, 400, 'invalid_request', error.message || 'Invalid roots payload.');
    }
    try {
      const nextConfig = ctx.readConfigFile();
      nextConfig.roots = sanitized;
      ctx.writeConfigFile(nextConfig);
      const reloaded = ctx.loadConfig(ctx.projectRoot);
      Object.assign(config, reloaded);
      if (indexer?.scanAll) {
        indexer.scanAll().catch((error) => {
          fastify.log.error({ err: error }, 'Scan after roots update failed');
        });
      }
      return sendOk(formatRootsResponse(config.roots));
    } catch (error) {
      if (error?.code === 'EROFS' || error?.code === 'EPERM') {
        return sendError(
          reply,
          500,
          'config_readonly',
          'config.json is read-only. Update docker-compose to mount it read/write.'
        );
      }
      return sendError(reply, 500, 'config_write_failed', 'Failed to write config.json.');
    }
  });
}

module.exports = registerRootsRoutes;
