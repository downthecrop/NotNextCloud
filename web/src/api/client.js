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

  const urls = {
    health: () => buildUrl('/api/health'),
    login: () => buildUrl('/api/login'),
    logout: () => buildUrl('/api/logout'),
    info: () => buildUrl('/api/info'),
    bootstrap: () => buildUrl('/api/bootstrap'),
    status: () => buildUrl('/api/status'),
    roots: () => buildUrl('/api/roots'),
    scan: (params) => buildUrl('/api/scan', params),
    scanSettings: () => buildUrl('/api/scan/settings'),
    previewsRebuild: () => buildUrl('/api/previews/rebuild'),
    list: (params) => buildUrl('/api/list', params),
    search: (params) => buildUrl('/api/search', params),
    media: (params) => buildUrl('/api/media', params),
    musicAlbums: (params) => buildUrl('/api/music/albums', params),
    musicArtists: (params) => buildUrl('/api/music/artists', params),
    musicAlbum: (params) => buildUrl('/api/music/album', params),
    musicArtist: (params) => buildUrl('/api/music/artist', params),
    uploadStatus: (params) => buildUrl('/api/upload/status', params),
    uploadChunk: (params) => buildUrl('/api/upload/chunk', params),
    zip: () => buildUrl('/api/zip'),
    trash: (params) => buildUrl('/api/trash', params),
    trashRestore: () => buildUrl('/api/trash/restore'),
    trashDelete: () => buildUrl('/api/trash/delete'),
    trashClear: () => buildUrl('/api/trash/clear'),
    delete: () => buildUrl('/api/delete'),
    file: (params) => withToken(buildUrl('/api/file', params)),
    preview: (params) => withToken(buildUrl('/api/preview', params)),
    albumArt: (params) => withToken(buildUrl('/api/album-art', params)),
    trashFile: (params) => withToken(buildUrl('/api/trash/file', params)),
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
