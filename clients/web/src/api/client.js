function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry === undefined || entry === null || entry === '') {
          return;
        }
        search.append(key, String(entry));
      });
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function createApiClient({
  baseUrl = '',
  getToken,
  onUnauthorized,
  queryToken = false,
} = {}) {
  const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  const resolvePath = (path) => {
    if (!normalizedBase) {
      return path;
    }
    if (path.startsWith('/')) {
      return `${normalizedBase}${path}`;
    }
    return `${normalizedBase}/${path}`;
  };
  const resolveUrl = (path) => (isAbsoluteUrl(path) ? path : resolvePath(path));

  const withToken = (url) => {
    if (!queryToken) {
      return url;
    }
    const token = getToken ? getToken() : '';
    if (!token) {
      return url;
    }
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}token=${encodeURIComponent(token)}`;
  };

  const apiFetch = async (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    const token = getToken ? getToken() : '';
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const isBinaryBody =
      options.body instanceof FormData ||
      options.body instanceof Blob ||
      options.body instanceof ArrayBuffer ||
      ArrayBuffer.isView(options.body);
    if (options.body && !headers.has('Content-Type') && !isBinaryBody) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(resolveUrl(url), {
      credentials: options.credentials ?? 'same-origin',
      ...options,
      headers,
    });
    if (response.status === 401 && typeof onUnauthorized === 'function') {
      onUnauthorized();
    }
    return response;
  };

  const apiJson = async (url, options = {}) => {
    let res;
    try {
      res = await apiFetch(url, options);
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: {
          message: 'Network error',
          details: error?.message || null,
        },
      };
    }
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (payload && typeof payload === 'object' && 'ok' in payload) {
      if (!payload.ok) {
        return {
          ok: false,
          status: res.status,
          error: payload.error || { message: 'Request failed' },
        };
      }
      return {
        ok: true,
        status: res.status,
        data: payload.data,
        meta: payload.meta || null,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: payload?.error || { message: 'Request failed' },
      };
    }
    return { ok: true, status: res.status, data: payload, meta: null };
  };

  const buildUrl = (path, params) => resolvePath(`${path}${buildQuery(params)}`);
  const makeUrlFactory = (path, { token = false } = {}) => (params) => {
    const url = buildUrl(path, params);
    return token ? withToken(url) : url;
  };
  const routeMap = {
    health: '/api/health',
    login: '/api/login',
    logout: '/api/logout',
    info: '/api/info',
    bootstrap: '/api/bootstrap',
    status: '/api/status',
    roots: '/api/roots',
    scan: '/api/scan',
    scanSettings: '/api/scan/settings',
    previewsRebuild: '/api/previews/rebuild',
    list: '/api/list',
    search: '/api/search',
    media: '/api/media',
    musicAlbums: '/api/music/albums',
    musicArtists: '/api/music/artists',
    musicAlbum: '/api/music/album',
    musicArtist: '/api/music/artist',
    uploadStatus: '/api/upload/status',
    uploadChunk: '/api/upload/chunk',
    zip: '/api/zip',
    trash: '/api/trash',
    trashRestore: '/api/trash/restore',
    trashDelete: '/api/trash/delete',
    trashClear: '/api/trash/clear',
    delete: '/api/delete',
  };
  const tokenRouteMap = {
    file: '/api/file',
    preview: '/api/preview',
    albumArt: '/api/album-art',
    trashFile: '/api/trash/file',
  };
  const urls = {
    ...Object.fromEntries(
      Object.entries(routeMap).map(([name, routePath]) => [name, makeUrlFactory(routePath)])
    ),
    ...Object.fromEntries(
      Object.entries(tokenRouteMap).map(([name, routePath]) => [
        name,
        makeUrlFactory(routePath, { token: true }),
      ])
    ),
  };

  return {
    apiFetch,
    apiJson,
    buildUrl,
    withToken,
    urls,
  };
}

export { buildQuery };
