export function itemKey(item, fallbackRootId = '') {
  if (!item) {
    return '';
  }
  const rootId = item.rootId || fallbackRootId;
  const path = item.path || '';
  if (rootId) {
    return `${rootId}:${path}`;
  }
  return path;
}
