const { sendOk, sendError, sendList } = require('../lib/response');
const { encodeCursor } = require('../lib/cursor');
const { parseNameCursor, parseMtimeCursor } = require('../lib/cursorParse');
const { makePrefixLike } = require('../lib/paths');
const { resolveRootScope } = require('../lib/roots');
const { parseBooleanFlag } = require('../lib/route');
const { toEntryList } = require('../lib/entries');
const { parsePagination } = require('../lib/pagination');
const { createLibraryListRouteHandler } = require('../lib/libraryListRoute');
const {
  listMediaAll,
  listMediaAllCursor,
  searchAll,
  searchAllCursor,
  searchFtsAll,
  searchFtsAllCursor,
  buildFtsQuery,
  listAlbumsAll,
  listAlbumsAllSearch,
  listArtistsAll,
  listArtistsAllSearch,
  listAlbumTracksAll,
  listArtistTracksAll,
} = require('../lib/queries');

function registerLibraryRoutes(fastify, ctx) {
  const { config, db, entrySelect, entrySelectWithId, entryColumns, allRootsId } = ctx;
  const resolveScopeOrReply = (rootId, reply) => {
    const scope = resolveRootScope(rootId, config.roots, allRootsId);
    if (!scope) {
      sendError(reply, 400, 'invalid_root', 'Invalid root');
      return null;
    }
    return scope;
  };

  fastify.get(
    '/api/list',
    createLibraryListRouteHandler({
      config,
      db,
      entrySelect,
      entrySelectWithId,
      allRootsId,
      normalizeRelPath: ctx.normalizeRelPath,
    })
  );

  fastify.get('/api/search', async (request, reply) => {
    const rootId = request.query.root;
    const scope = resolveScopeOrReply(rootId, reply);
    if (!scope) {
      return;
    }
    const query = (request.query.q || '').trim();
    const { limit, offset } = parsePagination(request.query);
    const type = (request.query.type || 'all').toLowerCase();
    const includeTotal = parseBooleanFlag(request.query.includeTotal, false);
    if (!query) {
      return sendList([], includeTotal ? 0 : null, limit, offset);
    }
    const cursorParser = type === 'photos' || type === 'music' ? parseMtimeCursor : parseNameCursor;
    const cursor = request.query.cursor ? cursorParser(request.query.cursor) : null;
    if (request.query.cursor && !cursor) {
      return sendError(reply, 400, 'invalid_cursor', 'Invalid cursor');
    }
    const like = `%${query}%`;
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    let rows = [];
    let total = includeTotal ? 0 : null;
    const ftsFields =
      type === 'music' || type === 'all' ? ['name', 'title', 'artist', 'album'] : ['name'];
    const ftsQuery = db.ftsEnabled ? buildFtsQuery(query, ftsFields) : '';
    const useFts = Boolean(ftsQuery);
    let nextCursor = null;
    if (cursor) {
      if (useFts) {
        const result = searchFtsAllCursor({
          db: db.db,
          entryColumns,
          rootIds: scope.rootIds,
          type,
          ftsQuery,
          prefixLike,
          limit,
          cursor,
          includeTotal,
        });
        rows = result.rows;
        total = result.total;
      } else {
        const result = searchAllCursor({
          db: db.db,
          entrySelect,
          rootIds: scope.rootIds,
          type,
          like,
          prefixLike,
          limit,
          cursor,
          includeTotal,
        });
        rows = result.rows;
        total = result.total;
      }
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        if (type === 'photos' || type === 'music') {
          nextCursor = encodeCursor({
            mtime: last.mtime,
            name: last.name,
            rootId: last.root_id,
            path: last.rel_path,
          });
        } else {
          nextCursor = encodeCursor({
            isDir: last.is_dir,
            name: last.name,
            rootId: last.root_id,
            path: last.rel_path,
          });
        }
      }
    } else if (useFts) {
      const result = searchFtsAll({
        db: db.db,
        entryColumns,
        rootIds: scope.rootIds,
        type,
        ftsQuery,
        prefixLike,
        limit,
        offset,
        includeTotal,
      });
      rows = result.rows;
      total = result.total;
    } else if (scope.isAll) {
      const results = searchAll({
        db: db.db,
        entrySelect,
        rootIds: scope.rootIds,
        type,
        like,
        prefixLike,
        limit,
        offset,
        includeTotal,
      });
      rows = results.rows;
      total = results.total;
    } else if (type === 'photos') {
      if (prefixLike) {
        rows = db.searchPhotosByPrefix.all(rootId, like, prefixLike, limit, offset);
        if (includeTotal) {
          total = db.countSearchPhotosByPrefix.get(rootId, like, prefixLike)?.count || 0;
        }
      } else {
        rows = db.searchPhotos.all(rootId, like, limit, offset);
        if (includeTotal) {
          total = db.countSearchPhotos.get(rootId, like)?.count || 0;
        }
      }
    } else if (type === 'music') {
      if (prefixLike) {
        rows = db.searchMusicByPrefix.all(rootId, like, like, like, like, prefixLike, limit, offset);
        if (includeTotal) {
          total =
            db.countSearchMusicByPrefix.get(rootId, like, like, like, like, prefixLike)?.count ||
            0;
        }
      } else {
        rows = db.searchMusic.all(rootId, like, like, like, like, limit, offset);
        if (includeTotal) {
          total = db.countSearchMusic.get(rootId, like, like, like, like)?.count || 0;
        }
      }
    } else {
      rows = db.searchByName.all(rootId, like, like, like, like, limit, offset);
      if (includeTotal) {
        total = db.countSearch.get(rootId, like, like, like, like)?.count || 0;
      }
    }
    const items = toEntryList(rows);
    return sendList(items, total, limit, cursor ? 0 : offset, nextCursor);
  });

  fastify.get('/api/media', async (request, reply) => {
    const rootId = request.query.root;
    const scope = resolveScopeOrReply(rootId, reply);
    if (!scope) {
      return;
    }

    const type = (request.query.type || '').toLowerCase();
    const { limit, offset } = parsePagination(request.query);
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    const cursor = request.query.cursor ? parseMtimeCursor(request.query.cursor) : null;
    const includeTotal = parseBooleanFlag(request.query.includeTotal, false);
    if (request.query.cursor && !cursor) {
      return sendError(reply, 400, 'invalid_cursor', 'Invalid cursor');
    }

    if (type !== 'photos' && type !== 'music') {
      return sendError(reply, 400, 'invalid_media_type', 'Invalid media type');
    }

    let rows = [];
    let total = includeTotal ? 0 : null;
    let nextCursor = null;
    if (cursor) {
      const results = listMediaAllCursor({
        db: db.db,
        entrySelect,
        rootIds: scope.rootIds,
        type,
        prefixLike,
        limit,
        cursor,
        includeTotal,
      });
      rows = results.rows;
      total = results.total;
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        nextCursor = encodeCursor({
          mtime: last.mtime,
          name: last.name,
          rootId: last.root_id,
          path: last.rel_path,
        });
      }
    } else if (scope.isAll) {
      const results = listMediaAll({
        db: db.db,
        entrySelect,
        rootIds: scope.rootIds,
        type,
        prefixLike,
        limit,
        offset,
        includeTotal,
      });
      rows = results.rows;
      total = results.total;
    } else if (type === 'photos') {
      if (prefixLike) {
        rows = db.listPhotosByPrefix.all(rootId, prefixLike, limit, offset);
        if (includeTotal) {
          total = db.countPhotosByPrefix.get(rootId, prefixLike)?.count || 0;
        }
      } else {
        rows = db.listPhotos.all(rootId, limit, offset);
        if (includeTotal) {
          total = db.countPhotos.get(rootId)?.count || 0;
        }
      }
    } else if (type === 'music') {
      if (prefixLike) {
        rows = db.listMusicByPrefix.all(rootId, prefixLike, limit, offset);
        if (includeTotal) {
          total = db.countMusicByPrefix.get(rootId, prefixLike)?.count || 0;
        }
      } else {
        rows = db.listMusic.all(rootId, limit, offset);
        if (includeTotal) {
          total = db.countMusic.get(rootId)?.count || 0;
        }
      }
    }

    const items = toEntryList(rows);

    return sendList(items, total, limit, cursor ? 0 : offset, nextCursor);
  });

  fastify.get('/api/music/albums', async (request, reply) => {
    const rootId = request.query.root;
    const scope = resolveScopeOrReply(rootId, reply);
    if (!scope) {
      return;
    }
    const query = (request.query.q || '').trim();
    const like = query ? `%${query}%` : null;
    const { limit, offset } = parsePagination(request.query);
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    let rows = [];
    let total = 0;
    if (scope.isAll) {
      const results = like
        ? listAlbumsAllSearch({
            db: db.db,
            rootIds: scope.rootIds,
            prefixLike,
            limit,
            offset,
            like,
          })
        : listAlbumsAll({ db: db.db, rootIds: scope.rootIds, prefixLike, limit, offset });
      rows = results.rows;
      total = results.total;
    } else {
      if (like) {
        rows = prefixLike
          ? db.listAlbumsByPrefixSearch.all(rootId, prefixLike, like, like, limit, offset)
          : db.listAlbumsSearch.all(rootId, like, like, limit, offset);
        total = prefixLike
          ? db.countAlbumsByPrefixSearch.get(rootId, prefixLike, like, like)?.count || 0
          : db.countAlbumsSearch.get(rootId, like, like)?.count || 0;
      } else {
        rows = prefixLike
          ? db.listAlbumsByPrefix.all(rootId, prefixLike, limit, offset)
          : db.listAlbums.all(rootId, limit, offset);
        total = prefixLike
          ? db.countAlbumsByPrefix.get(rootId, prefixLike)?.count || 0
          : db.countAlbums.get(rootId)?.count || 0;
      }
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
    const scope = resolveScopeOrReply(rootId, reply);
    if (!scope) {
      return;
    }
    const query = (request.query.q || '').trim();
    const like = query ? `%${query}%` : null;
    const { limit, offset } = parsePagination(request.query);
    const prefixLike = makePrefixLike(request.query.pathPrefix);
    let rows = [];
    let total = 0;
    if (scope.isAll) {
      const results = like
        ? listArtistsAllSearch({
            db: db.db,
            rootIds: scope.rootIds,
            prefixLike,
            limit,
            offset,
            like,
          })
        : listArtistsAll({ db: db.db, rootIds: scope.rootIds, prefixLike, limit, offset });
      rows = results.rows;
      total = results.total;
    } else {
      if (like) {
        rows = prefixLike
          ? db.listArtistsByPrefixSearch.all(rootId, prefixLike, like, limit, offset)
          : db.listArtistsSearch.all(rootId, like, limit, offset);
        total = prefixLike
          ? db.countArtistsByPrefixSearch.get(rootId, prefixLike, like)?.count || 0
          : db.countArtistsSearch.get(rootId, like)?.count || 0;
      } else {
        rows = prefixLike
          ? db.listArtistsByPrefix.all(rootId, prefixLike, limit, offset)
          : db.listArtists.all(rootId, limit, offset);
        total = prefixLike
          ? db.countArtistsByPrefix.get(rootId, prefixLike)?.count || 0
          : db.countArtists.get(rootId)?.count || 0;
      }
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
    const scope = resolveScopeOrReply(rootId, reply);
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
    return sendOk({ items: toEntryList(rows) });
  });

  fastify.get('/api/music/artist', async (request, reply) => {
    const rootId = request.query.root;
    const artist = request.query.artist;
    const scope = resolveScopeOrReply(rootId, reply);
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
    return sendOk({ items: toEntryList(rows) });
  });
}

module.exports = registerLibraryRoutes;
