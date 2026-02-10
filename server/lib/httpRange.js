function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader) {
    return null;
  }
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (!match) {
    return null;
  }
  const hasStart = Boolean(match[1]);
  const hasEnd = Boolean(match[2]);
  if (!hasStart && !hasEnd) {
    return null;
  }

  let start = 0;
  let end = size - 1;
  if (hasStart) {
    start = Number.parseInt(match[1], 10);
    end = hasEnd ? Number.parseInt(match[2], 10) : size - 1;
  } else {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) {
    return null;
  }
  return { start, end };
}

module.exports = {
  parseRangeHeader,
};
