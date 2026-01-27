import { inject } from 'vue';

export function useApi() {
  const token = inject('authToken');
  const apiFetch = inject('apiFetch');
  const apiJson = inject('apiJson');

  const withToken = (url) => {
    if (!token?.value) {
      return url;
    }
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}token=${encodeURIComponent(token.value)}`;
  };

  const fileUrl = (rootId, path) =>
    withToken(`/api/file?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`);

  const previewUrl = (rootId, path) =>
    withToken(`/api/preview?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`);

  const downloadUrl = (rootId, path) =>
    withToken(
      `/api/file?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}&download=1`
    );

  const albumArtUrl = (rootId, key) =>
    withToken(`/api/album-art?root=${encodeURIComponent(rootId)}&key=${encodeURIComponent(key)}`);

  const trashFileUrl = (trashId, download = false) => {
    const base = `/api/trash/file?id=${encodeURIComponent(trashId)}`;
    return withToken(download ? `${base}&download=1` : base);
  };

  return {
    token,
    apiFetch,
    apiJson,
    withToken,
    fileUrl,
    previewUrl,
    downloadUrl,
    albumArtUrl,
    trashFileUrl,
  };
}
