export function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function readJsonArray(key) {
  const parsed = readJson(key, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readBoolean(key, fallback = false) {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  return raw === 'true';
}

export function writeBoolean(key, value) {
  localStorage.setItem(key, value ? 'true' : 'false');
}

export function readPositiveInt(key, fallback = 1) {
  const parsed = parseInt(localStorage.getItem(key) || String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
