const crypto = require('crypto');

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

function parseCookies(header) {
  const value = header || '';
  if (!value) {
    return {};
  }
  return value.split(';').reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) {
      return acc;
    }
    acc[rawKey] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getCookieToken(request, cookieName) {
  if (!cookieName) {
    return null;
  }
  const cookies = parseCookies(request.headers.cookie || '');
  return cookies[cookieName] || null;
}

function getRequestToken(request, options = {}) {
  const cookieName = options.cookieName || 'lc_token';
  const allowQueryToken = options.allowQueryToken === true;
  return (
    getBearerToken(request) ||
    getCookieToken(request, cookieName) ||
    (allowQueryToken ? request.query?.token : null) ||
    null
  );
}

module.exports = {
  createToken,
  getBearerToken,
  getRequestToken,
  getCookieToken,
  parseCookies,
};
