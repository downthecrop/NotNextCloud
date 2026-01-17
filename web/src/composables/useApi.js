import { inject } from 'vue';

export function useApi() {
  const token = inject('authToken');
  const apiFetch = inject('apiFetch');

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

  const albumArtUrl = (rootId, key) =>
    withToken(`/api/album-art?root=${encodeURIComponent(rootId)}&key=${encodeURIComponent(key)}`);

  return {
    token,
    apiFetch,
    withToken,
    fileUrl,
    previewUrl,
    albumArtUrl,
  };
}
