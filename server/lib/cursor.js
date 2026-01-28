function encodeCursor(payload) {
  if (!payload) {
    return null;
  }
  try {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  } catch {
    return null;
  }
}

function decodeCursor(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const tryDecode = (encoding) => {
    const decoded = Buffer.from(value, encoding).toString('utf8');
    return JSON.parse(decoded);
  };
  try {
    return tryDecode('base64url');
  } catch {
    try {
      return tryDecode('base64');
    } catch {
      return null;
    }
  }
}

module.exports = {
  encodeCursor,
  decodeCursor,
};
