const { decodeCursor } = require('./cursor');

function parseIsDir(value) {
  if (value === true || value === 1) {
    return 1;
  }
  if (value === false || value === 0) {
    return 0;
  }
  return null;
}

function parseString(value) {
  return typeof value === 'string' ? value : null;
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return parseNumber(value);
}

function parseCursor(raw, { required, optional = {} }) {
  const cursor = decodeCursor(raw);
  if (!cursor || typeof cursor !== 'object') {
    return null;
  }
  const parsed = {};
  for (const [field, parser] of Object.entries(required)) {
    const value = parser(cursor[field]);
    if (value === null) {
      return null;
    }
    parsed[field] = value;
  }
  for (const [field, parser] of Object.entries(optional)) {
    parsed[field] = parser(cursor[field]);
  }
  return parsed;
}

function parseListCursor(raw) {
  return parseCursor(raw, {
    required: {
      isDir: parseIsDir,
      name: parseString,
      path: parseString,
    },
  });
}

function parseRawCursor(raw) {
  return parseCursor(raw, {
    required: { id: parseNumber },
    optional: { maxId: parseOptionalNumber },
  });
}

function parseListCursorAll(raw) {
  return parseCursor(raw, {
    required: {
      isDir: parseIsDir,
      name: parseString,
      path: parseString,
      rootId: parseString,
    },
  });
}

function parseNameCursor(raw) {
  return parseCursor(raw, {
    required: {
      isDir: parseIsDir,
      name: parseString,
      rootId: parseString,
      path: parseString,
    },
  });
}

function parseMtimeCursor(raw) {
  return parseCursor(raw, {
    required: {
      mtime: parseNumber,
      name: parseString,
      rootId: parseString,
      path: parseString,
    },
  });
}

module.exports = {
  parseListCursor,
  parseRawCursor,
  parseListCursorAll,
  parseNameCursor,
  parseMtimeCursor,
};
