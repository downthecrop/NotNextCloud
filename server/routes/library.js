const { sendOk, sendError, sendList } = require('../lib/response');
const { makePrefixLike } = require('../lib/paths');
const { resolveRootScope } = require('../lib/roots');
const {
  listMediaAll,
  searchAll,
  listAlbumsAll,
  listArtistsAll,
  listAlbumTracksAll,
  listArtistTracksAll,
} = require('../lib/queries');

function registerLibraryRoutes(fastify, ctx) {
  const { config, db, entrySelect, allRootsId } = ctx;

  fastify.get('/api/list', async (request, reply) => {
    const rootId = request.query.root;
    const root = config.roots.find((item) => item.id === rootId);
    if (!root) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }

    const relPath = ctx.normalizeRelPath(request.query.path || '');
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
    return sendList(items, total, limit, offset);
  });

  fastify.get('/api/search', async (request, reply) => {
    const rootId = request.query.root;
    const scope = resolveRootScope(rootId, config.roots, allRootsId);
    if (!scope) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }
    const query = (request.query.q || '').trim();
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
    const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
    if (!query) {
      return sendList([], 0, limit, offset);
    }
    const type = (request.query.type || 'all').toLowerCase();
    const like = `%${query}%`;
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    let rows = [];
    let total = 0;
    if (scope.isAll) {
      const results = searchAll({
        db: db.db,
        entrySelect,
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
        total =
          db.countSearchMusicByPrefix.get(rootId, like, like, like, like, prefixLike)?.count || 0;
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
    return sendList(items, total, limit, offset);
  });

  fastify.get('/api/media', async (request, reply) => {
    const rootId = request.query.root;
    const scope = resolveRootScope(rootId, config.roots, allRootsId);
    if (!scope) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }

    const type = (request.query.type || '').toLowerCase();
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
    const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
    const prefixLike = makePrefixLike(request.query.pathPrefix);

    if (type !== 'photos' && type !== 'music') {
      return sendError(reply, 400, 'invalid_media_type', 'Invalid media type');
    }

    let rows = [];
    let total = 0;
    if (scope.isAll) {
      const results = listMediaAll({
        db: db.db,
        entrySelect,
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

    return sendList(items, total, limit, offset);
  });

  fastify.get('/api/music/albums', async (request, reply) => {
    const rootId = request.query.root;
    const scope = resolveRootScope(rootId, config.roots, allRootsId);
    if (!scope) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
    const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    let rows = [];
    let total = 0;
    if (scope.isAll) {
      const results = listAlbumsAll({ db: db.db, rootIds: scope.rootIds, prefixLike, limit, offset });
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
    return sendList(items, total, limit, offset);
  });

  fastify.get('/api/music/artists', async (request, reply) => {
    const rootId = request.query.root;
    const scope = resolveRootScope(rootId, config.roots, allRootsId);
    if (!scope) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
    const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    let rows = [];
    let total = 0;
    if (scope.isAll) {
      const results = listArtistsAll({ db: db.db, rootIds: scope.rootIds, prefixLike, limit, offset });
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
    return sendList(items, total, limit, offset);
  });

  fastify.get('/api/music/album', async (request, reply) => {
    const rootId = request.query.root;
    const albumKey = request.query.key;
    const scope = resolveRootScope(rootId, config.roots, allRootsId);
    if (!scope || !albumKey) {
      return sendError(reply, 400, 'invalid_request', 'Invalid request');
    }
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    const rows = scope.isAll
      ? listAlbumTracksAll({
          db: db.db,
          entrySelect,
          rootIds: scope.rootIds,
          albumKey,
          prefixLike,
        })
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
    return sendOk({ items });
  });

  fastify.get('/api/music/artist', async (request, reply) => {
    const rootId = request.query.root;
    const artist = request.query.artist;
    const scope = resolveRootScope(rootId, config.roots, allRootsId);
    if (!scope || !artist) {
      return sendError(reply, 400, 'invalid_request', 'Invalid request');
    }
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    const rows = scope.isAll
      ? listArtistTracksAll({
          db: db.db,
          entrySelect,
          rootIds: scope.rootIds,
          artist,
          prefixLike,
        })
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
    return sendOk({ items });
  });
}

module.exports = registerLibraryRoutes;
