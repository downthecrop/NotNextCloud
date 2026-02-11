import { inject } from 'vue';

export function useApi() {
  const token = inject('authToken');
  const apiClient = inject('apiClient', null);
  const injectedFetch = inject('apiFetch', null);
  const injectedJson = inject('apiJson', null);
  const injectedUrls = inject('apiUrls', null);

  const apiFetch = apiClient?.apiFetch || injectedFetch;
  const apiJson = apiClient?.apiJson || injectedJson;
  const apiUrls = apiClient?.urls || injectedUrls;

  const withToken =
    apiClient?.withToken ||
    ((url) => {
      if (!token?.value) {
        return url;
      }
      const joiner = url.includes('?') ? '&' : '?';
      return `${url}${joiner}token=${encodeURIComponent(token.value)}`;
    });

  const withQuery = (basePath, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      query.set(key, String(value));
    });
    const encoded = query.toString();
    return encoded ? `${basePath}?${encoded}` : basePath;
  };

  const tokenRouteUrl = (urlFactory, fallbackPath, params) =>
    urlFactory ? urlFactory(params) : withToken(withQuery(fallbackPath, params));

  const fileUrl = (rootId, path) =>
    tokenRouteUrl(apiUrls?.file, '/api/file', { root: rootId, path });

  const previewUrl = (rootId, path) =>
    tokenRouteUrl(apiUrls?.preview, '/api/preview', { root: rootId, path });

  const downloadUrl = (rootId, path) =>
    tokenRouteUrl(apiUrls?.file, '/api/file', { root: rootId, path, download: 1 });

  const albumArtUrl = (rootId, key) =>
    tokenRouteUrl(apiUrls?.albumArt, '/api/album-art', { root: rootId, key });

  const trashFileUrl = (trashId, download = false) =>
    tokenRouteUrl(apiUrls?.trashFile, '/api/trash/file', {
      id: trashId,
      download: download ? 1 : undefined,
    });

  return {
    token,
    apiFetch,
    apiJson,
    apiUrls,
    withToken,
    fileUrl,
    previewUrl,
    downloadUrl,
    albumArtUrl,
    trashFileUrl,
  };
}
