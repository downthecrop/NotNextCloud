export async function loadPaged({
  reset = true,
  items,
  total,
  offset,
  cursor,
  loading,
  error,
  errorMessage,
  onReset,
  fetchPage,
  requestVersion,
}) {
  const callVersion = requestVersion ? requestVersion.value + 1 : null;
  if (requestVersion) {
    requestVersion.value = callVersion;
  }
  const isStale = () => requestVersion && requestVersion.value !== callVersion;

  if (reset) {
    items.value = [];
    total.value = 0;
    if (offset) {
      offset.value = 0;
    }
    if (cursor) {
      cursor.value = null;
    }
    onReset?.();
  }
  if (loading) {
    loading.value = true;
  }
  if (error && errorMessage) {
    error.value = '';
  }
  try {
    const pageOffset = reset ? 0 : offset?.value || 0;
    const pageCursor = reset ? null : cursor?.value || null;
    const result = await fetchPage({ offset: pageOffset, cursor: pageCursor });
    if (isStale()) {
      return { ok: false, stale: true };
    }
    if (!result?.ok) {
      if (error && errorMessage) {
        error.value = errorMessage;
      }
      return { ok: false };
    }
    const data = result.data || {};
    const newItems = data.items || [];
    items.value = reset ? newItems : [...items.value, ...newItems];
    if ('total' in data) {
      total.value = data.total;
    } else {
      total.value = 0;
    }
    if (offset) {
      offset.value = pageOffset + newItems.length;
    }
    if (cursor) {
      cursor.value = data.nextCursor || null;
    }
    return { ok: true, items: newItems, data };
  } catch (err) {
    if (isStale()) {
      return { ok: false, stale: true };
    }
    if (error && errorMessage) {
      error.value = errorMessage;
    }
    return { ok: false };
  } finally {
    if (loading && !isStale()) {
      loading.value = false;
    }
  }
}

export function hasMoreFromTotalOrCursor({ itemsLength, total, cursor }) {
  if (total === null || total === undefined) {
    return Boolean(cursor);
  }
  return itemsLength < total;
}
