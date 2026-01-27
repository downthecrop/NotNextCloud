const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifyMultipart = require('@fastify/multipart');
const mime = require('mime-types');
const archiver = require('archiver');

const { loadConfig } = require('./config');
const { initDb, ENTRY_SELECT } = require('./db');
const { createIndexer } = require('./indexer');
const { safeJoin, normalizeRelPath, normalizeParent } = require('./utils');
const { previewCachePath, ensurePreview } = require('./preview');

const projectRoot = path.resolve(__dirname, '..');
const config = loadConfig(projectRoot);
const configPath = path.join(projectRoot, 'config.json');
const ALL_ROOTS_ID = '__all__';
const API_VERSION = 1;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const TRASH_RETENTION_MS = Math.max(0, config.trashRetentionDays || 0) * 24 * 60 * 60 * 1000;

const serverPackagePath = path.join(__dirname, 'package.json');
const serverVersion = fs.existsSync(serverPackagePath)
  ? JSON.parse(fs.readFileSync(serverPackagePath, 'utf8')).version || '0.0.0'
  : '0.0.0';

function makePrefixLike(rawPrefix) {
  const normalized = normalizeRelPath(rawPrefix || '');
  if (!normalized) {
    return null;
  }
  const normalizedSlash = normalized.replace(/\\/g, '/');
  return `${normalizedSlash}/%`;
}

function safeAttachmentName(relPath) {
  const base = path.basename(relPath || 'download');
  return base.replace(/"/g, "'");
}

function resolveRootScope(rootId) {
  if (!rootId) {
    return null;
  }
  if (rootId === ALL_ROOTS_ID) {
    return { rootIds: config.roots.map((root) => root.id), isAll: true };
  }
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    return null;
  }
  return { rootIds: [rootId], isAll: false };
}

function buildRootFilter(rootIds) {
  const placeholders = rootIds.map(() => '?').join(', ');
  return {
    clause: `root_id IN (${placeholders})`,
    params: rootIds,
  };
}

function listMediaAll({ rootIds, type, prefixLike, limit, offset }) {
  if (!rootIds.length) {
    return { rows: [], total: 0 };
  }
  const rootFilter = buildRootFilter(rootIds);
  const typeFilter = type === 'photos'
    ? "(mime LIKE 'image/%' OR mime LIKE 'video/%')"
    : "mime LIKE 'audio/%'";
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootFilter.clause} AND is_dir = 0 AND ${typeFilter}${prefixClause}`;
  const params = [...rootFilter.params];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${baseWhere}`;
  const total = db.db.prepare(countSql).get(...params)?.count || 0;
  const dataSql = `
    ${ENTRY_SELECT}
    WHERE ${baseWhere}
    ORDER BY mtime DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;
  const rows = db.db.prepare(dataSql).all(...params, limit, offset);
  return { rows, total };
}

function searchAll({ rootIds, type, like, prefixLike, limit, offset }) {
  if (!rootIds.length) {
    return { rows: [], total: 0 };
  }
  const rootFilter = buildRootFilter(rootIds);
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  let where = '';
  let params = [];
  if (type === 'photos') {
    where = `${rootFilter.clause} AND name LIKE ? AND (mime LIKE 'image/%' OR mime LIKE 'video/%')${prefixClause}`;
    params = [...rootFilter.params, like];
  } else if (type === 'music') {
    where = `${rootFilter.clause} AND (name LIKE ? OR title LIKE ? OR artist LIKE ? OR album LIKE ?) AND mime LIKE 'audio/%'${prefixClause}`;
    params = [...rootFilter.params, like, like, like, like];
  } else {
    where = `${rootFilter.clause} AND name LIKE ?${prefixClause}`;
    params = [...rootFilter.params, like];
  }
  if (prefixLike) {
    params.push(prefixLike);
  }
  const countSql = `SELECT COUNT(*) as count FROM entries WHERE ${where}`;
  const total = db.db.prepare(countSql).get(...params)?.count || 0;
  const orderBy =
    type === 'photos' || type === 'music'
      ? 'ORDER BY mtime DESC, name COLLATE NOCASE'
      : 'ORDER BY is_dir DESC, name COLLATE NOCASE';
  const dataSql = `
    ${ENTRY_SELECT}
    WHERE ${where}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;
  const rows = db.db.prepare(dataSql).all(...params, limit, offset);
  return { rows, total };
}

function listAlbumsAll({ rootIds, prefixLike, limit, offset }) {
  if (!rootIds.length) {
    return { rows: [], total: 0 };
  }
  const rootFilter = buildRootFilter(rootIds);
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootFilter.clause} AND is_dir = 0 AND mime LIKE 'audio/%'${prefixClause}`;
  const params = [...rootFilter.params];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const dataSql = `
    SELECT album_key, album, artist, COUNT(*) as tracks, MAX(mtime) as latest
    FROM entries
    WHERE ${baseWhere}
    GROUP BY album_key, album, artist
    ORDER BY latest DESC, album COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;
  const rows = db.db.prepare(dataSql).all(...params, limit, offset);
  const countSql = `
    SELECT COUNT(*) as count
    FROM (
      SELECT album_key
      FROM entries
      WHERE ${baseWhere}
      GROUP BY album_key
    ) AS albums
  `;
  const total = db.db.prepare(countSql).get(...params)?.count || 0;
  return { rows, total };
}

function listArtistsAll({ rootIds, prefixLike, limit, offset }) {
  if (!rootIds.length) {
    return { rows: [], total: 0 };
  }
  const rootFilter = buildRootFilter(rootIds);
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootFilter.clause} AND is_dir = 0 AND mime LIKE 'audio/%'${prefixClause}`;
  const params = [...rootFilter.params];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const dataSql = `
    SELECT artist, COUNT(*) as tracks, COUNT(DISTINCT album_key) as albums, MAX(mtime) as latest
    FROM entries
    WHERE ${baseWhere}
    GROUP BY artist
    ORDER BY latest DESC, artist COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;
  const rows = db.db.prepare(dataSql).all(...params, limit, offset);
  const countSql = `
    SELECT COUNT(*) as count
    FROM (
      SELECT artist
      FROM entries
      WHERE ${baseWhere}
      GROUP BY artist
    ) AS artists
  `;
  const total = db.db.prepare(countSql).get(...params)?.count || 0;
  return { rows, total };
}

function listAlbumTracksAll({ rootIds, albumKey, prefixLike }) {
  if (!rootIds.length) {
    return [];
  }
  const rootFilter = buildRootFilter(rootIds);
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootFilter.clause} AND album_key = ? AND is_dir = 0 AND mime LIKE 'audio/%'${prefixClause}`;
  const params = [...rootFilter.params, albumKey];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const sql = `
    ${ENTRY_SELECT}
    WHERE ${baseWhere}
    ORDER BY name COLLATE NOCASE
  `;
  return db.db.prepare(sql).all(...params);
}

function listArtistTracksAll({ rootIds, artist, prefixLike }) {
  if (!rootIds.length) {
    return [];
  }
  const rootFilter = buildRootFilter(rootIds);
  const prefixClause = prefixLike ? ' AND rel_path LIKE ?' : '';
  const baseWhere = `${rootFilter.clause} AND artist = ? AND is_dir = 0 AND mime LIKE 'audio/%'${prefixClause}`;
  const params = [...rootFilter.params, artist];
  if (prefixLike) {
    params.push(prefixLike);
  }
  const sql = `
    ${ENTRY_SELECT}
    WHERE ${baseWhere}
    ORDER BY album COLLATE NOCASE, name COLLATE NOCASE
  `;
  return db.db.prepare(sql).all(...params);
}
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

function formatRootsResponse(roots) {
  return roots.map((root) => ({
    id: root.id,
    name: root.name,
    path: root.path,
    absPath: root.absPath,
  }));
}

function sanitizeRootPayload(rawRoots) {
  const results = [];
  const usedIds = new Set();
  rawRoots.forEach((root, index) => {
    const pathValue = typeof root?.path === 'string' ? root.path.trim() : '';
    if (!pathValue) {
      throw new Error('Each root needs a valid path.');
    }
    const name = typeof root?.name === 'string' ? root.name.trim() : '';
    let id = typeof root?.id === 'string' ? root.id.trim() : '';
    if (!id) {
      id = name || path.basename(pathValue) || `root-${index + 1}`;
    }
    let uniqueId = id;
    let suffix = 2;
    while (usedIds.has(uniqueId)) {
      uniqueId = `${id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(uniqueId);
    const entry = { id: uniqueId, path: pathValue };
    if (name) {
      entry.name = name;
    }
    results.push(entry);
  });
  return results;
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
  logger: true,
});

fastify.addContentTypeParser(
  'application/octet-stream',
  { parseAs: 'buffer' },
  (req, payload, done) => {
    done(null, payload);
  }
);

const multipartLimits = {};
if (config.uploadMaxBytes > 0) {
  multipartLimits.fileSize = config.uploadMaxBytes;
}
if (config.uploadMaxFiles > 0) {
  multipartLimits.files = config.uploadMaxFiles;
}

fastify.register(fastifyMultipart, {
  limits: multipartLimits,
});

fastify.addHook('onSend', async (request, reply, payload) => {
  if (request.raw.url.startsWith('/api')) {
    reply.header('X-Api-Version', API_VERSION);
    reply.header('X-Server-Version', serverVersion);
  }
  return payload;
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

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

function parseSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function uploadIdFor(rootId, relPath, size) {
  return crypto
    .createHash('sha1')
    .update(`${rootId}::${relPath}::${size}`)
    .digest('hex');
}

function uploadTempPath(uploadId) {
  return path.join(config.uploadTempDir, `${uploadId}.part`);
}

function trashRelName(rootId, relPath) {
  const base = path.basename(relPath || '') || 'item';
  const safeBase = base.replace(/[^\w.\-() ]+/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nonce = crypto.randomBytes(3).toString('hex');
  return path.join(rootId, `${stamp}-${nonce}-${safeBase}`);
}

async function movePath(sourcePath, targetPath, isDir) {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.promises.rename(sourcePath, targetPath);
    return;
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
  }
  if (isDir) {
    await fs.promises.cp(sourcePath, targetPath, { recursive: true });
    await fs.promises.rm(sourcePath, { recursive: true, force: true });
  } else {
    await fs.promises.copyFile(sourcePath, targetPath);
    await fs.promises.unlink(sourcePath);
  }
}

async function upsertUploadedFile({ root, relPath, fullPath }) {
  let stats;
  try {
    stats = await fs.promises.stat(fullPath);
  } catch {
    return;
  }
  if (!stats.isFile()) {
    return;
  }
  const name = path.basename(relPath);
  const ext = path.extname(name).toLowerCase();
  let mimeType = mime.lookup(ext) || null;
  if (!mimeType && ext === '.opus') {
    mimeType = 'audio/opus';
  }
  const safeMime = mimeType || 'application/octet-stream';
  db.upsertEntry.run({
    root_id: root.id,
    rel_path: relPath,
    parent: normalizeParent(relPath),
    name,
    ext,
    size: stats.size,
    mtime: Math.floor(stats.mtimeMs),
    mime: safeMime,
    is_dir: 0,
    scan_id: Date.now(),
    title: null,
    artist: null,
    album: null,
    duration: null,
    album_key: null,
    content_hash: null,
    hash_alg: null,
    inode: Number.isFinite(stats.ino) ? stats.ino : null,
    device: Number.isFinite(stats.dev) ? stats.dev : null,
  });
}

async function removeTrashEntry(entry) {
  if (!entry?.trash_rel_path) {
    return;
  }
  const trashFull = path.join(config.trashDir, entry.trash_rel_path);
  try {
    const stats = await fs.promises.lstat(trashFull);
    if (stats.isDirectory()) {
      await fs.promises.rm(trashFull, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(trashFull);
    }
  } catch {
    // Ignore missing files.
  }
  db.deleteTrashById.run(entry.id);
}

async function purgeTrash({ rootId = null, olderThan = null } = {}) {
  let query = 'SELECT id, root_id, rel_path, is_dir, trash_rel_path FROM trash_entries';
  const params = [];
  const clauses = [];
  if (rootId) {
    clauses.push('root_id = ?');
    params.push(rootId);
  }
  if (typeof olderThan === 'number') {
    clauses.push('deleted_at < ?');
    params.push(olderThan);
  }
  if (clauses.length) {
    query += ` WHERE ${clauses.join(' AND ')}`;
  }
  const entries = db.db.prepare(query).all(...params);
  for (const entry of entries) {
    await removeTrashEntry(entry);
  }
  return entries.length;
}

async function finalizeUpload({ partPath, fullPath, overwrite }) {
  const targetDir = path.dirname(fullPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  let existing = null;
  try {
    existing = await fs.promises.lstat(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (existing) {
    if (existing.isDirectory()) {
      return { ok: false, error: 'Target is a directory', conflict: true };
    }
    if (existing.isSymbolicLink()) {
      return { ok: false, error: 'Target is a symlink', conflict: true };
    }
    if (!overwrite) {
      return { ok: false, error: 'File already exists', conflict: true };
    }
    await fs.promises.unlink(fullPath);
  }
  try {
    await fs.promises.rename(partPath, fullPath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
    await fs.promises.copyFile(partPath, fullPath);
    await fs.promises.unlink(partPath);
  }
  return { ok: true };
}

async function ensureEmptyFile(fullPath, overwrite) {
  const targetDir = path.dirname(fullPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  let existing = null;
  try {
    existing = await fs.promises.lstat(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (existing) {
    if (existing.isDirectory()) {
      return { ok: false, error: 'Target is a directory', conflict: true };
    }
    if (existing.isSymbolicLink()) {
      return { ok: false, error: 'Target is a symlink', conflict: true };
    }
    if (!overwrite) {
      return { ok: false, error: 'File already exists', conflict: true };
    }
    await fs.promises.unlink(fullPath);
  }
  await fs.promises.writeFile(fullPath, '');
  return { ok: true };
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
  return {
    status: 'ok',
    devMode: config.devMode,
    apiVersion: API_VERSION,
    serverVersion,
  };
});

fastify.get('/api/info', async () => {
  const maxBytes = config.uploadMaxBytes > 0 ? config.uploadMaxBytes : null;
  const maxFiles = config.uploadMaxFiles > 0 ? config.uploadMaxFiles : null;
  return {
    apiVersion: API_VERSION,
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
        chunkBytes: UPLOAD_CHUNK_BYTES,
        protocol: 'chunked-v1',
      },
      trash: {
        enabled: true,
        retentionDays: config.trashRetentionDays || 0,
      },
    },
  };
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
  return formatRootsResponse(config.roots);
});

fastify.put('/api/roots', async (request, reply) => {
  if (!Array.isArray(request.body?.roots)) {
    reply.code(400);
    return { error: 'Roots must be an array.' };
  }
  let sanitized;
  try {
    sanitized = sanitizeRootPayload(request.body.roots);
  } catch (error) {
    reply.code(400);
    return { error: error.message || 'Invalid roots payload.' };
  }
  try {
    const nextConfig = readConfigFile();
    nextConfig.roots = sanitized;
    writeConfigFile(nextConfig);
    const reloaded = loadConfig(projectRoot);
    Object.assign(config, reloaded);
    if (indexer?.scanAll) {
      indexer.scanAll().catch((error) => {
        fastify.log.error({ err: error }, 'Scan after roots update failed');
      });
    }
    return formatRootsResponse(config.roots);
  } catch (error) {
    reply.code(500);
    if (error?.code === 'EROFS' || error?.code === 'EPERM') {
      return { error: 'config.json is read-only. Update docker-compose to mount it read/write.' };
    }
    return { error: 'Failed to write config.json.' };
  }
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
    rootId: row.root_id,
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

fastify.get('/api/search', async (request, reply) => {
  const rootId = request.query.root;
  const scope = resolveRootScope(rootId);
  if (!scope) {
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
  const prefixLike = makePrefixLike(request.query.pathPrefix);
  let rows = [];
  let total = 0;
  if (scope.isAll) {
    const results = searchAll({
      rootIds: scope.rootIds,
      type,
      like,
      prefixLike,
      limit,
      offset,
    });
    rows = results.rows;
    total = results.total;
  } else if (type === 'photos') {
    if (prefixLike) {
      rows = db.searchPhotosByPrefix.all(rootId, like, prefixLike, limit, offset);
      total = db.countSearchPhotosByPrefix.get(rootId, like, prefixLike)?.count || 0;
    } else {
      rows = db.searchPhotos.all(rootId, like, limit, offset);
      total = db.countSearchPhotos.get(rootId, like)?.count || 0;
    }
  } else if (type === 'music') {
    if (prefixLike) {
      rows = db.searchMusicByPrefix.all(rootId, like, like, like, like, prefixLike, limit, offset);
      total = db.countSearchMusicByPrefix.get(rootId, like, like, like, like, prefixLike)?.count || 0;
    } else {
      rows = db.searchMusic.all(rootId, like, like, like, like, limit, offset);
      total = db.countSearchMusic.get(rootId, like, like, like, like)?.count || 0;
    }
  } else {
    rows = db.searchByName.all(rootId, like, limit, offset);
    total = db.countSearch.get(rootId, like)?.count || 0;
  }
  const items = rows.map((row) => ({
    rootId: row.root_id,
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
  const scope = resolveRootScope(rootId);
  if (!scope) {
    reply.code(400);
    return { error: 'Invalid root' };
  }

  const type = (request.query.type || '').toLowerCase();
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
  const prefixLike = makePrefixLike(request.query.pathPrefix);

  let rows = [];
  let total = 0;
  if (type !== 'photos' && type !== 'music') {
    reply.code(400);
    return { error: 'Invalid media type' };
  }

  if (scope.isAll) {
    const results = listMediaAll({
      rootIds: scope.rootIds,
      type,
      prefixLike,
      limit,
      offset,
    });
    rows = results.rows;
    total = results.total;
  } else if (type === 'photos') {
    if (prefixLike) {
      rows = db.listPhotosByPrefix.all(rootId, prefixLike, limit, offset);
      total = db.countPhotosByPrefix.get(rootId, prefixLike)?.count || 0;
    } else {
      rows = db.listPhotos.all(rootId, limit, offset);
      total = db.countPhotos.get(rootId)?.count || 0;
    }
  } else if (type === 'music') {
    if (prefixLike) {
      rows = db.listMusicByPrefix.all(rootId, prefixLike, limit, offset);
      total = db.countMusicByPrefix.get(rootId, prefixLike)?.count || 0;
    } else {
      rows = db.listMusic.all(rootId, limit, offset);
      total = db.countMusic.get(rootId)?.count || 0;
    }
  }

  const items = rows.map((row) => ({
    rootId: row.root_id,
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
  const scope = resolveRootScope(rootId);
  if (!scope) {
    reply.code(400);
    return { error: 'Invalid root' };
  }
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
  const prefixLike = makePrefixLike(request.query.pathPrefix);
  let rows = [];
  let total = 0;
  if (scope.isAll) {
    const results = listAlbumsAll({ rootIds: scope.rootIds, prefixLike, limit, offset });
    rows = results.rows;
    total = results.total;
  } else {
    rows = prefixLike
      ? db.listAlbumsByPrefix.all(rootId, prefixLike, limit, offset)
      : db.listAlbums.all(rootId, limit, offset);
    total = prefixLike
      ? db.countAlbumsByPrefix.get(rootId, prefixLike)?.count || 0
      : db.countAlbums.get(rootId)?.count || 0;
  }
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
  const scope = resolveRootScope(rootId);
  if (!scope) {
    reply.code(400);
    return { error: 'Invalid root' };
  }
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
  const prefixLike = makePrefixLike(request.query.pathPrefix);
  let rows = [];
  let total = 0;
  if (scope.isAll) {
    const results = listArtistsAll({ rootIds: scope.rootIds, prefixLike, limit, offset });
    rows = results.rows;
    total = results.total;
  } else {
    rows = prefixLike
      ? db.listArtistsByPrefix.all(rootId, prefixLike, limit, offset)
      : db.listArtists.all(rootId, limit, offset);
    total = prefixLike
      ? db.countArtistsByPrefix.get(rootId, prefixLike)?.count || 0
      : db.countArtists.get(rootId)?.count || 0;
  }
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
  const scope = resolveRootScope(rootId);
  if (!scope || !albumKey) {
    reply.code(400);
    return { error: 'Invalid request' };
  }
  const prefixLike = makePrefixLike(request.query.pathPrefix);
  const rows = scope.isAll
    ? listAlbumTracksAll({ rootIds: scope.rootIds, albumKey, prefixLike })
    : prefixLike
    ? db.listAlbumTracksByPrefix.all(rootId, albumKey, prefixLike)
    : db.listAlbumTracks.all(rootId, albumKey);
  const items = rows.map((row) => ({
    rootId: row.root_id,
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
  const scope = resolveRootScope(rootId);
  if (!scope || !artist) {
    reply.code(400);
    return { error: 'Invalid request' };
  }
  const prefixLike = makePrefixLike(request.query.pathPrefix);
  const rows = scope.isAll
    ? listArtistTracksAll({ rootIds: scope.rootIds, artist, prefixLike })
    : prefixLike
    ? db.listArtistTracksByPrefix.all(rootId, artist, prefixLike)
    : db.listArtistTracks.all(rootId, artist);
  const items = rows.map((row) => ({
    rootId: row.root_id,
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
  const root = rootId === ALL_ROOTS_ID ? true : config.roots.find((item) => item.id === rootId);
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

fastify.post('/api/scan', async (request, reply) => {
  const mode = (request.body?.mode || request.query?.mode || 'incremental').toLowerCase();
  const rootId = request.body?.root || request.query?.root || '';
  const relPath = normalizeRelPath(request.body?.path || request.query?.path || '');
  const forceHash = mode === 'rehash';
  const fastScan = mode === 'fast' || (mode === 'incremental' && config.fastScan);
  const fullScan = mode === 'full';
  const scanOptions = { forceHash, fastScan: forceHash ? false : fullScan ? false : fastScan };
  if (rootId) {
    const root = config.roots.find((item) => item.id === rootId);
    if (!root) {
      reply.code(400);
      return { error: 'Invalid root' };
    }
    const targetPath = safeJoin(root.absPath, relPath);
    if (!targetPath) {
      reply.code(400);
      return { error: 'Invalid path' };
    }
    let stats;
    try {
      stats = await fs.promises.stat(targetPath);
    } catch (error) {
      reply.code(404);
      return { error: 'Path not found' };
    }
    if (!stats.isDirectory()) {
      reply.code(400);
      return { error: 'Path must be a directory' };
    }
    await indexer.scanPath({ root, relPath, ...scanOptions });
  } else {
    await indexer.scanAll(scanOptions);
  }
  return { ok: true, status: indexer.getStatus() };
});

fastify.get('/api/status', async () => {
  return indexer.getStatus();
});

fastify.get('/api/scan/settings', async () => {
  return {
    scanIntervalSeconds: config.scanIntervalSeconds || 60,
    fastScan: Boolean(config.fastScan),
    fullScanIntervalHours: Number(config.fullScanIntervalHours || 0),
  };
});

fastify.put('/api/scan/settings', async (request, reply) => {
  const scanIntervalSeconds = Math.max(10, parseInt(request.body?.scanIntervalSeconds, 10) || 60);
  const fastScan = request.body?.fastScan !== false;
  const fullScanIntervalHours = Math.max(
    0,
    parseInt(request.body?.fullScanIntervalHours, 10) || 0
  );
  try {
    const nextConfig = readConfigFile();
    nextConfig.scanIntervalSeconds = scanIntervalSeconds;
    nextConfig.fastScan = fastScan;
    nextConfig.fullScanIntervalHours = fullScanIntervalHours;
    writeConfigFile(nextConfig);
    const reloaded = loadConfig(projectRoot);
    Object.assign(config, reloaded);
    indexer.reschedule?.();
    return indexer.getStatus();
  } catch (error) {
    reply.code(500);
    return { error: 'Failed to update scan settings.' };
  }
});

fastify.post('/api/previews/rebuild', async () => {
  await clearPreviewCache(config.previewDir);
  db.db.exec('DELETE FROM album_art');
  return { ok: true };
});

fastify.get('/api/trash', async (request, reply) => {
  const rootId = request.query.root || ALL_ROOTS_ID;
  const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
  const rootMap = new Map(config.roots.map((root) => [root.id, root]));

  let rows = [];
  let total = 0;
  if (rootId === ALL_ROOTS_ID) {
    rows = db.listTrashAll.all(limit, offset);
    total = db.countTrashAll.get()?.count || 0;
  } else {
    const root = rootMap.get(rootId);
    if (!root) {
      reply.code(400);
      return { error: 'Invalid root' };
    }
    rows = db.listTrashByRoot.all(rootId, limit, offset);
    total = db.countTrashByRoot.get(rootId)?.count || 0;
  }

  const items = rows.map((row) => ({
    trashId: row.id,
    rootId: row.root_id,
    rootName: rootMap.get(row.root_id)?.name || row.root_id,
    path: row.rel_path,
    name: row.name,
    size: row.size,
    mime: row.mime,
    ext: row.ext,
    isDir: Boolean(row.is_dir),
    deletedAt: row.deleted_at,
  }));

  return { items, total };
});

fastify.get('/api/trash/file', async (request, reply) => {
  const trashId = parseInt(request.query.id || request.query.trashId, 10);
  if (!Number.isFinite(trashId)) {
    reply.code(400);
    return { error: 'Invalid trash id' };
  }
  const entry = db.db
    .prepare(
      'SELECT id, rel_path, is_dir, mime, trash_rel_path FROM trash_entries WHERE id = ?'
    )
    .get(trashId);
  if (!entry) {
    reply.code(404);
    return { error: 'Not found' };
  }
  if (entry.is_dir) {
    reply.code(400);
    return { error: 'Directory requested' };
  }
  const fullPath = path.join(config.trashDir, entry.trash_rel_path);
  let stats;
  try {
    stats = await fs.promises.stat(fullPath);
  } catch {
    reply.code(404);
    return { error: 'Not found' };
  }
  const mimeType = entry.mime || mime.lookup(fullPath) || 'application/octet-stream';
  const ext = path.extname(entry.rel_path || '').toLowerCase();
  const resolvedMime = mimeType === 'application/octet-stream' && ext === '.opus'
    ? 'audio/opus'
    : mimeType;
  const wantsDownload = request.query.download === '1' || request.query.download === 'true';
  if (wantsDownload) {
    reply.header(
      'Content-Disposition',
      `attachment; filename="${safeAttachmentName(entry.rel_path)}"`
    );
  }
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

fastify.post('/api/delete', async (request, reply) => {
  const { root: rootId, paths } = request.body || {};
  const root = config.roots.find((item) => item.id === rootId);
  if (!root || !Array.isArray(paths) || paths.length === 0) {
    reply.code(400);
    return { error: 'Invalid request' };
  }

  const results = { moved: 0, skipped: 0, errors: [] };
  const touchedDirs = new Set();

  for (const relPathRaw of paths) {
    const relPath = normalizeRelPath(relPathRaw);
    if (!relPath) {
      results.skipped += 1;
      results.errors.push({ path: relPathRaw || '', error: 'Invalid path' });
      continue;
    }
    const fullPath = safeJoin(root.absPath, relPath);
    if (!fullPath) {
      results.skipped += 1;
      results.errors.push({ path: relPath, error: 'Invalid path' });
      continue;
    }
    let stats;
    try {
      stats = await fs.promises.lstat(fullPath);
    } catch {
      results.skipped += 1;
      results.errors.push({ path: relPath, error: 'Not found' });
      continue;
    }
    if (stats.isSymbolicLink()) {
      results.skipped += 1;
      results.errors.push({ path: relPath, error: 'Symlink not supported' });
      continue;
    }

    const trashRel = trashRelName(root.id, relPath);
    const trashFull = path.join(config.trashDir, trashRel);
    try {
      await movePath(fullPath, trashFull, stats.isDirectory());
    } catch (error) {
      results.skipped += 1;
      results.errors.push({ path: relPath, error: 'Failed to move to trash' });
      continue;
    }

    const ext = stats.isDirectory() ? '' : path.extname(relPath).toLowerCase();
    let mimeType = stats.isDirectory() ? null : mime.lookup(ext);
    if (!mimeType && ext === '.opus') {
      mimeType = 'audio/opus';
    }
    db.insertTrashEntry.run({
      root_id: root.id,
      rel_path: relPath,
      name: path.basename(relPath),
      ext,
      size: stats.isDirectory() ? 0 : stats.size,
      mime: stats.isDirectory() ? null : mimeType || 'application/octet-stream',
      is_dir: stats.isDirectory() ? 1 : 0,
      deleted_at: Date.now(),
      trash_rel_path: trashRel,
    });

    if (stats.isDirectory()) {
      const prefixLike = `${relPath}/%`;
      db.deleteEntriesByPrefix.run(root.id, relPath, prefixLike);
    } else {
      db.deleteEntryByPath.run(root.id, relPath);
    }
    results.moved += 1;
    touchedDirs.add(normalizeParent(relPath));
  }

  for (const relPath of touchedDirs) {
    await indexer.scanPath({ root, relPath, fastScan: true });
  }

  return { ok: true, rootId, ...results };
});

fastify.post('/api/trash/restore', async (request, reply) => {
  const ids = Array.isArray(request.body?.ids) ? request.body.ids : [];
  if (!ids.length) {
    reply.code(400);
    return { error: 'No items selected' };
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.db
    .prepare(
      `SELECT id, root_id, rel_path, is_dir, trash_rel_path FROM trash_entries WHERE id IN (${placeholders})`
    )
    .all(...ids);

  const results = { restored: 0, skipped: 0, errors: [] };
  for (const entry of rows) {
    const root = config.roots.find((item) => item.id === entry.root_id);
    if (!root) {
      results.skipped += 1;
      results.errors.push({ id: entry.id, error: 'Root not found' });
      continue;
    }
    const targetRel = normalizeRelPath(entry.rel_path);
    const fullPath = safeJoin(root.absPath, targetRel);
    if (!fullPath) {
      results.skipped += 1;
      results.errors.push({ id: entry.id, error: 'Invalid path' });
      continue;
    }
    let exists = false;
    try {
      const stats = await fs.promises.lstat(fullPath);
      if (stats) {
        exists = true;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        results.skipped += 1;
        results.errors.push({ id: entry.id, error: 'Failed to access target' });
        continue;
      }
    }
    if (exists) {
      results.skipped += 1;
      results.errors.push({ id: entry.id, error: 'Target already exists' });
      continue;
    }
    const trashFull = path.join(config.trashDir, entry.trash_rel_path);
    try {
      await movePath(trashFull, fullPath, Boolean(entry.is_dir));
      db.deleteTrashById.run(entry.id);
      await upsertUploadedFile({ root, relPath: targetRel, fullPath });
      await indexer.scanPath({ root, relPath: targetRel, fastScan: false });
      results.restored += 1;
    } catch (error) {
      results.skipped += 1;
      results.errors.push({ id: entry.id, error: 'Failed to restore' });
    }
  }

  return { ok: true, ...results };
});

fastify.post('/api/trash/delete', async (request, reply) => {
  const ids = Array.isArray(request.body?.ids) ? request.body.ids : [];
  if (!ids.length) {
    reply.code(400);
    return { error: 'No items selected' };
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.db
    .prepare(
      `SELECT id, root_id, rel_path, is_dir, trash_rel_path FROM trash_entries WHERE id IN (${placeholders})`
    )
    .all(...ids);

  const results = { deleted: 0, skipped: 0, errors: [] };
  for (const entry of rows) {
    try {
      await removeTrashEntry(entry);
      results.deleted += 1;
    } catch {
      results.skipped += 1;
      results.errors.push({ id: entry.id, error: 'Failed to delete' });
    }
  }
  return { ok: true, ...results };
});

fastify.post('/api/trash/clear', async (request, reply) => {
  const rootId = request.body?.root || ALL_ROOTS_ID;
  if (rootId !== ALL_ROOTS_ID && !config.roots.find((item) => item.id === rootId)) {
    reply.code(400);
    return { error: 'Invalid root' };
  }
  const count = await purgeTrash({ rootId: rootId === ALL_ROOTS_ID ? null : rootId });
  return { ok: true, cleared: count };
});

fastify.post('/api/upload', async (request, reply) => {
  if (!config.uploadEnabled) {
    reply.code(403);
    return { error: 'Uploads are disabled.' };
  }
  if (!request.isMultipart()) {
    reply.code(415);
    return { error: 'Multipart/form-data required.' };
  }

  const rootId = request.query.root;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }

  const basePath = normalizeRelPath(request.query.path || '');
  const overwrite = parseBoolean(request.query.overwrite, config.uploadOverwrite);
  const baseFull = safeJoin(root.absPath, basePath);
  if (!baseFull) {
    reply.code(400);
    return { error: 'Invalid path' };
  }

  const results = {
    received: 0,
    stored: 0,
    skipped: 0,
    errors: [],
  };
  const touchedDirs = new Set();

  try {
    for await (const part of request.parts()) {
      if (!part.file) {
        continue;
      }
      results.received += 1;

      const rawName = typeof part.filename === 'string' ? part.filename : '';
      const cleanedName = normalizeRelPath(rawName.replace(/\\/g, '/'));
      if (!cleanedName) {
        results.skipped += 1;
        results.errors.push({ file: rawName || '', error: 'Missing filename' });
        part.file.resume();
        continue;
      }

      const targetRel = normalizeRelPath(path.posix.join(basePath, cleanedName));
      const fullPath = safeJoin(root.absPath, targetRel);
      if (!fullPath) {
        results.skipped += 1;
        results.errors.push({ file: cleanedName, error: 'Invalid path' });
        part.file.resume();
        continue;
      }

      const targetDir = path.dirname(fullPath);
      try {
        await fs.promises.mkdir(targetDir, { recursive: true });
      } catch (error) {
        results.skipped += 1;
        results.errors.push({ file: cleanedName, error: 'Failed to create folder' });
        part.file.resume();
        continue;
      }

      let existing = null;
      try {
        existing = await fs.promises.lstat(fullPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          results.skipped += 1;
          results.errors.push({ file: cleanedName, error: 'Failed to access target' });
          part.file.resume();
          continue;
        }
      }

      if (existing) {
        if (existing.isDirectory()) {
          results.skipped += 1;
          results.errors.push({ file: cleanedName, error: 'Target is a directory' });
          part.file.resume();
          continue;
        }
        if (existing.isSymbolicLink()) {
          results.skipped += 1;
          results.errors.push({ file: cleanedName, error: 'Target is a symlink' });
          part.file.resume();
          continue;
        }
        if (!overwrite) {
          results.skipped += 1;
          results.errors.push({ file: cleanedName, error: 'File already exists' });
          part.file.resume();
          continue;
        }
      }

      try {
        await pipeline(part.file, fs.createWriteStream(fullPath, { flags: overwrite ? 'w' : 'wx' }));
      } catch (error) {
        results.skipped += 1;
        results.errors.push({ file: cleanedName, error: 'Failed to write file' });
        part.file.resume();
        continue;
      }

      if (part.file.truncated) {
        try {
          await fs.promises.unlink(fullPath);
        } catch {
          // Best effort cleanup.
        }
        results.skipped += 1;
        results.errors.push({ file: cleanedName, error: 'File exceeds upload limit' });
        continue;
      }

      results.stored += 1;
      await upsertUploadedFile({ root, relPath: targetRel, fullPath });
      touchedDirs.add(normalizeParent(targetRel));
    }
  } catch (error) {
    fastify.log.error({ err: error }, 'Upload failed');
    reply.code(error?.code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 400);
    return { error: 'Upload failed' };
  }

  if (results.received === 0) {
    reply.code(400);
    return { error: 'No files uploaded' };
  }

  if (results.stored > 0) {
    const scanOptions = { fastScan: true };
    for (const relPath of touchedDirs) {
      await indexer.scanPath({ root, relPath, ...scanOptions });
    }
  }

  return {
    ok: true,
    rootId,
    path: basePath,
    overwrite,
    ...results,
  };
});

fastify.get('/api/upload/status', async (request, reply) => {
  if (!config.uploadEnabled) {
    reply.code(403);
    return { error: 'Uploads are disabled.' };
  }
  const rootId = request.query.root;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }

  const basePath = normalizeRelPath(request.query.path || '');
  const fileRelRaw = typeof request.query.file === 'string' ? request.query.file : '';
  const fileRel = normalizeRelPath(fileRelRaw.replace(/\\/g, '/'));
  if (!fileRel) {
    reply.code(400);
    return { error: 'Missing file name' };
  }

  const size = parseSize(request.query.size);
  if (size === null) {
    reply.code(400);
    return { error: 'Invalid size' };
  }
  const overwrite = parseBoolean(request.query.overwrite, config.uploadOverwrite);

  const targetRel = normalizeRelPath(path.posix.join(basePath, fileRel));
  const fullPath = safeJoin(root.absPath, targetRel);
  if (!fullPath) {
    reply.code(400);
    return { error: 'Invalid path' };
  }

  if (size === 0) {
    try {
      const result = await ensureEmptyFile(fullPath, overwrite);
      if (!result.ok) {
        reply.code(409);
        return { error: result.error, status: 'exists' };
      }
      await upsertUploadedFile({ root, relPath: targetRel, fullPath });
      await indexer.scanPath({ root, relPath: normalizeParent(targetRel), fastScan: true });
      return { status: 'complete', uploadId: null, offset: 0, size };
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to create file' };
    }
  }

  let existing = null;
  try {
    existing = await fs.promises.lstat(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      reply.code(500);
      return { error: 'Failed to access target' };
    }
  }
  if (existing) {
    if (existing.isDirectory()) {
      reply.code(409);
      return { error: 'Target is a directory', status: 'exists' };
    }
    if (existing.isSymbolicLink()) {
      reply.code(409);
      return { error: 'Target is a symlink', status: 'exists' };
    }
    if (!overwrite) {
      reply.code(409);
      return { error: 'File already exists', status: 'exists' };
    }
  }

  const uploadId = uploadIdFor(rootId, targetRel, size);
  const partPath = uploadTempPath(uploadId);

  let offset = 0;
  try {
    const stats = await fs.promises.stat(partPath);
    offset = stats.size;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      reply.code(500);
      return { error: 'Failed to inspect upload' };
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
        reply.code(409);
        return { error: result.error, status: 'exists' };
      }
      await upsertUploadedFile({ root, relPath: targetRel, fullPath });
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to finalize upload' };
    }
    return { status: 'complete', uploadId, offset: size, size };
  }

  return { status: 'ready', uploadId, offset, size };
});

fastify.post('/api/upload/chunk', { bodyLimit: UPLOAD_CHUNK_BYTES + 1024 }, async (request, reply) => {
  if (!config.uploadEnabled) {
    reply.code(403);
    return { error: 'Uploads are disabled.' };
  }
  const rootId = request.query.root;
  const root = config.roots.find((item) => item.id === rootId);
  if (!root) {
    reply.code(400);
    return { error: 'Invalid root' };
  }

  const basePath = normalizeRelPath(request.query.path || '');
  const fileRelRaw = typeof request.query.file === 'string' ? request.query.file : '';
  const fileRel = normalizeRelPath(fileRelRaw.replace(/\\/g, '/'));
  if (!fileRel) {
    reply.code(400);
    return { error: 'Missing file name' };
  }

  const size = parseSize(request.query.size);
  if (size === null) {
    reply.code(400);
    return { error: 'Invalid size' };
  }
  const offset = parseSize(request.query.offset);
  if (offset === null) {
    reply.code(400);
    return { error: 'Invalid offset' };
  }
  const overwrite = parseBoolean(request.query.overwrite, config.uploadOverwrite);

  const targetRel = normalizeRelPath(path.posix.join(basePath, fileRel));
  const fullPath = safeJoin(root.absPath, targetRel);
  if (!fullPath) {
    reply.code(400);
    return { error: 'Invalid path' };
  }

  if (size === 0) {
    try {
      const result = await ensureEmptyFile(fullPath, overwrite);
      if (!result.ok) {
        reply.code(409);
        return { error: result.error, status: 'exists' };
      }
      await upsertUploadedFile({ root, relPath: targetRel, fullPath });
      return { ok: true, offset: 0, complete: true };
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to create file' };
    }
  }

  let existing = null;
  try {
    existing = await fs.promises.lstat(fullPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      reply.code(500);
      return { error: 'Failed to access target' };
    }
  }
  if (existing && !overwrite) {
    reply.code(409);
    return { error: 'File already exists', status: 'exists' };
  }

  const uploadId = uploadIdFor(rootId, targetRel, size);
  const partPath = uploadTempPath(uploadId);

  let currentSize = 0;
  try {
    const stats = await fs.promises.stat(partPath);
    currentSize = stats.size;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      reply.code(500);
      return { error: 'Failed to inspect upload' };
    }
  }

  if (currentSize !== offset) {
    reply.code(409);
    return { error: 'Offset mismatch', expectedOffset: currentSize };
  }
  if (offset > size) {
    reply.code(400);
    return { error: 'Offset beyond file size' };
  }

  try {
    await fs.promises.mkdir(path.dirname(partPath), { recursive: true });
    const body = request.body;
    if (!body || !(Buffer.isBuffer(body) || typeof body === 'string')) {
      reply.code(400);
      return { error: 'Missing chunk body' };
    }
    const chunkBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await fs.promises.writeFile(partPath, chunkBuffer, { flag: 'a' });
  } catch (error) {
    reply.code(500);
    return { error: 'Failed to write chunk' };
  }

  let newSize = currentSize;
  try {
    newSize = (await fs.promises.stat(partPath)).size;
  } catch (error) {
    reply.code(500);
    return { error: 'Failed to read upload state' };
  }

  if (newSize > size) {
    try {
      await fs.promises.unlink(partPath);
    } catch {
      // ignore cleanup failures
    }
    reply.code(400);
    return { error: 'Upload exceeded declared size' };
  }

  if (newSize === size) {
    try {
      const result = await finalizeUpload({ partPath, fullPath, overwrite });
      if (!result.ok) {
        reply.code(409);
        return { error: result.error, status: 'exists' };
      }
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to finalize upload' };
    }
    await upsertUploadedFile({ root, relPath: targetRel, fullPath });
    await indexer.scanPath({ root, relPath: normalizeParent(targetRel), fastScan: true });
    return { ok: true, offset: newSize, complete: true };
  }

  return { ok: true, offset: newSize, complete: false };
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
  const wantsDownload = request.query.download === '1' || request.query.download === 'true';
  if (wantsDownload) {
    reply.header('Content-Disposition', `attachment; filename="${safeAttachmentName(relPath)}"`);
  }
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
  const { root: rootId, paths, flatten } = request.body || {};
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

  const normalizeZipPath = (value) => (value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const normalizeZipDir = (dirPath) => {
    const normalized = normalizeZipPath(dirPath);
    if (!normalized || normalized === '.' || normalized === '/') {
      return '';
    }
    return normalized.replace(/\/+$/, '');
  };
  const appendSuffix = (fileName, index) => {
    const ext = path.posix.extname(fileName);
    const base = ext ? fileName.slice(0, -ext.length) : fileName;
    return `${base} (${index})${ext}`;
  };
  const reserveZipName = (desired, allowRename = false) => {
    if (!desired) {
      return null;
    }
    if (!includedNames.has(desired)) {
      includedNames.add(desired);
      return desired;
    }
    if (!allowRename) {
      return null;
    }
    let counter = 2;
    let candidate = appendSuffix(desired, counter);
    while (includedNames.has(candidate)) {
      counter += 1;
      candidate = appendSuffix(desired, counter);
    }
    includedNames.add(candidate);
    return candidate;
  };
  const commonDir = (dirs) => {
    if (!dirs.length) {
      return '';
    }
    const splitDirs = dirs.map((dir) => normalizeZipDir(dir).split('/').filter(Boolean));
    let common = splitDirs[0];
    for (const parts of splitDirs.slice(1)) {
      let i = 0;
      while (i < common.length && i < parts.length && common[i] === parts[i]) {
        i += 1;
      }
      common = common.slice(0, i);
      if (!common.length) {
        break;
      }
    }
    return common.join('/');
  };
  const isUnderPrefix = (target, prefix) =>
    target === prefix || target.startsWith(`${prefix}/`);
  const includedNames = new Set();
  const selectedDirs = [];
  const selectedFiles = [];
  const seen = new Set();

  for (const relPathRaw of paths) {
    const relPath = normalizeRelPath(relPathRaw);
    if (!relPath || seen.has(relPath)) {
      continue;
    }
    seen.add(relPath);
    const fullPath = safeJoin(root.absPath, relPath);
    if (!fullPath) {
      continue;
    }
    let stats;
    try {
      stats = await fs.promises.lstat(fullPath);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) {
      continue;
    }
    if (stats.isDirectory()) {
      selectedDirs.push({ relPath, fullPath });
    } else if (stats.isFile()) {
      selectedFiles.push({ relPath, fullPath });
    }
  }

  selectedDirs.sort((a, b) => a.relPath.length - b.relPath.length);
  const dirEntries = [];
  for (const dirEntry of selectedDirs) {
    const dirRel = normalizeZipPath(dirEntry.relPath);
    if (!dirRel) {
      dirEntries.push(dirEntry);
      continue;
    }
    if (dirEntries.some((entry) => isUnderPrefix(dirRel, normalizeZipPath(entry.relPath)))) {
      continue;
    }
    dirEntries.push(dirEntry);
  }

  const dirPrefixes = dirEntries.map((entry) => normalizeZipPath(entry.relPath));
  const fileEntries = selectedFiles.filter((entry) => {
    const rel = normalizeZipPath(entry.relPath);
    return !dirPrefixes.some((prefix) => prefix && isUnderPrefix(rel, prefix));
  });

  const addEmptyDir = (zipDir) => {
    const name = `${normalizeZipDir(zipDir)}/`;
    const reserved = reserveZipName(name);
    if (!reserved) {
      return;
    }
    archive.append('', { name: reserved });
  };

  const addFileEntry = (fullPath, zipName, options = {}) => {
    const name = normalizeZipPath(zipName);
    const reserved = reserveZipName(name, options.allowRename);
    if (!reserved) {
      return;
    }
    archive.file(fullPath, { name: reserved });
  };

  const addDirectoryContents = async (fullDir, zipBase) => {
    let dirents;
    try {
      dirents = await fs.promises.readdir(fullDir, { withFileTypes: true });
    } catch (error) {
      fastify.log.warn({ err: error, fullDir }, 'Failed to read zip directory');
      return false;
    }
    let hasFile = false;
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) {
        continue;
      }
      const childFull = path.join(fullDir, dirent.name);
      const childZip = zipBase ? `${zipBase}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        const childHasFile = await addDirectoryContents(childFull, childZip);
        if (childHasFile) {
          hasFile = true;
        } else {
          addEmptyDir(childZip);
        }
      } else if (dirent.isFile()) {
        addFileEntry(childFull, childZip);
        hasFile = true;
      }
    }
    if (!hasFile && zipBase) {
      addEmptyDir(zipBase);
    }
    return hasFile;
  };

  for (const entry of dirEntries) {
    const zipBase = normalizeZipPath(entry.relPath);
    await addDirectoryContents(entry.fullPath, zipBase);
  }

  const flattenFiles = Boolean(flatten) && dirEntries.length === 0;
  let baseDir = '';
  if (!flattenFiles && !dirEntries.length && fileEntries.length) {
    const parentDirs = fileEntries.map((entry) => normalizeZipDir(path.posix.dirname(entry.relPath)));
    const sharedDir = commonDir(parentDirs);
    baseDir = normalizeZipDir(path.posix.dirname(sharedDir));
  }

  for (const entry of fileEntries) {
    let name = entry.relPath;
    if (flattenFiles) {
      name = path.posix.basename(normalizeZipPath(entry.relPath));
    } else if (baseDir) {
      const relativeName = path.posix.relative(baseDir, entry.relPath);
      if (relativeName && !relativeName.startsWith('..')) {
        name = relativeName;
      }
    }
    addFileEntry(entry.fullPath, name, { allowRename: flattenFiles });
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

if (TRASH_RETENTION_MS > 0) {
  const runCleanup = async () => {
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    try {
      const removed = await purgeTrash({ olderThan: cutoff });
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
