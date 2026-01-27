function sendOk(data, meta) {
  if (meta) {
    return { ok: true, data, meta };
  }
  return { ok: true, data };
}

function sendError(reply, status, code, message, details) {
  reply.code(status);
  return reply.send({
    ok: false,
    error: {
      code,
      message,
      details,
    },
  });
}

function sendList(items, total, limit, offset) {
  return sendOk({ items, total, limit, offset });
}

module.exports = {
  sendOk,
  sendError,
  sendList,
};
