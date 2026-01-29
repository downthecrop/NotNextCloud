function parsePagination(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limitRaw = Number.parseInt(query?.limit, 10);
  const offsetRaw = Number.parseInt(query?.offset, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : defaultLimit;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  return {
    limit: Math.min(limit, maxLimit),
    offset,
  };
}

module.exports = {
  parsePagination,
};
