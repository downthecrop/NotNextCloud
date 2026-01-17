const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const mime = require('mime-types');
const archiver = require('archiver');

const { loadConfig } = require('./config');
const { initDb } = require('./db');
const { createIndexer } = require('./indexer');
const { safeJoin, normalizeRelPath } = require('./utils');
const { previewCachePath, ensurePreview } = require('./preview');

const projectRoot = path.resolve(__dirname, '..');
const config = loadConfig(projectRoot);

function ensureDir(targetPath) {
  if (!targetPath) {
    return;
  }
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
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

const db = initDb(config.dbPath);

const fastify = Fastify({
  logger: true,
});

const sessions = new Map();

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getBearerToken(request) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7);
}

function getRequestToken(request) {
  return getBearerToken(request) || request.query?.token || null;
}

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

  const token = getRequestToken(request);
  if (!token || !sessions.has(token)) {
    reply.code(401);
    reply.send({ error: 'Authentication required' });
  }
});

fastify.get('/api/health', async () => {
  return { status: 'ok', devMode: config.devMode };
});

fastify.post('/api/login', async (request, reply) => {
  const { user, pass } = request.body || {};
  if (user !== config.auth.user || pass !== config.auth.pass) {
    reply.code(401);
    return { error: 'Invalid credentials' };
  }
  const token = createToken();
  sessions.set(token, {
    user,
    createdAt: Date.now(),
  });
  return { token };
});

fastify.post('/api/logout', async (request) => {
  const token = getRequestToken(request);
  if (token) {
    sessions.delete(token);
  }
  return { ok: true };
});

fastify.get('/api/roots', async () => {
  return config.roots.map((root) => ({
    id: root.id,
    name: root.name,
  }));
});

fastify.get('/api/list', async (request, reply) => {
  const rootId = request.query.root;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }

  const relPath = normalizeRelPath(request.query.path || '');
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
  const rows = db.listChildren.all(rootId, relPath, limit, offset);
  const total = db.countChildren.get(rootId, relPath)?.count || 0;
  const items = rows.map((row) => ({
    path: row.rel_path,
    name: row.name,
    size: row.size,
    mtime: row.mtime,
    mime: row.mime,
    ext: row.ext,
    isDir: Boolean(row.is_dir),
  }));
  return { items, total };
});

fastify.get('/api/search', async (request, reply) => {
  const rootId = request.query.root;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }
  const query = (request.query.q || '').trim();
  if (!query) {
    return { items: [], total: 0 };
  }
  const type = (request.query.type || 'all').toLowerCase();
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
  const like = `%${query}%`;
  let rows = [];
  let total = 0;
  if (type === 'photos') {
    rows = db.searchPhotos.all(rootId, like, limit, offset);
    total = db.countSearchPhotos.get(rootId, like)?.count || 0;
  } else if (type === 'music') {
    rows = db.searchMusic.all(rootId, like, like, like, like, limit, offset);
    total = db.countSearchMusic.get(rootId, like, like, like, like)?.count || 0;
  } else {
    rows = db.searchByName.all(rootId, like, limit, offset);
    total = db.countSearch.get(rootId, like)?.count || 0;
  }
  const items = rows.map((row) => ({
    path: row.rel_path,
    name: row.name,
    size: row.size,
    mtime: row.mtime,
    mime: row.mime,
    ext: row.ext,
    isDir: Boolean(row.is_dir),
    title: row.title || null,
    artist: row.artist || null,
    album: row.album || null,
    duration: row.duration || null,
    albumKey: row.album_key || null,
  }));
  return { items, total };
});

fastify.get('/api/media', async (request, reply) => {
  const rootId = request.query.root;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }

  const type = (request.query.type || '').toLowerCase();
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);

  let rows = [];
  let total = 0;
  if (type === 'photos') {
    rows = db.listPhotos.all(rootId, limit, offset);
    total = db.countPhotos.get(rootId)?.count || 0;
  } else if (type === 'music') {
    rows = db.listMusic.all(rootId, limit, offset);
    total = db.countMusic.get(rootId)?.count || 0;
  } else {
    reply.code(400);
    return { error: 'Invalid media type' };
  }

  const items = rows.map((row) => ({
    path: row.rel_path,
    name: row.name,
    size: row.size,
    mtime: row.mtime,
    mime: row.mime,
    ext: row.ext,
    isDir: Boolean(row.is_dir),
    title: row.title || null,
    artist: row.artist || null,
    album: row.album || null,
    duration: row.duration || null,
    albumKey: row.album_key || null,
  }));

  return { items, total };
});

fastify.get('/api/music/albums', async (request, reply) => {
  const rootId = request.query.root;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
  const rows = db.listAlbums.all(rootId, limit, offset);
  const total = db.countAlbums.get(rootId)?.count || 0;
  const items = rows.map((row) => {
    const art = row.album_key ? db.getAlbumArt.get(row.album_key) : null;
    return {
      albumKey: row.album_key,
      album: row.album || 'Unknown Album',
      artist: row.artist || 'Unknown Artist',
      tracks: row.tracks,
      latest: row.latest,
      coverKey: art?.album_key || null,
    };
  });
  return { items, total };
});

fastify.get('/api/music/artists', async (request, reply) => {
  const rootId = request.query.root;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
  const rows = db.listArtists.all(rootId, limit, offset);
  const total = db.countArtists.get(rootId)?.count || 0;
  const items = rows.map((row) => ({
    artist: row.artist || 'Unknown Artist',
    tracks: row.tracks,
    albums: row.albums,
    latest: row.latest,
  }));
  return { items, total };
});

fastify.get('/api/music/album', async (request, reply) => {
  const rootId = request.query.root;
  const albumKey = request.query.key;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root || !albumKey) {
    reply.code(400);
    return { error: 'Invalid request' };
  }
  const rows = db.listAlbumTracks.all(rootId, albumKey);
  const items = rows.map((row) => ({
    path: row.rel_path,
    name: row.name,
    size: row.size,
    mtime: row.mtime,
    mime: row.mime,
    ext: row.ext,
    isDir: Boolean(row.is_dir),
    title: row.title || null,
    artist: row.artist || null,
    album: row.album || null,
    duration: row.duration || null,
    albumKey: row.album_key || null,
  }));
  return { items };
});

fastify.get('/api/music/artist', async (request, reply) => {
  const rootId = request.query.root;
  const artist = request.query.artist;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root || !artist) {
    reply.code(400);
    return { error: 'Invalid request' };
  }
  const rows = db.listArtistTracks.all(rootId, artist);
  const items = rows.map((row) => ({
    path: row.rel_path,
    name: row.name,
    size: row.size,
    mtime: row.mtime,
    mime: row.mime,
    ext: row.ext,
    isDir: Boolean(row.is_dir),
    title: row.title || null,
    artist: row.artist || null,
    album: row.album || null,
    duration: row.duration || null,
    albumKey: row.album_key || null,
  }));
  return { items };
});

fastify.get('/api/album-art', async (request, reply) => {
  const rootId = request.query.root;
  const albumKey = request.query.key;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root || !albumKey) {
    reply.code(400);
    return { error: 'Invalid request' };
  }
  const art = db.getAlbumArt.get(albumKey);
  if (!art || !art.path) {
    reply.code(404);
    return { error: 'Not found' };
  }
  if (!fs.existsSync(art.path)) {
    reply.code(404);
    return { error: 'Not found' };
  }
  reply.header('Content-Type', mime.lookup(art.path) || 'application/octet-stream');
  return reply.send(fs.createReadStream(art.path));
});

fastify.post('/api/scan', async () => {
  await indexer.scanAll();
  return { ok: true, status: indexer.getStatus() };
});

fastify.get('/api/status', async () => {
  return indexer.getStatus();
});

fastify.post('/api/previews/rebuild', async () => {
  await clearPreviewCache(config.previewDir);
  db.db.exec('DELETE FROM album_art');
  return { ok: true };
});

fastify.get('/api/file', async (request, reply) => {
  const rootId = request.query.root;
  const relPath = normalizeRelPath(request.query.path || '');
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }

  const fullPath = safeJoin(root.absPath, relPath);
  if (!fullPath) {
    reply.code(400);
    return { error: 'Invalid path' };
  }

  let stats;
  try {
    stats = await fs.promises.stat(fullPath);
  } catch (error) {
    reply.code(404);
    return { error: 'Not found' };
  }

  if (stats.isDirectory()) {
    reply.code(400);
    return { error: 'Directory requested' };
  }

  const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
  const ext = path.extname(fullPath).toLowerCase();
  const resolvedMime = mimeType === 'application/octet-stream' && ext === '.opus'
    ? 'audio/opus'
    : mimeType;
  const range = request.headers.range;
  if (range) {
    const match = /bytes=(\\d*)-(\\d*)/.exec(range);
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
    reply.code(400);
    return { error: 'Invalid root' };
  }

  const entry = db.getEntry.get(rootId, relPath);
  if (!entry || entry.is_dir) {
    reply.code(404);
    return { error: 'Not found' };
  }

  const fullPath = safeJoin(root.absPath, relPath);
  if (!fullPath) {
    reply.code(400);
    return { error: 'Invalid path' };
  }

  const mimeType = entry.mime || mime.lookup(fullPath) || 'application/octet-stream';
  if (!mimeType.startsWith('image/')) {
    reply.code(415);
    return { error: 'Preview only available for images' };
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
    reply.code(500);
    return { error: 'Preview generation failed' };
  }
});

fastify.post('/api/zip', async (request, reply) => {
  const { root: rootId, paths } = request.body || {};
  const root = config.roots.find((item) => item.id === rootId);
  if (!root || !Array.isArray(paths) || paths.length === 0) {
    reply.code(400);
    return { error: 'Invalid request' };
  }

  reply.header('Content-Type', 'application/zip');
  reply.header('Content-Disposition', 'attachment; filename="files.zip"');
  reply.hijack();

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', (error) => {
    reply.raw.destroy(error);
  });
  archive.pipe(reply.raw);

  for (const relPathRaw of paths) {
    const relPath = normalizeRelPath(relPathRaw);
    const fullPath = safeJoin(root.absPath, relPath);
    if (!fullPath) {
      continue;
    }
    let stats;
    try {
      stats = await fs.promises.stat(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      continue;
    }
    archive.file(fullPath, { name: relPath });
  }

  await archive.finalize();
});

const staticRoot = path.join(projectRoot, 'web', 'dist');
if (fs.existsSync(staticRoot)) {
  fastify.register(fastifyStatic, {
    root: staticRoot,
    index: 'index.html',
    wildcard: false,
  });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url.startsWith('/api')) {
      reply.code(404);
      return reply.send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
} else {
  fastify.get('/', async () => {
    return { message: 'Frontend not built. Run web build to serve UI.' };
  });
}

const indexer = createIndexer(config, db, fastify.log);
indexer.start();

fastify.listen({ host: config.host, port: config.port }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`bind ${address}`);
});
