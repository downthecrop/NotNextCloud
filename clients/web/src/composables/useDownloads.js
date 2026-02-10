import { useApi } from './useApi';

function sanitizeLabel(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
  }
  const safe = trimmed.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || '';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function useDownloads() {
  const { apiFetch, downloadUrl, apiUrls } = useApi();

  const downloadFile = ({ rootId, path, filename }) => {
    if (!rootId || !path) {
      return;
    }
    const link = document.createElement('a');
    link.href = downloadUrl(rootId, path);
    link.download = filename || 'download';
    link.click();
  };

  const downloadZipPaths = async ({
    rootId,
    paths,
    zipLabel = 'files',
    flatten = false,
    includeRoot = false,
  }) => {
    if (!rootId || !Array.isArray(paths) || !paths.length) {
      return;
    }
    const res = await apiFetch(apiUrls?.zip ? apiUrls.zip() : '/api/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: rootId,
        paths,
        flatten: Boolean(flatten),
      }),
    });
    if (!res.ok) {
      return;
    }
    const blob = await res.blob();
    const label = sanitizeLabel(zipLabel) || 'files';
    const rootSuffix = includeRoot && rootId ? `-${sanitizeLabel(rootId)}` : '';
    downloadBlob(blob, `${label}${rootSuffix}.zip`);
  };

  const downloadGrouped = async ({
    items,
    getRootId,
    getPath,
    getName,
    zipLabel = 'music',
    flatten = false,
    includeRoot = false,
  }) => {
    if (!Array.isArray(items) || !items.length) {
      return;
    }
    const grouped = new Map();
    for (const item of items) {
      const rootId = getRootId(item);
      const path = getPath(item);
      if (!rootId || !path) {
        continue;
      }
      if (!grouped.has(rootId)) {
        grouped.set(rootId, []);
      }
      grouped.get(rootId).push(item);
    }
    const appendRoot = includeRoot || grouped.size > 1;
    for (const [rootId, groupItems] of grouped.entries()) {
      if (groupItems.length === 1) {
        const name = getName?.(groupItems[0]) || 'download';
        downloadFile({ rootId, path: getPath(groupItems[0]), filename: name });
        continue;
      }
      await downloadZipPaths({
        rootId,
        paths: groupItems.map((item) => getPath(item)),
        zipLabel,
        flatten,
        includeRoot: appendRoot,
      });
    }
  };

  return {
    downloadFile,
    downloadZipPaths,
    downloadGrouped,
    sanitizeLabel,
  };
}
