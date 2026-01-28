const { sendOk, sendError } = require('../lib/response');
const { createToken, getRequestToken } = require('../lib/auth');

function registerAuthRoutes(fastify, ctx) {
  const { config, sessions } = ctx;
  const cookieName = config.sessionCookieName || 'lc_token';
  const ttlHours = Number.isFinite(config.sessionTtlHours) ? config.sessionTtlHours : 24;
  const ttlMs = Math.max(0, ttlHours) * 60 * 60 * 1000;

  const buildCookie = (token, maxAgeSeconds) => {
    const parts = [
      `${cookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (maxAgeSeconds !== null && maxAgeSeconds !== undefined) {
      parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
    }
    return parts.join('; ');
  };

  fastify.post('/api/login', async (request, reply) => {
    const { user, pass } = request.body || {};
    if (user !== config.auth.user || pass !== config.auth.pass) {
      return sendError(reply, 401, 'invalid_credentials', 'Invalid credentials');
    }
    const token = createToken();
    const now = Date.now();
    const expiresAt = ttlMs > 0 ? now + ttlMs : null;
    sessions.set(token, {
      user,
      createdAt: now,
      expiresAt,
    });
    const maxAgeSeconds = ttlMs > 0 ? ttlMs / 1000 : null;
    reply.header('Set-Cookie', buildCookie(token, maxAgeSeconds));
    return sendOk({ token, expiresAt, ttlHours });
  });

  fastify.post('/api/logout', async (request, reply) => {
    const token = getRequestToken(request, {
      cookieName,
      allowQueryToken: config.allowQueryToken,
    });
    if (token) {
      sessions.delete(token);
    }
    reply.header('Set-Cookie', buildCookie('', 0));
    return sendOk({ loggedOut: true });
  });
}

module.exports = registerAuthRoutes;
