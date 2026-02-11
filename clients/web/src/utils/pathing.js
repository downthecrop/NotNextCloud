export function normalizePath(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function parentPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/');
}

export function pathLabel(pathValue, fallback = 'Root') {
  const normalized = normalizePath(pathValue);
  if (!normalized) {
    return fallback;
  }
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}
