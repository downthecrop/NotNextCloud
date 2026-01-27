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

function getRequestToken(request) {
  return getBearerToken(request) || request.query?.token || null;
}

module.exports = {
  createToken,
  getBearerToken,
  getRequestToken,
};
