const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { parseRangeHeader } = require('./httpRange');

function resolveMimeType(filePath, fallbackMime) {
  const resolved = fallbackMime || mime.lookup(filePath) || 'application/octet-stream';
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.opus') {
    return 'audio/ogg; codecs=opus';
  }
  return resolved;
}

function sendFileResponse({ reply, fullPath, stats, mimeType, rangeHeader, downloadName }) {
  if (downloadName) {
    reply.header('Content-Disposition', `attachment; filename="${downloadName}"`);
  }

  reply.header('Accept-Ranges', 'bytes');
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
    reply.header('Content-Length', end - start + 1);
    reply.header('Content-Type', mimeType);
    return reply.send(fs.createReadStream(fullPath, { start, end }));
  }

  reply.header('Content-Length', stats.size);
  reply.header('Content-Type', mimeType);
  return reply.send(fs.createReadStream(fullPath));
}

module.exports = {
  resolveMimeType,
  sendFileResponse,
};
