const { sendError, sendList } = require('./response');
const { encodeCursor } = require('./cursor');
const { parseListCursor, parseRawCursor, parseListCursorAll } = require('./cursorParse');
const { parseBooleanFlag } = require('./route');
const { toEntryList } = require('./entries');
const { parsePagination } = require('./pagination');
const {
  listChildrenCursor,
  listChildrenAll,
  listChildrenAllCursor,
  listChildrenAllRaw,
  listChildrenAllRawCursor,
  getMaxId,
  getMaxIdAll,
} = require('./queries');

function createLibraryListRouteHandler({
  config,
  db,
  entrySelect,
  entrySelectWithId,
  allRootsId,
  normalizeRelPath,
}) {
  return async function libraryListRouteHandler(request, reply) {
    const rootId = request.query.root;
    const relPath = normalizeRelPath(request.query.path || '');
    const { limit, offset } = parsePagination(request.query);
    const sortMode = String(request.query.sort || '').toLowerCase();
    const useRawOrder = sortMode === 'none';
    const cursor = !useRawOrder && request.query.cursor ? parseListCursor(request.query.cursor) : null;
    const rawCursor = useRawOrder && request.query.cursor ? parseRawCursor(request.query.cursor) : null;
    const includeTotal = parseBooleanFlag(request.query.includeTotal, false);
    let rows = [];
    let total = includeTotal ? 0 : null;
    let nextCursor = null;

    if (rootId === allRootsId) {
      if (relPath) {
        return sendError(reply, 400, 'invalid_path', 'Only root-level listing is supported.');
      }
      if (useRawOrder && request.query.cursor && !rawCursor) {
        return sendError(reply, 400, 'invalid_cursor', 'Invalid cursor');
      }
      const allCursor =
        !useRawOrder && request.query.cursor ? parseListCursorAll(request.query.cursor) : null;
      if (!useRawOrder && request.query.cursor && !allCursor) {
        return sendError(reply, 400, 'invalid_cursor', 'Invalid cursor');
      }
      const rootIds = config.roots.map((root) => root.id);
      const snapshotMaxId = useRawOrder
        ? rawCursor?.maxId ?? getMaxIdAll({ db: db.db, rootIds, parent: relPath })
        : null;
      if (useRawOrder && rawCursor) {
        const result = listChildrenAllRawCursor({
          db: db.db,
          entrySelectWithId,
          rootIds,
          parent: relPath,
          limit,
          cursor: rawCursor,
          includeTotal,
          maxId: snapshotMaxId,
        });
        rows = result.rows;
        total = result.total;
      } else if (allCursor && !useRawOrder) {
        const result = listChildrenAllCursor({
          db: db.db,
          entrySelect,
          rootIds,
          parent: relPath,
          limit,
          cursor: allCursor,
          includeTotal,
        });
        rows = result.rows;
        total = result.total;
      } else if (useRawOrder) {
        const result = listChildrenAllRaw({
          db: db.db,
          entrySelectWithId,
          rootIds,
          parent: relPath,
          limit,
          offset,
          includeTotal,
          maxId: snapshotMaxId,
        });
        rows = result.rows;
        total = result.total;
      } else {
        const result = listChildrenAll({
          db: db.db,
          entrySelect,
          rootIds,
          parent: relPath,
          limit,
          offset,
          includeTotal,
        });
        rows = result.rows;
        total = result.total;
      }
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        nextCursor = useRawOrder
          ? encodeCursor({ id: last.id, maxId: snapshotMaxId })
          : encodeCursor({
              isDir: last.is_dir,
              name: last.name,
              rootId: last.root_id,
              path: last.rel_path,
            });
      }
      const items = toEntryList(rows);
      const usedCursor = useRawOrder ? Boolean(rawCursor) : Boolean(allCursor);
      return sendList(items, total, limit, usedCursor ? 0 : offset, nextCursor);
    }

    const rootExists = config.roots.some((item) => item.id === rootId);
    if (!rootExists) {
      return sendError(reply, 400, 'invalid_root', 'Invalid root');
    }
    if (!useRawOrder && request.query.cursor && !cursor) {
      return sendError(reply, 400, 'invalid_cursor', 'Invalid cursor');
    }
    if (useRawOrder && request.query.cursor && !rawCursor) {
      return sendError(reply, 400, 'invalid_cursor', 'Invalid cursor');
    }
    const snapshotMaxId = useRawOrder
      ? rawCursor?.maxId ?? getMaxId({ db: db.db, rootId, parent: relPath })
      : null;
    if (useRawOrder && rawCursor) {
      const result = listChildrenAllRawCursor({
        db: db.db,
        entrySelectWithId,
        rootIds: [rootId],
        parent: relPath,
        limit,
        cursor: rawCursor,
        includeTotal,
        maxId: snapshotMaxId,
      });
      rows = result.rows;
      total = result.total;
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        nextCursor = encodeCursor({ id: last.id, maxId: snapshotMaxId });
      }
    } else if (cursor) {
      rows = listChildrenCursor({
        db: db.db,
        entrySelect,
        rootId,
        parent: relPath,
        limit,
        cursor,
      });
      if (includeTotal) {
        total = db.countChildren.get(rootId, relPath)?.count || 0;
      }
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        nextCursor = encodeCursor({
          isDir: last.is_dir,
          name: last.name,
          path: last.rel_path,
        });
      }
    } else if (useRawOrder) {
      const result = listChildrenAllRaw({
        db: db.db,
        entrySelectWithId,
        rootIds: [rootId],
        parent: relPath,
        limit,
        offset,
        includeTotal,
        maxId: snapshotMaxId,
      });
      rows = result.rows;
      total = result.total;
    } else {
      rows = db.listChildren.all(rootId, relPath, limit, offset);
      if (includeTotal) {
        total = db.countChildren.get(rootId, relPath)?.count || 0;
      }
    }
    const items = toEntryList(rows);
    const usedCursor = useRawOrder ? Boolean(rawCursor) : Boolean(cursor);
    return sendList(items, total, limit, usedCursor ? 0 : offset, nextCursor);
  };
}

module.exports = {
  createLibraryListRouteHandler,
};
