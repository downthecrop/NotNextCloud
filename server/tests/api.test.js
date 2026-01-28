const assert = require('node:assert/strict');
const test = require('node:test');

const baseUrl = process.env.LOCAL_CLOUD_BASE_URL || 'http://localhost:4170';
const user = process.env.LOCAL_CLOUD_USER;
const pass = process.env.LOCAL_CLOUD_PASS;

async function apiJson(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json();
  return { res, payload };
}

test('health', async () => {
  const { res, payload } = await apiJson('/api/health');
  assert.equal(res.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data?.status, 'ok');
});

test('info', async () => {
  const { res, payload } = await apiJson('/api/info');
  assert.equal(res.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.data?.apiVersion, 'number');
  assert.equal(typeof payload.data?.serverVersion, 'string');
});

test('bootstrap/list/search', async (t) => {
  const health = await apiJson('/api/health');
  const devMode = Boolean(health.payload?.data?.devMode);
  let token = null;
  if (!devMode) {
    if (!user || !pass) {
      t.skip('Auth required; set LOCAL_CLOUD_USER/LOCAL_CLOUD_PASS');
      return;
    }
    const login = await apiJson('/api/login', { method: 'POST', body: { user, pass } });
    assert.equal(login.payload.ok, true);
    token = login.payload.data?.token;
    assert.ok(token);
  }

  const bootstrap = await apiJson('/api/bootstrap', { token });
  assert.equal(bootstrap.payload.ok, true);
  const roots = bootstrap.payload.data?.roots || [];
  assert.ok(Array.isArray(roots));
  if (!roots.length) {
    t.skip('No roots configured');
    return;
  }

  const rootId = roots[0].id;
  const list = await apiJson(
    `/api/list?root=${encodeURIComponent(rootId)}&limit=5&includeTotal=false`,
    { token }
  );
  assert.equal(list.payload.ok, true);
  assert.equal(list.payload.data?.total, null);
  assert.ok(Array.isArray(list.payload.data?.items));

  const search = await apiJson(
    `/api/search?root=${encodeURIComponent(rootId)}&q=a&limit=5&includeTotal=false`,
    { token }
  );
  assert.equal(search.payload.ok, true);
  assert.equal(search.payload.data?.total, null);
  assert.ok(Array.isArray(search.payload.data?.items));
});
