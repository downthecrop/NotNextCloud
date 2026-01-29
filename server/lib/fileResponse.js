const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

function resolveMimeType(filePath, fallbackMime) {
  const resolved = fallbackMime || mime.lookup(filePath) || 'application/octet-stream';
  const ext = path.extname(filePath).toLowerCase();
  if (resolved === 'application/octet-stream' && ext === '.opus') {
    return 'audio/opus';
  }
  return resolved;
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader) {
    return null;
  }
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (!match) {
    return null;
  }
  const start = match[1] ? Number.parseInt(match[1], 10) : 0;
  const end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) {
    return null;
  }
  return { start, end };
}

function sendFileResponse({ reply, fullPath, stats, mimeType, rangeHeader, downloadName }) {
  if (downloadName) {
    reply.header('Content-Disposition', `attachment; filename="${downloadName}"`);
  }

  const range = parseRangeHeader(rangeHeader, stats.size);
  if (range) {
    const { start, end } = range;
    if (start >= stats.size || end >= stats.size || start > end) {
      reply.code(416);
      reply.header('Content-Range', `bytes */${stats.size}`);
      return;
    }
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${stats.size}`);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', end - start + 1);
    reply.header('Content-Type', mimeType);
    return reply.send(fs.createReadStream(fullPath, { start, end }));
  }

  reply.header('Content-Type', mimeType);
  return reply.send(fs.createReadStream(fullPath));
}

module.exports = {
  resolveMimeType,
  sendFileResponse,
};
