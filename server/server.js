const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');

const { loadConfig } = require('./config');
const { initDb, ENTRY_COLUMNS, ENTRY_SELECT, ENTRY_SELECT_WITH_ID } = require('./db');
const { createIndexer } = require('./indexer');
const { safeJoin, normalizeRelPath, normalizeParent } = require('./utils');
const { previewCachePath, ensurePreview } = require('./preview');

const { sendOk, sendError } = require('./lib/response');
const { getRequestToken } = require('./lib/auth');
const { createPreviewQueue } = require('./lib/previewQueue');
const { purgeTrash } = require('./lib/trash');
const { upsertUploadedFile } = require('./lib/uploads');

const registerAuthRoutes = require('./routes/auth');
const registerInfoRoutes = require('./routes/info');
const registerRootsRoutes = require('./routes/roots');
const registerLibraryRoutes = require('./routes/library');
const registerFileRoutes = require('./routes/files');
const registerUploadRoutes = require('./routes/upload');
const registerScanRoutes = require('./routes/scan');
const registerTrashRoutes = require('./routes/trash');
const registerZipRoutes = require('./routes/zip');

const projectRoot = path.resolve(__dirname, '..');
const config = loadConfig(projectRoot);
const configPath = path.join(projectRoot, 'config.json');
const ALL_ROOTS_ID = '__all__';
const API_VERSION = 1;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const TRASH_RETENTION_MS = Math.max(0, config.trashRetentionDays || 0) * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = Math.max(0, config.sessionTtlHours || 0) * 60 * 60 * 1000;

const serverPackagePath = path.join(__dirname, 'package.json');
const serverVersion = fs.existsSync(serverPackagePath)
  ? JSON.parse(fs.readFileSync(serverPackagePath, 'utf8')).version || '0.0.0'
  : '0.0.0';

function ensureDir(targetPath) {
  if (!targetPath) {
    return;
  }
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

function readConfigFile() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function writeConfigFile(nextConfig) {
  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}

async function clearPreviewCache(dirPath) {
  ensureDir(dirPath);
  const entries = await fs.promises.readdir(dirPath);
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (stats.isFile()) {
          await fs.promises.unlink(fullPath);
        } else if (stats.isDirectory()) {
          await fs.promises.rm(fullPath, { recursive: true, force: true });
        }
      } catch {
        return;
      }
    })
  );
}

ensureDir(path.dirname(config.dbPath));
ensureDir(config.previewDir);
ensureDir(config.uploadTempDir);
ensureDir(config.trashDir);

const db = initDb(config.dbPath);

const fastify = Fastify({
  logger: {
    redact: ['req.headers.authorization'],
  },
});

fastify.addContentTypeParser(
  'application/octet-stream',
  { parseAs: 'buffer' },
  (req, payload, done) => {
    done(null, payload);
  }
);

fastify.addHook('onSend', async (request, reply, payload) => {
  if (request.raw.url.startsWith('/api')) {
    reply.header('X-Api-Version', API_VERSION);
    reply.header('X-Server-Version', serverVersion);
  }
  return payload;
});

const sessions = new Map();

fastify.addHook('onRequest', async (request, reply) => {
  if (!request.raw.url.startsWith('/api')) {
    return;
  }
  if (config.devMode) {
    return;
  }
  if (request.raw.url.startsWith('/api/login') || request.raw.url.startsWith('/api/health')) {
    return;
  }

  const token = getRequestToken(request, {
    cookieName: config.sessionCookieName,
    allowQueryToken: config.allowQueryToken,
  });
  if (!token) {
    return sendError(reply, 401, 'auth_required', 'Authentication required');
  }
  const session = sessions.get(token);
  if (!session) {
    return sendError(reply, 401, 'auth_required', 'Authentication required');
  }
  if (session.expiresAt && session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return sendError(reply, 401, 'session_expired', 'Session expired');
  }
});

const indexer = createIndexer(config, db, fastify.log);
indexer.start();

const previewQueue = createPreviewQueue({ concurrency: config.previewConcurrency });

if (SESSION_TTL_MS > 0) {
  const cleanupIntervalMs = Math.min(SESSION_TTL_MS, 60 * 60 * 1000);
  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (session.expiresAt && session.expiresAt <= now) {
        sessions.delete(token);
      }
    }
  }, cleanupIntervalMs);
}

const ctx = {
  config,
  db,
  indexer,
  projectRoot,
  loadConfig,
  readConfigFile,
  writeConfigFile,
  safeJoin,
  normalizeRelPath,
  normalizeParent,
  previewCachePath,
  ensurePreview,
  previewQueue,
  clearPreviewCache,
  entrySelect: ENTRY_SELECT,
  entrySelectWithId: ENTRY_SELECT_WITH_ID,
  entryColumns: ENTRY_COLUMNS,
  allRootsId: ALL_ROOTS_ID,
  uploadChunkBytes: UPLOAD_CHUNK_BYTES,
  sessions,
  serverVersion,
  apiVersion: API_VERSION,
  upsertUploadedFile,
};

registerInfoRoutes(fastify, ctx);
registerAuthRoutes(fastify, ctx);
registerRootsRoutes(fastify, ctx);
registerLibraryRoutes(fastify, ctx);
registerFileRoutes(fastify, ctx);
registerUploadRoutes(fastify, ctx);
registerScanRoutes(fastify, ctx);
registerTrashRoutes(fastify, ctx);
registerZipRoutes(fastify, ctx);

const staticRoot = path.join(projectRoot, 'web', 'dist');
if (fs.existsSync(staticRoot)) {
  fastify.register(fastifyStatic, {
    root: staticRoot,
    index: 'index.html',
    wildcard: false,
  });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url.startsWith('/api')) {
      return sendError(reply, 404, 'not_found', 'Not found');
    }
    return reply.sendFile('index.html');
  });
} else {
  fastify.get('/', async () => {
    return sendOk({ message: 'Frontend not built. Run web build to serve UI.' });
  });
}

if (TRASH_RETENTION_MS > 0) {
  const runCleanup = async () => {
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    try {
      const removed = await purgeTrash({ db, config }, { olderThan: cutoff });
      if (removed) {
        fastify.log.info({ removed }, 'Trash cleanup completed');
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Trash cleanup failed');
    }
  };
  runCleanup();
  setInterval(runCleanup, 24 * 60 * 60 * 1000);
}

fastify.listen({ host: config.host, port: config.port }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`bind ${address}`);
});
