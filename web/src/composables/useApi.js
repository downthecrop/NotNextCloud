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

  const fileUrl = (rootId, path) =>
    apiUrls?.file
      ? apiUrls.file({ root: rootId, path })
      : withToken(`/api/file?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`);

  const previewUrl = (rootId, path) =>
    apiUrls?.preview
      ? apiUrls.preview({ root: rootId, path })
      : withToken(`/api/preview?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`);

  const downloadUrl = (rootId, path) =>
    apiUrls?.file
      ? apiUrls.file({ root: rootId, path, download: 1 })
      : withToken(
          `/api/file?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}&download=1`
        );

  const albumArtUrl = (rootId, key) =>
    apiUrls?.albumArt
      ? apiUrls.albumArt({ root: rootId, key })
      : withToken(`/api/album-art?root=${encodeURIComponent(rootId)}&key=${encodeURIComponent(key)}`);

  const trashFileUrl = (trashId, download = false) => {
    if (apiUrls?.trashFile) {
      return apiUrls.trashFile({ id: trashId, download: download ? 1 : undefined });
    }
    const base = `/api/trash/file?id=${encodeURIComponent(trashId)}`;
    return withToken(download ? `${base}&download=1` : base);
  };

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
