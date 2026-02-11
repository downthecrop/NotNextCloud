const path = require('path');
const { normalizeRelPath } = require('../utils');
const { parseBooleanFlag } = require('./boolean');

function parseDateLike(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const numeric = value < 1e12 ? value * 1000 : value;
    const date = new Date(numeric);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  if (/^\d+$/.test(text)) {
    const numeric = Number.parseInt(text, 10);
    if (Number.isFinite(numeric)) {
      const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
      return Number.isFinite(date.getTime()) ? date : null;
    }
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatYearMonth(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function resolveCameraMonthSegment({
  camera,
  cameraMonth,
  cameraDate,
  capturedAt,
  createdAt,
  modifiedAt,
  lastModified,
  now,
}) {
  if (!parseBooleanFlag(camera, false)) {
    return '';
  }
  const monthText = typeof cameraMonth === 'string' ? cameraMonth.trim() : '';
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(monthText)) {
    return monthText;
  }
  const dateCandidate =
    parseDateLike(cameraDate) ||
    parseDateLike(capturedAt) ||
    parseDateLike(createdAt) ||
    parseDateLike(modifiedAt) ||
    parseDateLike(lastModified) ||
    parseDateLike(now) ||
    new Date();
  return formatYearMonth(dateCandidate);
}

function resolveUploadTarget({
  basePath,
  filePath,
  target,
  camera,
  cameraBasePath,
  cameraMonth,
  cameraDate,
  capturedAt,
  createdAt,
  modifiedAt,
  lastModified,
  now,
}) {
  const cameraEnabled = parseBooleanFlag(camera, false);
  const cameraBaseNormalized = normalizeRelPath(
    typeof cameraBasePath === 'string' && cameraBasePath.trim()
      ? cameraBasePath.trim()
      : 'Camera Uploads'
  );
  const cameraSegment = resolveCameraMonthSegment({
    camera: cameraEnabled,
    cameraMonth,
    cameraDate,
    capturedAt,
    createdAt,
    modifiedAt,
    lastModified,
    now,
  });
  const explicitTarget = typeof target === 'string' ? target.trim() : '';
  if (explicitTarget) {
    const normalized = normalizeRelPath(explicitTarget.replace(/\\/g, '/'));
    if (!normalized) {
      return { error: 'Missing file name' };
    }
    const targetRel = normalizeRelPath(
      path.posix.join(
        cameraEnabled ? cameraBaseNormalized || '' : '',
        cameraSegment,
        normalized
      )
    );
    if (!targetRel) {
      return { error: 'Missing file name' };
    }
    return { targetRel };
  }
  const rawFile = typeof filePath === 'string' ? filePath.trim() : '';
  const normalizedFile = normalizeRelPath(rawFile.replace(/\\/g, '/'));
  if (!normalizedFile) {
    return { error: 'Missing file name' };
  }
  const baseRoot = cameraEnabled
    ? normalizeRelPath(basePath || '') || cameraBaseNormalized || ''
    : normalizeRelPath(basePath || '');
  const base = normalizeRelPath(path.posix.join(baseRoot, cameraSegment));
  const targetRel = normalizeRelPath(path.posix.join(base, normalizedFile));
  if (!targetRel) {
    return { error: 'Missing file name' };
  }
  return { targetRel };
}

module.exports = {
  resolveUploadTarget,
};
