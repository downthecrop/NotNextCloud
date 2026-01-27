const { sendOk, sendError } = require('../lib/response');
const { createToken, getRequestToken } = require('../lib/auth');

function registerAuthRoutes(fastify, ctx) {
  const { config, sessions } = ctx;

  fastify.post('/api/login', async (request, reply) => {
    const { user, pass } = request.body || {};
    if (user !== config.auth.user || pass !== config.auth.pass) {
      return sendError(reply, 401, 'invalid_credentials', 'Invalid credentials');
    }
    const token = createToken();
    sessions.set(token, {
      user,
      createdAt: Date.now(),
    });
    return sendOk({ token });
  });

  fastify.post('/api/logout', async (request) => {
    const token = getRequestToken(request);
    if (token) {
      sessions.delete(token);
    }
    return sendOk({ loggedOut: true });
  });
}

module.exports = registerAuthRoutes;
